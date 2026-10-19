import "dotenv/config";

import { Prisma } from "../generated/prisma/client";
import {
  getDashboardAnalytics,
  type DashboardAnalyticsPhase,
} from "../lib/analytics/dashboard";
import { analyticsPrisma } from "../lib/analytics/analytics-prisma";
import { parseDashboardAnalyticsRange } from "../lib/analytics/range";
import { createDashboardAnalyticsQuery } from "../lib/analytics/query";
import { prisma } from "../lib/prisma";

const measuredRuns = 20;
const phases: readonly DashboardAnalyticsPhase[] = [
  "database_call",
  "result_processing",
  "total",
];

type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Actual Total Time"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: PlanNode[];
};

type ExplainRecord = {
  Plan: PlanNode;
  "Planning Time": number;
  "Execution Time": number;
};

type TimedRun = Record<DashboardAnalyticsPhase, number>;

function percentile95(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

function summarize(samples: number[]): {
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
} {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return {
    minMs: Number(sorted[0].toFixed(2)),
    medianMs: Number(median.toFixed(2)),
    p95Ms: Number(percentile95(samples).toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

async function timeQuery(): Promise<TimedRun> {
  const timings = {} as TimedRun;
  await getDashboardAnalytics(range, (phase, milliseconds) => {
    timings[phase] = milliseconds;
  });
  return timings;
}

function flattenPlan(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenPlan)];
}

async function explainQueries(): Promise<
  {
    plan: {
      query: string;
      planningMs: number;
      executionMs: number;
      nodes: Array<{
        nodeType: string;
        relation?: string;
        index?: string;
        rows?: number;
        loops?: number;
        nodeMs?: number;
        sharedHitBlocks?: number;
        sharedReadBlocks?: number;
      }>;
    };
    indexes: Array<{ tableName: string; indexName: string; definition: string }>;
  }
> {
  const rows = await prisma.$queryRaw<
    Array<{ "QUERY PLAN": ExplainRecord[] }>
  >(Prisma.sql`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    ${createDashboardAnalyticsQuery(range)}
  `);
  const explain = rows[0]?.["QUERY PLAN"]?.[0];
  if (!explain) {
    throw new Error("PostgreSQL returned no analytics query plan.");
  }

  const indexRows = await prisma.$queryRaw<
    Array<{ tablename: string; indexname: string; indexdef: string }>
  >(Prisma.sql`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename IN ('Sale', 'Product')
    ORDER BY tablename, indexname
  `);

  return {
    plan: {
      query: "combined_analytics_query",
      planningMs: explain["Planning Time"],
      executionMs: explain["Execution Time"],
      nodes: flattenPlan(explain.Plan).map((node) => ({
        nodeType: node["Node Type"],
        relation: node["Relation Name"],
        index: node["Index Name"],
        rows: node["Actual Rows"],
        loops: node["Actual Loops"],
        nodeMs: node["Actual Total Time"],
        sharedHitBlocks: node["Shared Hit Blocks"],
        sharedReadBlocks: node["Shared Read Blocks"],
      })),
    },
    indexes: indexRows.map((row) => ({
      tableName: row.tablename,
      indexName: row.indexname,
      definition: row.indexdef,
    })),
  };
}

const rangeInput: Record<string, string> = {};
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith("--from=")) {
    rangeInput.from = argument.slice("--from=".length);
  } else if (argument.startsWith("--to=")) {
    rangeInput.to = argument.slice("--to=".length);
  } else {
    throw new Error("Use --from=YYYY-MM-DD y --to=YYYY-MM-DD para fijar el rango.");
  }
}
const parsedRange = parseDashboardAnalyticsRange(rangeInput);
if (!parsedRange.success) {
  throw new Error(parsedRange.message);
}
const range = parsedRange.data;

async function main(): Promise<void> {
  try {
    const firstRun = await timeQuery();
    const subsequentRuns: TimedRun[] = [];
    for (let run = 0; run < measuredRuns; run += 1) {
      subsequentRuns.push(await timeQuery());
    }

    const subsequentByPhase = Object.fromEntries(
      phases.map((phase) => [
        phase,
        summarize(subsequentRuns.map((run) => run[phase])),
      ]),
    );
    const plans = await explainQueries();

    console.log(
      JSON.stringify(
        {
          processId: process.pid,
          range,
          firstQueryInProcess: Object.fromEntries(
            phases.map((phase) => [
              phase,
              Number(firstRun[phase].toFixed(2)),
            ]),
          ),
          subsequentQueriesInSameProcess: {
            runs: measuredRuns,
            phases: subsequentByPhase,
          },
          explainAnalyzeAfterTiming: plans,
        },
        null,
        2,
      ),
    );
  } finally {
    // Timed calls use the analytics client; EXPLAIN and index reads use the
    // shared client. Close both.
    const closed = await Promise.allSettled([
      analyticsPrisma.$disconnect(),
      prisma.$disconnect(),
    ]);
    const failure = closed.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  }
}

main().catch((error: unknown) => {
  console.error("Analytics benchmark failed.");
  throw error;
});
