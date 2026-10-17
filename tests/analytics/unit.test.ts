import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDailySeries,
  getUtcRangeBounds,
  parseDashboardAnalyticsRange,
} from "../../lib/analytics/range";
import { formatChartPointTitle } from "../../lib/analytics/chart-title";
import { formatLastQueryTime } from "../../lib/analytics/last-query-time";
import { shouldRefreshAnalytics } from "../../lib/analytics/refresh-policy";

test("defaults to the current UTC day and the previous 29 days", () => {
  const result = parseDashboardAnalyticsRange(
    {},
    new Date("2026-10-17T02:00:00.000Z"),
  );

  assert.deepEqual(result, {
    success: true,
    data: { from: "2026-09-18", to: "2026-10-17" },
  });
});

test("converts the selected final UTC date to an exclusive next-day bound", () => {
  const result = parseDashboardAnalyticsRange({
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.equal(result.success, true);
  if (result.success) {
    const bounds = getUtcRangeBounds(result.data);
    assert.equal(bounds.startInclusive.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(bounds.endExclusive.toISOString(), "2026-11-01T00:00:00.000Z");
  }
});

test("rejects impossible, reversed, repeated, and unsupported period parameters", () => {
  assert.equal(
    parseDashboardAnalyticsRange({ from: "2026-02-30", to: "2026-03-01" })
      .success,
    false,
  );
  assert.equal(
    parseDashboardAnalyticsRange({ from: "2026-03-02", to: "2026-03-01" })
      .success,
    false,
  );
  assert.equal(
    parseDashboardAnalyticsRange({ from: ["2026-03-01"], to: "2026-03-02" })
      .success,
    false,
  );
  assert.equal(
    parseDashboardAnalyticsRange({
      from: "2026-03-01",
      to: "2026-03-02",
      status: "PENDING",
    }).success,
    false,
  );
});

test("accepts exactly 366 inclusive days and rejects longer ranges", () => {
  assert.equal(
    parseDashboardAnalyticsRange({
      from: "2025-01-01",
      to: "2026-01-01",
    }).success,
    true,
  );
  const tooLong = parseDashboardAnalyticsRange({
    from: "2025-01-01",
    to: "2026-01-02",
  });
  assert.equal(tooLong.success, false);
  if (!tooLong.success) assert.match(tooLong.message, /366 días/);
});

test("fills missing UTC dates with exact zero values", () => {
  const result = createDailySeries(
    { from: "2026-05-01", to: "2026-05-03" },
    [{ day: "2026-05-01", amount: "10.25", salesCount: 1 }],
  );

  assert.deepEqual(result, [
    { date: "2026-05-01", amount: "10.25", salesCount: 1 },
    { date: "2026-05-02", amount: "0.00", salesCount: 0 },
    { date: "2026-05-03", amount: "0.00", salesCount: 0 },
  ]);
});

test("refresh policy skips hidden tabs and overlapping requests", () => {
  assert.equal(shouldRefreshAnalytics("visible", false), true);
  assert.equal(shouldRefreshAnalytics("hidden", false), false);
  assert.equal(shouldRefreshAnalytics("visible", true), false);
});

test("builds SVG chart point titles as one exact deterministic string", () => {
  assert.equal(
    formatChartPointTitle("2024-01-01", "12345678901234567890.01"),
    "2024-01-01: 12345678901234567890.01",
  );
});

test("uses a deterministic UTC presentation before hydration has mounted", () => {
  assert.deepEqual(
    formatLastQueryTime("2026-10-17T08:34:56.789Z", null),
    {
      text: "2026-10-17 08:34:56 UTC",
      timeZoneLabel: "UTC",
    },
  );
});

test("formats the original instant in the requested browser time zone", () => {
  const presentation = formatLastQueryTime(
    "2026-10-17T08:34:56.789Z",
    "America/Los_Angeles",
  );

  assert.match(presentation.text, /1:34:56/);
  assert.equal(presentation.timeZoneLabel, "America/Los_Angeles");
});
