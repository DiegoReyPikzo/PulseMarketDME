import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import {
  buildListingTimingRecord,
  LISTING_TIMING_TYPE,
  logListingTiming,
  type ListingTimingFields,
} from "../../lib/perf-log";

const fields: ListingTimingFields = {
  route: "/dashboard/products",
  connectionMs: 0.123456,
  sessionMs: 12.345678,
  listMs: 345.678901,
  dataReadyMs: 360.111111,
  page: 2,
  pageSize: 50,
  sortBy: "createdAt",
  sortOrder: "desc",
  filtered: true,
  rows: 50,
};

const ALLOWED_KEYS = [
  "type",
  "diagnosticId",
  "loggedAt",
  "region",
  "moduleCallCount",
  "route",
  "connectionMs",
  "sessionMs",
  "listMs",
  "dataReadyMs",
  "page",
  "pageSize",
  "sortBy",
  "sortOrder",
  "filtered",
  "rows",
].sort();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("the timing record contains only the allowed fields, with rounded timings", () => {
  const record = buildListingTimingRecord(fields, {
    diagnosticId: "diag-1",
    loggedAt: "2026-10-18T00:00:00.000Z",
    region: "iad1",
    moduleCallCount: 3,
  });
  assert.deepEqual(Object.keys(record).sort(), ALLOWED_KEYS);
  assert.equal(record.type, LISTING_TIMING_TYPE);
  assert.equal(record.connectionMs, 0.12);
  assert.equal(record.sessionMs, 12.35);
  assert.equal(record.listMs, 345.68);
  assert.equal(record.dataReadyMs, 360.11);
  assert.equal(record.filtered, true);
});

test("extra properties passed at runtime are never logged", () => {
  const withExtras = {
    ...fields,
    search: "secret search term",
    session: { user: { email: "someone@example.test" } },
    cookie: "next-auth.session-token=abc",
  } as ListingTimingFields;
  const record = buildListingTimingRecord(withExtras, {
    diagnosticId: "diag-2",
    loggedAt: "2026-10-18T00:00:00.000Z",
    region: null,
    moduleCallCount: 1,
  });
  assert.deepEqual(Object.keys(record).sort(), ALLOWED_KEYS);
  const text = JSON.stringify(record);
  for (const leaked of ["secret search term", "someone@example.test", "session-token"]) {
    assert.ok(!text.includes(leaked), leaked);
  }
});

test("each log line is one JSON record with a fresh diagnostic ID, a timestamp and the module counter", () => {
  vi.stubEnv("VERCEL_REGION", "iad1");
  const lines: string[] = [];
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  logListingTiming(fields);
  logListingTiming(fields);

  assert.equal(lines.length, 2);
  const [first, second] = lines.map((line) => JSON.parse(line));
  assert.deepEqual(Object.keys(first).sort(), ALLOWED_KEYS);
  assert.match(first.diagnosticId, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.diagnosticId, second.diagnosticId);
  assert.ok(!Number.isNaN(Date.parse(first.loggedAt)));
  assert.equal(first.region, "iad1");
  assert.equal(second.moduleCallCount, first.moduleCallCount + 1);
});

test("region is null outside Vercel", () => {
  vi.stubEnv("VERCEL_REGION", "");
  delete process.env.VERCEL_REGION;
  let line = "";
  vi.spyOn(console, "info").mockImplementation((value: unknown) => {
    line = String(value);
  });
  logListingTiming(fields);
  assert.equal(JSON.parse(line).region, null);
});
