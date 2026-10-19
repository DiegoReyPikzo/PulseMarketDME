import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterEach, beforeEach, test, vi } from "vitest";

// Constructors are replaced so nothing here opens a connection; the real pg
// module is used only with a simulated Client further below.
const { PrismaPg, PrismaClient } = vi.hoisted(() => ({
  PrismaPg: vi.fn(function (this: { config: unknown }, config: unknown) {
    this.config = config;
  }),
  PrismaClient: vi.fn(function (this: { options: unknown }, options: unknown) {
    this.options = options;
  }),
}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg }));
vi.mock("../../generated/prisma/client", () => ({ PrismaClient }));

const FAKE_URL = "postgresql://analytics_test:not-a-secret@db.invalid:5432/analytics_test";
type GlobalClients = { analyticsPrisma?: unknown; prisma?: unknown };
const globals = globalThis as GlobalClients;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete globals.analyticsPrisma;
  delete globals.prisma;
  vi.stubEnv("DATABASE_URL", FAKE_URL);
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete globals.analyticsPrisma;
  delete globals.prisma;
});

const importAnalytics = () => import("../../lib/analytics/analytics-prisma");

test("the analytics client sets only the approved wait limits", async () => {
  const analytics = await importAnalytics();

  assert.equal(analytics.ANALYTICS_CONNECTION_TIMEOUT_MS, 2_000);
  assert.equal(analytics.ANALYTICS_QUERY_TIMEOUT_MS, 5_000);
  assert.equal(PrismaPg.mock.calls.length, 1);
  assert.deepEqual(PrismaPg.mock.calls[0], [
    { connectionString: FAKE_URL, connectionTimeoutMillis: 2_000, query_timeout: 5_000 },
  ]);
  const config = PrismaPg.mock.calls[0][0] as Record<string, unknown>;
  // No server-side timeout and no other pool option is changed.
  for (const key of ["statement_timeout", "max", "min", "idleTimeoutMillis", "maxUses"]) {
    assert.equal(key in config, false, key);
  }
  assert.equal(PrismaClient.mock.calls.length, 1);
  assert.equal(
    (PrismaClient.mock.calls[0][0] as { adapter: unknown }).adapter,
    PrismaPg.mock.instances[0],
  );
});

test("the analytics client is reused through globalThis outside production", async () => {
  const first = (await importAnalytics()).analyticsPrisma;
  vi.resetModules();
  const second = (await importAnalytics()).analyticsPrisma;

  assert.equal(second, first);
  assert.equal(globals.analyticsPrisma, first);
  assert.equal(PrismaClient.mock.calls.length, 1);
});

test("the analytics client is not cached on globalThis in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await importAnalytics();
  assert.equal(globals.analyticsPrisma, undefined);
});

test("the analytics client requires DATABASE_URL like the shared client", async () => {
  vi.stubEnv("DATABASE_URL", "");
  await assert.rejects(importAnalytics(), /DATABASE_URL must be set\./);
  assert.equal(PrismaPg.mock.calls.length, 0);
});

test("the shared client keeps its configuration and is a different instance", async () => {
  const { prisma } = await import("../../lib/prisma");
  const { analyticsPrisma } = await importAnalytics();

  assert.deepEqual(PrismaPg.mock.calls[0], [{ connectionString: FAKE_URL }]);
  assert.notEqual(prisma, analyticsPrisma);
});

test("the query limit is documented as a client-side wait, not a server cancellation", () => {
  const source = readFileSync(join(process.cwd(), "lib", "analytics", "analytics-prisma.ts"), "utf8");
  assert.match(source, /does not send a cancel request/);
  assert.match(source, /PostgreSQL\s+\/\/\s+may keep running the statement/);
  assert.match(source, /not the old\s+\/\/\s+\$transaction maxWait\/timeout/);
  assert.doesNotMatch(source, /statement_timeout\s*:/);
});

// --- pg-pool behavior with a simulated Client (no network) ----------------

type Callback = (error?: Error) => void;

// Minimal stand-in for pg.Client: `hang` never finishes connecting; otherwise
// it connects on the next tick. destroy() fails a pending connect like pg does.
function fakeClientClass(mode: "hang" | "connect") {
  const created: Array<{ destroyed: boolean }> = [];
  class FakeClient extends EventEmitter {
    _queryable = true;
    _ending = false;
    connected = false;
    private pending?: Callback;
    connection = {
      stream: {
        destroy: () => {
          created.find((entry) => entry === this.state)!.destroyed = true;
          const callback = this.pending;
          this.pending = undefined;
          callback?.(new Error("Connection terminated"));
        },
      },
    };
    private state = { destroyed: false };
    constructor() {
      super();
      created.push(this.state);
    }
    connect(callback: Callback) {
      if (mode === "hang") {
        this.pending = callback;
        return;
      }
      process.nextTick(() => {
        this.connected = true;
        callback();
      });
    }
    isConnected() {
      return this.connected;
    }
    end(callback?: Callback) {
      this._ending = true;
      callback?.();
      return Promise.resolve();
    }
  }
  return { FakeClient, created };
}

test("opening a connection is abandoned at the connection limit and its socket destroyed", async () => {
  const { ANALYTICS_CONNECTION_TIMEOUT_MS } = await importAnalytics();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { FakeClient, created } = fakeClientClass("hang");
  const pool = new pg.Pool({
    Client: FakeClient as unknown as typeof pg.Client,
    connectionTimeoutMillis: ANALYTICS_CONNECTION_TIMEOUT_MS,
  });

  let settled = false;
  // Capture the outcome before advancing time, so the rejection is handled.
  const outcome = pool.connect().then(
    () => new Error("connected unexpectedly"),
    (error: Error) => error,
  ).finally(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(ANALYTICS_CONNECTION_TIMEOUT_MS - 1);
  assert.equal(settled, false);
  await vi.advanceTimersByTimeAsync(1);
  assert.match((await outcome).message, /^Connection terminated due to connection timeout$/);
  assert.equal(created.length, 1);
  assert.equal(created[0].destroyed, true);
  await pool.end();
});

test("waiting for a busy pool is abandoned at the connection limit and leaves the queue", async () => {
  const { ANALYTICS_CONNECTION_TIMEOUT_MS } = await importAnalytics();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { FakeClient } = fakeClientClass("connect");
  // max: 1 only simulates a busy pool here; the analytics pool keeps pg-pool's default.
  const pool = new pg.Pool({
    Client: FakeClient as unknown as typeof pg.Client,
    connectionTimeoutMillis: ANALYTICS_CONNECTION_TIMEOUT_MS,
    max: 1,
  });

  const busy = await pool.connect();
  // Capture the outcome before advancing time, so the rejection is handled.
  const waiting = pool.connect().then(
    () => new Error("acquired unexpectedly"),
    (error: Error) => error,
  );
  await vi.advanceTimersByTimeAsync(ANALYTICS_CONNECTION_TIMEOUT_MS);
  assert.match((await waiting).message, /^timeout exceeded when trying to connect$/);
  assert.equal(pool.waitingCount, 0);
  busy.release();
  await pool.end();
});
