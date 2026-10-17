import "server-only";

import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../prisma";
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
  | "transaction_establishment"
  | "analytics_query"
  | "transaction_completion"
  | "result_processing"
  | "total";

export async function getDashboardAnalytics(
  range: DashboardAnalyticsRange,
  onTiming?: (phase: DashboardAnalyticsPhase, milliseconds: number) => void,
): Promise<DashboardAnalytics> {
  const requestStartedAt = performance.now();
  const transactionStartedAt = performance.now();

  const snapshot = await prisma.$transaction(
    async (transaction) => {
      onTiming?.(
        "transaction_establishment",
        performance.now() - transactionStartedAt,
      );
      const queryStartedAt = performance.now();
      const rows = await transaction.$queryRaw<DailyAggregateRow[]>(
        createDashboardAnalyticsQuery(range),
      );
      onTiming?.("analytics_query", performance.now() - queryStartedAt);
      const summary = rows[0];
      if (!summary) {
        throw new Error("La consulta agregada no devolvió los días del período.");
      }
      return { summary, rows };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  onTiming?.(
    "transaction_completion",
    performance.now() - transactionStartedAt,
  );

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
