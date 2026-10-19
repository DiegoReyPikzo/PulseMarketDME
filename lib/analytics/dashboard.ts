import "server-only";

import { Prisma } from "../../generated/prisma/client";
import { analyticsPrisma } from "./analytics-prisma";
import {
  createDailySeries,
  type DashboardAnalyticsRange,
} from "./range";
import { createDashboardAnalyticsQuery } from "./query";

export type DashboardAnalytics = {
  from: string;
  to: string;
  queriedAt: string;
  completedSalesAmount: string;
  completedSalesCount: number;
  averageTicket: string | null;
  activeProductsCount: number;
  daily: ReturnType<typeof createDailySeries>;
};

type DailyAggregateRow = {
  day: string;
  amount: string;
  salesCount: number;
  completedSalesAmount: string;
  completedSalesCount: number;
  averageTicket: string | null;
  activeProductsCount: number;
};

export type DashboardAnalyticsPhase =
  | "database_call"
  | "result_processing"
  | "total";

export async function getDashboardAnalytics(
  range: DashboardAnalyticsRange,
  onTiming?: (phase: DashboardAnalyticsPhase, milliseconds: number) => void,
): Promise<DashboardAnalytics> {
  const requestStartedAt = performance.now();

  // A single statement: PostgreSQL evaluates all of its CTEs against one
  // snapshot, so the daily series, the summary and the active product count
  // stay mutually consistent without an explicit transaction.
  const callStartedAt = performance.now();
  const rows = await analyticsPrisma.$queryRaw<DailyAggregateRow[]>(
    createDashboardAnalyticsQuery(range),
  );
  // Includes acquiring a pooled connection (and opening one if needed).
  onTiming?.("database_call", performance.now() - callStartedAt);
  const summary = rows[0];
  if (!summary) {
    throw new Error("La consulta agregada no devolvió los días del período.");
  }
  const snapshot = { summary, rows };

  const processingStartedAt = performance.now();
  const result = {
    from: range.from,
    to: range.to,
    queriedAt: new Date().toISOString(),
    completedSalesAmount: new Prisma.Decimal(
      snapshot.summary.completedSalesAmount,
    ).toFixed(2),
    completedSalesCount: snapshot.summary.completedSalesCount,
    averageTicket:
      snapshot.summary.averageTicket === null
        ? null
        : new Prisma.Decimal(snapshot.summary.averageTicket).toFixed(2),
    activeProductsCount: snapshot.summary.activeProductsCount,
    daily: createDailySeries(
      range,
      snapshot.rows.map((row) => ({
        day: row.day,
        amount: new Prisma.Decimal(row.amount).toFixed(2),
        salesCount: row.salesCount,
      })),
    ),
  };
  onTiming?.(
    "result_processing",
    performance.now() - processingStartedAt,
  );
  onTiming?.("total", performance.now() - requestStartedAt);
  return result;
}
