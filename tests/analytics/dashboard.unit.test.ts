import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

const { queryRaw, transaction, sharedQueryRaw, sharedTransaction, getAuthenticatedSession } =
  vi.hoisted(() => {
    const queryRaw = vi.fn();
    return {
      queryRaw,
      // Delegates to the same $queryRaw, so the previous transactional path
      // would still return data; only the direct-path checks can tell them apart.
      transaction: vi.fn(async (callback: (client: unknown) => unknown) =>
        callback({ $queryRaw: queryRaw }),
      ),
      sharedQueryRaw: vi.fn(),
      sharedTransaction: vi.fn(),
      getAuthenticatedSession: vi.fn(async () => ({ user: {} })),
    };
  });

vi.mock("../../lib/analytics/analytics-prisma", () => ({
  analyticsPrisma: { $queryRaw: queryRaw, $transaction: transaction },
}));
// The shared client must not be used by the dashboard aggregate.
vi.mock("../../lib/prisma", () => ({
  prisma: { $queryRaw: sharedQueryRaw, $transaction: sharedTransaction },
}));
vi.mock("../../lib/auth-session", () => ({ getAuthenticatedSession }));

import { refreshDashboardAnalytics } from "../../app/dashboard/analytics-actions";
import { getDashboardAnalytics } from "../../lib/analytics/dashboard";
import { createDashboardAnalyticsQuery } from "../../lib/analytics/query";
import {
  getUtcRangeBounds,
  parseDashboardAnalyticsRange,
} from "../../lib/analytics/range";

afterEach(() => {
  vi.clearAllMocks();
});

const range = { from: "2026-09-18", to: "2026-09-20" };

// Rows as returned by the aggregate statement: one per calendar day, with the
// period summary repeated on every row.
function rowsFor(
  days: Array<{ day: string; amount: string; salesCount: number }>,
  summary = {
    completedSalesAmount: "30.3",
    completedSalesCount: 2,
    averageTicket: "15.15" as string | null,
    activeProductsCount: 950,
  },
) {
  return days.map((day) => ({ ...day, ...summary }));
}

test("runs the aggregate statement once, directly, with the unchanged SQL and parameters", async () => {
  queryRaw.mockResolvedValueOnce(
    rowsFor([
      { day: "2026-09-18", amount: "10.1", salesCount: 1 },
      { day: "2026-09-19", amount: "0", salesCount: 0 },
      { day: "2026-09-20", amount: "20.2", salesCount: 1 },
    ]),
  );
  await getDashboardAnalytics(range);

  assert.equal(transaction.mock.calls.length, 0);
  assert.equal(queryRaw.mock.calls.length, 1);
  assert.equal(sharedQueryRaw.mock.calls.length, 0);
  assert.equal(sharedTransaction.mock.calls.length, 0);
  const sent = queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
  const expected = createDashboardAnalyticsQuery(range);
  assert.equal(sent.sql, expected.sql);
  assert.deepEqual(sent.values, expected.values);
  const { startInclusive, endExclusive } = getUtcRangeBounds(range);
  const times = sent.values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  assert.deepEqual(times, [startInclusive.getTime(), endExclusive.getTime()]);
});

test("keeps the return contract, exact decimal strings and zero-filled series", async () => {
  queryRaw.mockResolvedValueOnce(
    rowsFor([
      { day: "2026-09-18", amount: "10.1", salesCount: 1 },
      { day: "2026-09-20", amount: "20.2", salesCount: 1 },
    ]),
  );
  const analytics = await getDashboardAnalytics(range);

  assert.deepEqual(Object.keys(analytics), [
    "from",
    "to",
    "queriedAt",
    "completedSalesAmount",
    "completedSalesCount",
    "averageTicket",
    "activeProductsCount",
    "daily",
  ]);
  assert.match(analytics.queriedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const rest: Partial<typeof analytics> = { ...analytics };
  delete rest.queriedAt;
  assert.deepEqual(rest, {
    from: "2026-09-18",
    to: "2026-09-20",
    completedSalesAmount: "30.30",
    completedSalesCount: 2,
    averageTicket: "15.15",
    activeProductsCount: 950,
    daily: [
      { date: "2026-09-18", amount: "10.10", salesCount: 1 },
      { date: "2026-09-19", amount: "0.00", salesCount: 0 },
      { date: "2026-09-20", amount: "20.20", salesCount: 1 },
    ],
  });
});

test("returns a null average and zero totals for a period without completed sales", async () => {
  queryRaw.mockResolvedValueOnce(
    rowsFor([{ day: "2026-09-18", amount: "0", salesCount: 0 }], {
      completedSalesAmount: "0",
      completedSalesCount: 0,
      averageTicket: null,
      activeProductsCount: 0,
    }),
  );
  const analytics = await getDashboardAnalytics({ from: "2026-09-18", to: "2026-09-18" });

  assert.equal(analytics.completedSalesAmount, "0.00");
  assert.equal(analytics.completedSalesCount, 0);
  assert.equal(analytics.averageTicket, null);
  assert.deepEqual(analytics.daily, [{ date: "2026-09-18", amount: "0.00", salesCount: 0 }]);
});

test("covers one-day, 366-day and default ranges with one point per day", async () => {
  const defaultRange = parseDashboardAnalyticsRange(undefined, new Date("2026-10-18T12:00:00.000Z"));
  const maximumRange = parseDashboardAnalyticsRange({ from: "2025-10-17", to: "2026-10-17" });
  assert.ok(defaultRange.success && maximumRange.success);

  for (const [current, days] of [
    [{ from: "2026-02-28", to: "2026-02-28" }, 1],
    [maximumRange.data, 366],
    [defaultRange.data, 30],
  ] as const) {
    queryRaw.mockResolvedValueOnce(rowsFor([{ day: current.from, amount: "1", salesCount: 1 }]));
    const analytics = await getDashboardAnalytics(current);
    assert.equal(analytics.daily.length, days);
    assert.equal(analytics.daily[0].date, current.from);
    assert.equal(analytics.daily.at(-1)!.date, current.to);
  }
  assert.equal(transaction.mock.calls.length, 0);
});

test("keeps the existing error when the statement returns no rows", async () => {
  queryRaw.mockResolvedValueOnce([]);
  await assert.rejects(
    getDashboardAnalytics(range),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "La consulta agregada no devolvió los días del período.",
  );
});

test("propagates a database error unchanged", async () => {
  const failure = Object.assign(new Error("simulated database failure"), { code: "P2010" });
  queryRaw.mockRejectedValueOnce(failure);
  await assert.rejects(getDashboardAnalytics(range), (error: unknown) => error === failure);
});

test("propagates a client wait-limit error unchanged and the refresh action maps it", async () => {
  // Shape of the rejections pg-pool and pg produce for the configured limits.
  for (const message of [
    "timeout exceeded when trying to connect",
    "Connection terminated due to connection timeout",
    "Query read timeout",
  ]) {
    const failure = new Error(message);
    queryRaw.mockRejectedValueOnce(failure);
    await assert.rejects(getDashboardAnalytics(range), (error: unknown) => error === failure);
  }

  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  queryRaw.mockRejectedValueOnce(new Error("timeout exceeded when trying to connect"));
  assert.deepEqual(await refreshDashboardAnalytics(range.from, range.to), {
    success: false,
    message:
      "No se pudieron actualizar las métricas. Los datos mostrados pueden estar desactualizados.",
  });
  consoleError.mockRestore();
});

test("reports only the database call, result processing and total phases", async () => {
  queryRaw.mockResolvedValueOnce(rowsFor([{ day: "2026-09-18", amount: "1", salesCount: 1 }]));
  const phases: Array<[string, number]> = [];
  await getDashboardAnalytics(range, (phase, milliseconds) => {
    phases.push([phase, milliseconds]);
  });

  assert.deepEqual(
    phases.map(([phase]) => phase),
    ["database_call", "result_processing", "total"],
  );
  assert.ok(phases.every(([, milliseconds]) => Number.isFinite(milliseconds) && milliseconds >= 0));
});

test("the refresh action still maps failures to its existing message", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  queryRaw.mockRejectedValueOnce(new Error("simulated database failure"));
  const failed = await refreshDashboardAnalytics(range.from, range.to);
  assert.deepEqual(failed, {
    success: false,
    message:
      "No se pudieron actualizar las métricas. Los datos mostrados pueden estar desactualizados.",
  });
  assert.equal(consoleError.mock.calls.length, 1);
  consoleError.mockRestore();

  queryRaw.mockResolvedValueOnce(rowsFor([{ day: range.from, amount: "1", salesCount: 1 }]));
  const succeeded = await refreshDashboardAnalytics(range.from, range.to);
  assert.equal(succeeded.success, true);
  assert.equal(getAuthenticatedSession.mock.calls.length, 2);
});
