import { Prisma, SaleStatus } from "../../generated/prisma/client";

import {
  getUtcRangeBounds,
  type DashboardAnalyticsRange,
} from "./range";

export function createDashboardAnalyticsQuery(
  range: DashboardAnalyticsRange,
): Prisma.Sql {
  const { startInclusive, endExclusive } = getUtcRangeBounds(range);

  return Prisma.sql`
    WITH daily AS (
      SELECT
        (date_trunc('day', "saleDate" AT TIME ZONE 'UTC'))::date AS "day",
        SUM("total") AS "amount",
        COUNT(*)::int AS "salesCount"
      FROM "Sale"
      WHERE "status" = CAST(${SaleStatus.COMPLETED} AS "SaleStatus")
        AND "saleDate" >= ${startInclusive}
        AND "saleDate" < ${endExclusive}
      GROUP BY 1
    ),
    summary AS (
      SELECT
        COALESCE(SUM("amount"), 0) AS "amount",
        COALESCE(SUM("salesCount"), 0)::int AS "salesCount",
        CASE
          WHEN SUM("salesCount") IS NULL THEN NULL
          ELSE ROUND(SUM("amount") / SUM("salesCount"), 2)
        END AS "averageTicket"
      FROM daily
    ),
    active_products AS (
      SELECT COUNT(*)::int AS "count"
      FROM "Product"
      WHERE "deletedAt" IS NULL
    ),
    calendar AS (
      SELECT generate_series(
        ${range.from}::date,
        ${range.to}::date,
        interval '1 day'
      )::date AS "day"
    )
    SELECT
      to_char(calendar."day", 'YYYY-MM-DD') AS "day",
      COALESCE(daily."amount", 0)::text AS "amount",
      COALESCE(daily."salesCount", 0)::int AS "salesCount",
      summary."amount"::text AS "completedSalesAmount",
      summary."salesCount" AS "completedSalesCount",
      summary."averageTicket"::text AS "averageTicket",
      active_products."count" AS "activeProductsCount"
    FROM calendar
    LEFT JOIN daily ON daily."day" = calendar."day"
    CROSS JOIN summary
    CROSS JOIN active_products
    ORDER BY calendar."day"
  `;
}
