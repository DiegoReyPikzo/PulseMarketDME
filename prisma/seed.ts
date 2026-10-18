import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../generated/prisma/client";
import { loadSeedTarget } from "../lib/seed-target";
import {
  buildSeedDataset,
  checkDatasetIntegrity,
  normalizeDataset,
  normalizeRow,
  seedId,
  SEED_PREFIX,
  type NormalizedRow,
  type SeedDataset,
  type SeedModel,
} from "./seed-data";

// v2 sample-data seed: insert-only, all-or-nothing, and never run against
// Production or the E2E database (see lib/seed-target.ts).

type Table = keyof SeedDataset;

// Insertion order follows the foreign keys.
const TABLES: readonly Table[] = ["products", "customers", "sales", "saleItems"];

const MODEL_OF: Record<Table, SeedModel> = {
  products: "product",
  customers: "customer",
  sales: "sale",
  saleItems: "saleItem",
};

const COUNT_OF: Record<Table, number> = {
  products: 1_000,
  customers: 3_000,
  sales: 8_000,
  saleItems: 24_000,
};

// Prisma's PostgreSQL bind-parameter budget per statement (PostgreSQL itself
// allows 65,535). Batches are sized from the inserted column count.
export const MAX_BIND_PARAMETERS = 32_767;

export function batchSize(rows: readonly object[]): number {
  if (rows.length === 0) return 0;
  const columns = Object.keys(rows[0]).sort().join(",");
  if (rows.some((row) => Object.keys(row).sort().join(",") !== columns)) {
    throw new Error("Seed rows must all insert the same columns.");
  }
  return Math.floor(MAX_BIND_PARAMETERS / Object.keys(rows[0]).length);
}

// Rows that could clash with a v2 row: the v2 ID range, the v2 seed keys,
// and the other unique values the v2 rows will take.
export type ConflictKeys = {
  idRange: readonly [string, string];
  seedKeyPrefix: string;
  skus?: readonly string[];
  emails?: readonly string[];
  saleIdRange?: readonly [string, string];
};

export type TableFingerprint = { count: number; digest: string };

// Database operations used by the seed, implemented with Prisma inside one
// transaction (createPrismaSeedStore) or in memory for offline tests.
export interface SeedStore {
  fingerprintOtherRows(table: Table): Promise<TableFingerprint>;
  findConflictCandidates(table: Table, keys: ConflictKeys): Promise<NormalizedRow[]>;
  insert(table: Table, rows: readonly object[]): Promise<number>;
  readSeededRows(table: Table): Promise<NormalizedRow[]>;
}

export class SeedConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConflictError";
  }
}

export class SeedVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedVerificationError";
  }
}

export type SeedSummary = {
  inserted: Record<Table, number>;
  alreadyPresent: Record<Table, number>;
  otherRowsUnchanged: Record<Table, number>;
};

function sameRow(left: NormalizedRow, right: NormalizedRow): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? null) !== (right[key] ?? null)) return false;
  }
  return true;
}

function conflictKeys(table: Table, rows: readonly NormalizedRow[]): ConflictKeys {
  const model = MODEL_OF[table];
  return {
    idRange: [seedId(model, 1), seedId(model, COUNT_OF[table])],
    seedKeyPrefix: `${SEED_PREFIX}:${model}:`,
    ...(table === "products" ? { skus: rows.map((row) => String(row.sku)) } : {}),
    ...(table === "customers" ? { emails: rows.map((row) => String(row.email)) } : {}),
    ...(table === "saleItems"
      ? { saleIdRange: [seedId("sale", 1), seedId("sale", COUNT_OF.sales)] as const }
      : {}),
  };
}

// Runs inside the caller's transaction. Any thrown error must roll it back:
// nothing here catches errors.
export async function runSeedTransaction(
  store: SeedStore,
  dataset: SeedDataset,
): Promise<SeedSummary> {
  const expected = normalizeDataset(dataset);
  const summary: SeedSummary = {
    inserted: { products: 0, customers: 0, sales: 0, saleItems: 0 },
    alreadyPresent: { products: 0, customers: 0, sales: 0, saleItems: 0 },
    otherRowsUnchanged: { products: 0, customers: 0, sales: 0, saleItems: 0 },
  };

  // Fingerprint of every row that is not v2 sample data, taken in the same
  // transaction snapshot before and after the inserts.
  const before = new Map<Table, TableFingerprint>();
  for (const table of TABLES) {
    before.set(table, await store.fingerprintOtherRows(table));
  }

  const missing = new Map<Table, object[]>();
  for (const table of TABLES) {
    const expectedById = new Map(expected[table].map((row) => [row.id, row]));
    const candidates = await store.findConflictCandidates(
      table,
      conflictKeys(table, expected[table]),
    );
    const present = new Set<string | number | null>();
    let collisions = 0;
    let divergent = 0;
    for (const candidate of candidates) {
      const match = expectedById.get(candidate.id);
      // A row is v2 sample data only if both its ID and seed key are ours;
      // anything else holding a reserved value belongs to other data.
      if (!match || candidate.seedKey !== match.seedKey) collisions += 1;
      else if (!sameRow(candidate, match)) divergent += 1;
      else present.add(candidate.id);
    }
    if (collisions > 0) {
      throw new SeedConflictError(
        `${table}: ${collisions} existing row(s) already use IDs, seed keys or unique values reserved for the v2 sample data. Nothing was written.`,
      );
    }
    if (divergent > 0) {
      throw new SeedConflictError(
        `${table}: ${divergent} existing v2 sample row(s) differ from the generated data. Nothing was overwritten.`,
      );
    }
    summary.alreadyPresent[table] = present.size;
    missing.set(
      table,
      dataset[table].filter((row) => !present.has((row as { id: string }).id)),
    );
  }

  for (const table of TABLES) {
    const rows = missing.get(table) ?? [];
    const size = batchSize(rows);
    for (let start = 0; start < rows.length; start += size) {
      const batch = rows.slice(start, start + size);
      const count = await store.insert(table, batch);
      if (count !== batch.length) {
        throw new SeedVerificationError(
          `${table}: inserted ${count} of ${batch.length} rows in a batch.`,
        );
      }
      summary.inserted[table] += count;
    }
  }

  // Read the v2 rows back: they must match the generated data exactly and
  // pass the integrity checks on their own.
  const stored = {} as Record<Table, NormalizedRow[]>;
  for (const table of TABLES) {
    stored[table] = await store.readSeededRows(table);
    const expectedById = new Map(expected[table].map((row) => [row.id, row]));
    const mismatched = stored[table].filter((row) => {
      const match = expectedById.get(row.id);
      return !match || !sameRow(row, match);
    }).length;
    if (stored[table].length !== expected[table].length || mismatched > 0) {
      throw new SeedVerificationError(
        `${table}: stored v2 rows do not match the generated data (${stored[table].length} stored, ${mismatched} different).`,
      );
    }
  }
  const problems = checkDatasetIntegrity(stored);
  if (problems.length > 0) {
    throw new SeedVerificationError(`Stored v2 data failed integrity checks: ${problems.join(" ")}`);
  }

  for (const table of TABLES) {
    const after = await store.fingerprintOtherRows(table);
    const previous = before.get(table)!;
    if (after.count !== previous.count || after.digest !== previous.digest) {
      throw new SeedVerificationError(
        `${table}: rows outside the v2 sample data changed during the seed.`,
      );
    }
    summary.otherRowsUnchanged[table] = after.count;
  }

  return summary;
}

const TABLE_SQL: Record<Table, string> = {
  products: '"Product"',
  customers: '"Customer"',
  sales: '"Sale"',
  saleItems: '"SaleItem"',
};

export function createPrismaSeedStore(transaction: Prisma.TransactionClient): SeedStore {
  const delegates = {
    products: transaction.product,
    customers: transaction.customer,
    sales: transaction.sale,
    saleItems: transaction.saleItem,
  };
  const seededPrefix = (table: Table) => `${SEED_PREFIX}:${MODEL_OF[table]}:`;

  return {
    async fingerprintOtherRows(table) {
      // Digest of every persisted column of every non-v2 row, ordered by ID.
      // Only the count and the hash leave the database.
      const rows = await transaction.$queryRaw<Array<{ count: number; digest: string }>>(
        Prisma.sql`
          SELECT count(*)::int AS count,
                 coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id)), '') AS digest
          FROM ${Prisma.raw(TABLE_SQL[table])} AS t
          WHERE t."seedKey" IS NULL OR t."seedKey" NOT LIKE ${`${SEED_PREFIX}:%`}
        `,
      );
      return { count: rows[0]?.count ?? 0, digest: rows[0]?.digest ?? "" };
    },
    async findConflictCandidates(table, keys) {
      const or: object[] = [
        { id: { gte: keys.idRange[0], lte: keys.idRange[1] } },
        { seedKey: { startsWith: keys.seedKeyPrefix } },
      ];
      if (keys.skus) or.push({ sku: { in: [...keys.skus] } });
      if (keys.emails) or.push({ email: { in: [...keys.emails] } });
      if (keys.saleIdRange) {
        or.push({ saleId: { gte: keys.saleIdRange[0], lte: keys.saleIdRange[1] } });
      }
      // The delegates share findMany semantics; the union type is not callable.
      const delegate = delegates[table] as unknown as {
        findMany(args: object): Promise<object[]>;
      };
      return (await delegate.findMany({ where: { OR: or } })).map(normalizeRow);
    },
    async insert(table, rows) {
      // No skipDuplicates: a unique violation aborts the whole transaction.
      const delegate = delegates[table] as unknown as {
        createMany(args: { data: object[] }): Promise<{ count: number }>;
      };
      return (await delegate.createMany({ data: [...rows] })).count;
    },
    async readSeededRows(table) {
      const delegate = delegates[table] as unknown as {
        findMany(args: object): Promise<object[]>;
      };
      const rows = await delegate.findMany({
        where: { seedKey: { startsWith: seededPrefix(table) } },
        orderBy: { id: "asc" },
      });
      return rows.map(normalizeRow);
    },
  };
}

async function main(): Promise<void> {
  // Validate the destination before any database client exists.
  const target = loadSeedTarget();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: target.connectionString }),
  });
  try {
    const dataset = buildSeedDataset();
    const summary = await prisma.$transaction(
      (transaction) => runSeedTransaction(createPrismaSeedStore(transaction), dataset),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 30_000,
        timeout: 600_000,
      },
    );
    console.log(`Seed v2 target endpoint: ${target.endpointId}`);
    for (const table of TABLES) {
      console.log(
        `${table}: inserted ${summary.inserted[table]}, already present ${summary.alreadyPresent[table]}, other rows unchanged ${summary.otherRowsUnchanged[table]}`,
      );
    }
    console.log("Seed v2 rows, relations, Decimal totals and other rows: verified");
  } finally {
    await prisma.$disconnect();
  }
}

const runDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (runDirectly) {
  main().catch((error: unknown) => {
    console.error("PulseMarket seed failed.");
    // Seed errors carry table names and counts only. Database and driver
    // errors may echo connection details or row values, so only their type
    // and code are shown.
    if (error instanceof Error && /^Seed(Target|Conflict|Verification)Error$/.test(error.name)) {
      console.error(`${error.name}: ${error.message}`);
    } else if (error instanceof Error) {
      const code = (error as { code?: unknown }).code;
      console.error(`${error.name}${typeof code === "string" ? ` (${code})` : ""}`);
    } else {
      console.error("Unknown error.");
    }
    process.exitCode = 1;
  });
}
