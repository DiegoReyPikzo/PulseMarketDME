import "server-only";

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

// Temporary diagnostic log for the products listing (Vercel runtime logs).
// It records server-side timings of one measured render and nothing about
// the user: no session, cookies, headers, search terms or customer data.
// Remove this module and its call site once the measurement is done.

export const LISTING_TIMING_TYPE = "pulsemarket.listing-timing";

// Calls of logListingTiming in this loaded module. It resets whenever the
// module is loaded again; it says nothing about cold instances or about
// whether database connections were opened.
let moduleCallCount = 0;

export const now = (): number => performance.now();

export type ListingTimingFields = {
  route: string;
  connectionMs: number;
  sessionMs: number;
  listMs: number;
  dataReadyMs: number;
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: string;
  filtered: boolean;
  rows: number;
};

export type ListingTimingRecord = ListingTimingFields & {
  type: typeof LISTING_TIMING_TYPE;
  diagnosticId: string;
  loggedAt: string;
  region: string | null;
  moduleCallCount: number;
};

const ms = (value: number): number => Number(value.toFixed(2));

// Builds the record from an explicit allow-list, so extra properties passed
// at runtime are never logged.
export function buildListingTimingRecord(
  fields: ListingTimingFields,
  context: { diagnosticId: string; loggedAt: string; region: string | null; moduleCallCount: number },
): ListingTimingRecord {
  return {
    type: LISTING_TIMING_TYPE,
    diagnosticId: context.diagnosticId,
    loggedAt: context.loggedAt,
    region: context.region,
    moduleCallCount: context.moduleCallCount,
    route: fields.route,
    connectionMs: ms(fields.connectionMs),
    sessionMs: ms(fields.sessionMs),
    listMs: ms(fields.listMs),
    dataReadyMs: ms(fields.dataReadyMs),
    page: fields.page,
    pageSize: fields.pageSize,
    sortBy: fields.sortBy,
    sortOrder: fields.sortOrder,
    filtered: fields.filtered,
    rows: fields.rows,
  };
}

export function logListingTiming(fields: ListingTimingFields): void {
  moduleCallCount += 1;
  const record = buildListingTimingRecord(fields, {
    diagnosticId: randomUUID(),
    loggedAt: new Date().toISOString(),
    region: process.env.VERCEL_REGION ?? null,
    moduleCallCount,
  });
  console.info(JSON.stringify(record));
}
