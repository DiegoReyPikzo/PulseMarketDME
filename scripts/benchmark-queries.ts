import "dotenv/config";

import { performance } from "node:perf_hooks";

import { listCustomers } from "../lib/queries/customers";
import { listProducts } from "../lib/queries/products";
import { listSales } from "../lib/queries/sales";
import { prisma } from "../lib/prisma";

const page = { page: 1, pageSize: 20 };
const measuredRuns = 20;

function percentile95(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const nearestRankIndex = Math.ceil(0.95 * sorted.length) - 1;

  return sorted[nearestRankIndex];
}

async function timeQuery(query: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await query();
  return performance.now() - start;
}

async function measure(
  name: string,
  query: () => Promise<unknown>,
): Promise<void> {
  const firstRunMs = await timeQuery(query);
  const samples: number[] = [];

  for (let run = 0; run < measuredRuns; run += 1) {
    samples.push(await timeQuery(query));
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  console.log(
    JSON.stringify({
      listing: name,
      pageSize: page.pageSize,
      measuredRuns,
      firstRunMs: Number(firstRunMs.toFixed(2)),
      minMs: Number(sorted[0].toFixed(2)),
      medianMs: Number(median.toFixed(2)),
      p95Ms: Number(percentile95(samples).toFixed(2)),
      maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    }),
  );
}

async function main(): Promise<void> {
  try {
    await measure("products", () => listProducts(page));
    await measure("customers", () => listCustomers(page));
    await measure("sales", () => listSales(page));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Query benchmark failed.");
  throw error;
});
