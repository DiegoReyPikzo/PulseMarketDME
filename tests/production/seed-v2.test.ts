import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveProductionAction, runProductionWrapper } from "../../lib/production-command";
import {
  createProductionChildEnvironment,
  validateProductionConfiguration,
  type ProductionConfiguration,
} from "../../lib/production-environment";
import {
  assertConfirmedEndpoint,
  expectedProductionSeedIdentity,
  parseProductionSeedArguments,
  runProductionSeed,
  type SeedTable,
} from "../../lib/production-seed";
import { SEED_TARGET_HOST_KEY, validateSeedTarget } from "../../lib/seed-target";
import type { SeedDataset } from "../../prisma/seed-data";
import type { SeedStore, SeedSummary, TableFingerprint } from "../../prisma/seed";

// Fictitious values only: no real host, role, password or digest. Nothing
// here opens a database connection.
const PASSWORD = "Fake-Pr0d-Secret";
const DIRECT_HOST = "ep-fake-prod-123456.c-1.us-east-2.aws.neon.tech";
const POOLED_HOST = "ep-fake-prod-123456-pooler.c-1.us-east-2.aws.neon.tech";
const OTHER_POOLED_HOST = "ep-fake-other-777777-pooler.c-1.us-east-2.aws.neon.tech";
const ENDPOINT = "ep-fake-prod-123456";

const url = (host: string) =>
  `postgresql://neondb_owner:${PASSWORD}@${host}/neondb?sslmode=require`;
const target = {
  PROD_ALLOWED_DIRECT_HOST: DIRECT_HOST,
  PROD_ALLOWED_POOLED_HOST: POOLED_HOST,
  PROD_ALLOWED_DATABASE: "neondb",
  PROD_ALLOWED_ROLE: "neondb_owner",
};

function valid(): ProductionConfiguration {
  return validateProductionConfiguration(
    { PROD_DATABASE_URL: url(POOLED_HOST), PROD_DIRECT_URL: url(DIRECT_HOST) },
    target,
  );
}

const DIGEST = "0123456789abcdef0123456789abcdef";
const BASELINE: Record<SeedTable, TableFingerprint> = {
  products: { count: 103, digest: DIGEST },
  customers: { count: 501, digest: DIGEST.replace("0", "1") },
  sales: { count: 2000, digest: DIGEST.replace("0", "2") },
  saleItems: { count: 8000, digest: DIGEST.replace("0", "3") },
};

function seedArgs(overrides: Record<string, string | null> = {}): string[] {
  const values: Record<string, string | null> = {
    "--confirm-endpoint": ENDPOINT,
    "--backup-branch": "prod-backup-pre-seed-v2",
    "--expect-products": `${BASELINE.products.count}:${BASELINE.products.digest}`,
    "--expect-customers": `${BASELINE.customers.count}:${BASELINE.customers.digest}`,
    "--expect-sales": `${BASELINE.sales.count}:${BASELINE.sales.digest}`,
    "--expect-sale-items": `${BASELINE.saleItems.count}:${BASELINE.saleItems.digest}`,
    ...overrides,
  };
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([key, value]) => `${key}=${value}`);
}

test("seed-v2 resolves to the production seed script with the validated arguments", () => {
  const invocation = resolveProductionAction(["seed-v2", ...seedArgs()], valid(), {
    nodePath: "node",
    seedScript: "production-seed-v2.ts",
  });
  assert.deepEqual(invocation, {
    command: "node",
    args: ["--import", "tsx", "production-seed-v2.ts", ...seedArgs()],
    description: "v2 sample-data load (insert-only, one serializable transaction)",
  });
  assert.deepEqual(parseProductionSeedArguments(seedArgs()), {
    confirmEndpoint: ENDPOINT,
    backupBranch: "prod-backup-pre-seed-v2",
    baseline: BASELINE,
  });
});

test("seed-v2 rejects a missing, repeated, unknown or malformed argument and a wrong endpoint", () => {
  const configuration = valid();
  const invalid: string[][] = [
    [],
    seedArgs({ "--confirm-endpoint": null }),
    seedArgs({ "--confirm-endpoint": "ep-wrong-000000" }),
    seedArgs({ "--backup-branch": null }),
    seedArgs({ "--backup-branch": "x" }),
    seedArgs({ "--backup-branch": "bad name;drop" }),
    seedArgs({ "--expect-products": null }),
    seedArgs({ "--expect-sale-items": null }),
    seedArgs({ "--expect-sales": "2000" }),
    seedArgs({ "--expect-sales": `2000:${DIGEST.toUpperCase()}` }),
    seedArgs({ "--expect-customers": `-1:${DIGEST}` }),
    seedArgs({ "--expect-customers": `501:${DIGEST}0` }),
    [...seedArgs(), `--expect-products=1:${DIGEST}`],
    [...seedArgs(), "--force"],
    [...seedArgs(), "--skip-baseline=true"],
    [...seedArgs(), "positional"],
  ];
  for (const argv of invalid) {
    assert.throws(
      () => resolveProductionAction(["seed-v2", ...argv], configuration),
      Error,
      argv.join(" "),
    );
  }
});

function fakeWrapper(argv: string[], environment: NodeJS.ProcessEnv = { NODE_ENV: "test" }) {
  const calls: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    calls,
    logs,
    errors,
    run: () =>
      runProductionWrapper({
        argv,
        environment,
        loadConfiguration: valid,
        spawn: async (_command, args, env) => {
          calls.push({ args, env });
          return 0;
        },
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
        nodePath: "node",
      }),
  };
}

test("the wrapper spawns seed-v2 only with the verified environment and never in automation", async () => {
  const ok = fakeWrapper(["seed-v2", ...seedArgs()]);
  assert.equal(await ok.run(), 0);
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.calls[0].env.PULSEMARKET_DB_TARGET_KIND, "production");
  assert.equal(new URL(ok.calls[0].env.DATABASE_URL ?? "").hostname, POOLED_HOST);
  assert.ok(![...ok.logs, ...ok.errors].join("\n").includes(PASSWORD));

  const wrongEndpoint = fakeWrapper(["seed-v2", ...seedArgs({ "--confirm-endpoint": "ep-wrong-000000" })]);
  assert.equal(await wrongEndpoint.run(), 1);
  assert.equal(wrongEndpoint.calls.length, 0);
  assert.match(wrongEndpoint.errors[0], /confirm-endpoint/);

  const malformed = fakeWrapper(["seed-v2", ...seedArgs({ "--expect-sales": null })]);
  assert.equal(await malformed.run(), 1);
  assert.equal(malformed.calls.length, 0);

  for (const key of ["CI", "VERCEL", "VERCEL_ENV", "GITHUB_ACTIONS"]) {
    const automated = fakeWrapper(["seed-v2", ...seedArgs()], { NODE_ENV: "test", [key]: "1" });
    assert.equal(await automated.run(), 1);
    assert.equal(automated.calls.length, 0);
  }
});

test("the seed script accepts only the production wrapper environment for the verified endpoint", () => {
  const childEnvironment = createProductionChildEnvironment(valid(), { NODE_ENV: "test" });
  assert.deepEqual(expectedProductionSeedIdentity(childEnvironment), {
    database: "neondb",
    role: "neondb_owner",
    endpoint: ENDPOINT,
  });

  const rejected: Array<Record<string, string | undefined>> = [
    { ...childEnvironment, PULSEMARKET_DB_TARGET_KIND: undefined },
    { ...childEnvironment, PULSEMARKET_DB_TARGET_KIND: "e2e" },
    { ...childEnvironment, PULSEMARKET_DB_TARGET_ENDPOINT: undefined },
    { ...childEnvironment, DATABASE_URL: url(OTHER_POOLED_HOST) },
    { ...childEnvironment, DATABASE_URL: undefined },
    { ...childEnvironment, CI: "true" },
    { ...childEnvironment, VERCEL: "1" },
    { ...childEnvironment, E2E_DATABASE_URL: url(OTHER_POOLED_HOST) },
  ];
  for (const environment of rejected) {
    assert.throws(() => expectedProductionSeedIdentity(environment));
  }

  const identity = expectedProductionSeedIdentity(childEnvironment);
  assertConfirmedEndpoint(parseProductionSeedArguments(seedArgs()), identity);
  assert.throws(
    () =>
      assertConfirmedEndpoint(
        parseProductionSeedArguments(seedArgs({ "--confirm-endpoint": "ep-wrong-000000" })),
        identity,
      ),
    /does not match/,
  );
});

test("the sample-data seed still refuses Production, inside or outside the wrapper", () => {
  const childEnvironment = createProductionChildEnvironment(valid(), { NODE_ENV: "test" });
  assert.throws(
    () =>
      validateSeedTarget({
        environment: { ...childEnvironment, [SEED_TARGET_HOST_KEY]: POOLED_HOST },
        productionTarget: target,
        e2eTarget: undefined,
      }),
    /inside the production database wrapper/,
  );
  assert.throws(
    () =>
      validateSeedTarget({
        environment: { DATABASE_URL: url(POOLED_HOST), [SEED_TARGET_HOST_KEY]: POOLED_HOST },
        productionTarget: target,
        e2eTarget: {
          E2E_ALLOWED_DIRECT_HOST: "ep-fake-e2e-654321.c-1.us-east-2.aws.neon.tech",
          E2E_ALLOWED_POOLED_HOST: "ep-fake-e2e-654321-pooler.c-1.us-east-2.aws.neon.tech",
        },
      }),
    /Production endpoint/,
  );
});

type StoreCall = { method: string; table?: string };

function recordingStore(fingerprints: Record<SeedTable, TableFingerprint>) {
  const calls: StoreCall[] = [];
  const store: SeedStore = {
    async fingerprintOtherRows(table) {
      calls.push({ method: "fingerprintOtherRows", table });
      return fingerprints[table];
    },
    async findConflictCandidates(table) {
      calls.push({ method: "findConflictCandidates", table });
      throw new Error("sentinel: runSeedTransaction reached its conflict check");
    },
    async insert(table) {
      calls.push({ method: "insert", table });
      throw new Error("insert must not be reached in these tests");
    },
    async readSeededRows(table) {
      calls.push({ method: "readSeededRows", table });
      return [];
    },
  };
  return { store, calls };
}

const IDENTITY = { database: "neondb", role: "neondb_owner", endpoint: ENDPOINT };
const EMPTY_DATASET: SeedDataset = { products: [], customers: [], sales: [], saleItems: [] };
const FAKE_SUMMARY: SeedSummary = {
  inserted: { products: 1, customers: 2, sales: 3, saleItems: 4 },
  alreadyPresent: { products: 0, customers: 0, sales: 0, saleItems: 0 },
  otherRowsUnchanged: { products: 103, customers: 501, sales: 2000, saleItems: 8000 },
};

test("the production seed writes nothing when the connected identity differs", async () => {
  for (const actual of [
    { database: "otherdb", role: "neondb_owner" },
    { database: "neondb", role: "other_role" },
  ]) {
    const { store, calls } = recordingStore(BASELINE);
    let ran = false;
    await assert.rejects(
      runProductionSeed(
        store,
        EMPTY_DATASET,
        { identity: IDENTITY, baseline: BASELINE, readIdentity: async () => actual },
        async () => {
          ran = true;
          return FAKE_SUMMARY;
        },
      ),
      /identity does not match.*Nothing was written/,
    );
    assert.equal(ran, false);
    assert.deepEqual(calls, []);
  }
});

test("the production seed writes nothing when any table no longer matches the baseline", async () => {
  for (const table of ["products", "customers", "sales", "saleItems"] as const) {
    for (const change of [
      { count: BASELINE[table].count + 1, digest: BASELINE[table].digest },
      { count: BASELINE[table].count, digest: "f".repeat(32) },
    ]) {
      const { store, calls } = recordingStore({ ...BASELINE, [table]: change });
      let ran = false;
      await assert.rejects(
        runProductionSeed(
          store,
          EMPTY_DATASET,
          {
            identity: IDENTITY,
            baseline: BASELINE,
            readIdentity: async () => ({ database: "neondb", role: "neondb_owner" }),
          },
          async () => {
            ran = true;
            return FAKE_SUMMARY;
          },
        ),
        new RegExp(`${table}: rows outside the v2 sample data no longer match the baseline.*Nothing was written`),
      );
      assert.equal(ran, false);
      assert.ok(calls.every((call) => call.method === "fingerprintOtherRows"));
    }
  }
});

test("after identity and baseline match, the production seed hands over to the seed transaction", async () => {
  const { store, calls } = recordingStore(BASELINE);
  let received: { store: SeedStore; dataset: SeedDataset } | undefined;
  const summary = await runProductionSeed(
    store,
    EMPTY_DATASET,
    {
      identity: IDENTITY,
      baseline: BASELINE,
      readIdentity: async () => ({ database: "neondb", role: "neondb_owner" }),
    },
    async (runStore, dataset) => {
      received = { store: runStore, dataset };
      return FAKE_SUMMARY;
    },
  );
  assert.equal(summary, FAKE_SUMMARY);
  assert.equal(received?.store, store);
  assert.equal(received?.dataset, EMPTY_DATASET);
  assert.deepEqual(
    calls.map((call) => call.table),
    ["products", "customers", "sales", "saleItems"],
  );
});

test("by default the production seed runs the unchanged runSeedTransaction", async () => {
  // The default runner fingerprints every table again and then reaches the
  // conflict check, where this store stops it before any insert.
  const { store, calls } = recordingStore(BASELINE);
  await assert.rejects(
    runProductionSeed(store, EMPTY_DATASET, {
      identity: IDENTITY,
      baseline: BASELINE,
      readIdentity: async () => ({ database: "neondb", role: "neondb_owner" }),
    }),
    /sentinel: runSeedTransaction reached its conflict check/,
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    [
      ...Array<string>(4).fill("fingerprintOtherRows"),
      ...Array<string>(4).fill("fingerprintOtherRows"),
      "findConflictCandidates",
    ],
  );
  assert.ok(!calls.some((call) => call.method === "insert"));
});
