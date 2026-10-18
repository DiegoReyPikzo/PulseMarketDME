import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import {
  E2E_TARGET_FILE,
  loadSeedTarget,
  PRODUCTION_TARGET_FILE,
  SEED_TARGET_HOST_KEY,
  SeedTargetError,
  validateSeedTarget,
} from "../../lib/seed-target";
import {
  buildSeedDataset,
  checkDatasetIntegrity,
  normalizeDataset,
  normalizeRow,
  SALE_WINDOW_END,
  SALE_WINDOW_START,
  SEED_DELETED_AT,
  SEED_EXPECTED,
  SEED_PREFIX,
  seedId,
  type NormalizedDataset,
  type NormalizedRow,
  type SeedDataset,
} from "../../prisma/seed-data";
import {
  batchSize,
  MAX_BIND_PARAMETERS,
  runSeedTransaction,
  SeedConflictError,
  SeedVerificationError,
  type ConflictKeys,
  type SeedStore,
} from "../../prisma/seed";

type Table = keyof SeedDataset;
const TABLES: readonly Table[] = ["products", "customers", "sales", "saleItems"];

const dataset = buildSeedDataset();
const normalized = normalizeDataset(dataset);

function cents(value: unknown): number {
  const [whole, fraction] = String(value).split(".");
  return Number(whole) * 100 + Number(fraction);
}

// --- Generator ------------------------------------------------------------

test("generator is deterministic", () => {
  assert.deepEqual(normalizeDataset(buildSeedDataset()), normalized);
});

test("generator produces the exact volumes, statuses and soft deletions", () => {
  assert.equal(normalized.products.length, SEED_EXPECTED.products.total);
  assert.equal(normalized.customers.length, SEED_EXPECTED.customers.total);
  assert.equal(normalized.sales.length, SEED_EXPECTED.sales.total);
  assert.equal(normalized.saleItems.length, SEED_EXPECTED.saleItems.total);
  assert.equal(normalized.products.filter((row) => row.deletedAt).length, 50);
  assert.equal(normalized.customers.filter((row) => row.deletedAt).length, 90);
  const byStatus: Record<string, number> = {};
  for (const sale of normalized.sales) byStatus[String(sale.status)] = (byStatus[String(sale.status)] ?? 0) + 1;
  assert.deepEqual(byStatus, { COMPLETED: 5_600, PENDING: 800, CANCELLED: 800, REFUNDED: 800 });
  // The strict reading of the guidelines: sale items are not counted.
  assert.equal(normalized.products.length + normalized.customers.length + normalized.sales.length, 12_000);
  const itemsPerSale = new Map<unknown, number>();
  for (const item of normalized.saleItems) itemsPerSale.set(item.saleId, (itemsPerSale.get(item.saleId) ?? 0) + 1);
  const distribution: Record<number, number> = {};
  for (const count of itemsPerSale.values()) distribution[count] = (distribution[count] ?? 0) + 1;
  assert.deepEqual(distribution, { 1: 1_600, 2: 1_600, 3: 1_600, 4: 1_600, 5: 1_600 });
});

test("generator keys are unique and never overlap the v1 sample data", () => {
  for (const table of TABLES) {
    const rows = normalized[table];
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
    assert.equal(new Set(rows.map((row) => row.seedKey)).size, rows.length);
    assert.ok(rows.every((row) => String(row.seedKey).startsWith(`${SEED_PREFIX}:`)));
    // v1 IDs used namespaces 1–4 (suffix below 5e9); v2 starts at 11e9.
    assert.ok(rows.every((row) => parseInt(String(row.id).slice(-12), 16) >= 11_000_000_000));
  }
  assert.ok(normalized.products.every((row) => String(row.sku).startsWith("PM2-")));
  assert.ok(normalized.customers.every((row) => String(row.email).startsWith("customer-v2-")));
  assert.equal(new Set(normalized.products.map((row) => row.sku)).size, 1_000);
  assert.equal(new Set(normalized.customers.map((row) => row.email)).size, 3_000);
  assert.ok(normalized.customers.every((row) => row.email === String(row.email).trim().toLowerCase()));
});

test("generator relations are coherent and every customer has sales", () => {
  const productIds = new Set(normalized.products.map((row) => row.id));
  const customerIds = new Set(normalized.customers.map((row) => row.id));
  const saleIds = new Set(normalized.sales.map((row) => row.id));
  assert.ok(normalized.sales.every((sale) => customerIds.has(sale.customerId)));
  assert.ok(normalized.saleItems.every((item) => saleIds.has(item.saleId) && productIds.has(item.productId)));
  assert.equal(new Set(normalized.sales.map((sale) => sale.customerId)).size, 3_000);
  const pairs = normalized.saleItems.map((item) => `${item.saleId}|${item.productId}`);
  assert.equal(new Set(pairs).size, pairs.length);
});

test("generator Decimal amounts are exact", () => {
  const price = new Map(normalized.products.map((row) => [row.id, cents(row.price)]));
  const sums = new Map<unknown, number>();
  for (const item of normalized.saleItems) {
    assert.match(String(item.unitPrice), /^\d+\.\d{2}$/);
    assert.equal(cents(item.unitPrice), price.get(item.productId));
    assert.equal(cents(item.lineTotal), cents(item.unitPrice) * Number(item.quantity));
    sums.set(item.saleId, (sums.get(item.saleId) ?? 0) + cents(item.lineTotal));
  }
  for (const sale of normalized.sales) assert.equal(cents(sale.total), sums.get(sale.id));
  const totalCents = normalized.sales.reduce((sum, sale) => sum + cents(sale.total), 0);
  assert.equal(totalCents, 1_818_804_000);
  assert.equal(Math.min(...normalized.products.map((row) => cents(row.price))), 316);
  assert.equal(Math.max(...normalized.products.map((row) => cents(row.price))), 50_234);
  assert.equal(Math.max(...normalized.sales.map((row) => cents(row.total))), 692_830);
});

test("generator dates have exact fixed bounds independent of the run date", () => {
  assert.equal(SALE_WINDOW_START.toISOString(), "2024-10-18T00:00:00.000Z");
  assert.equal(SALE_WINDOW_END.toISOString(), "2026-10-18T00:00:00.000Z");
  assert.equal(SEED_DELETED_AT.toISOString(), "2026-10-18T00:00:00.000Z");
  const saleDates = normalized.sales.map((sale) => String(sale.saleDate)).sort();
  assert.equal(saleDates[0], "2024-10-18T00:37:00.000Z");
  assert.equal(saleDates.at(-1), "2026-10-17T19:30:00.000Z");
  // Catalog and customers exist before the first sale.
  const created = [...normalized.products, ...normalized.customers].map((row) => String(row.createdAt)).sort();
  assert.equal(created[0], "2024-10-01T00:00:00.000Z");
  assert.equal(created.at(-1), "2024-10-04T01:59:00.000Z");
  for (const row of [...normalized.products, ...normalized.customers]) {
    assert.equal(row.updatedAt, row.deletedAt ?? row.createdAt);
  }
  for (const sale of normalized.sales) {
    assert.equal(sale.createdAt, sale.saleDate);
    assert.equal(sale.updatedAt, sale.saleDate);
  }
});

test("integrity check accepts the generated data and reports corrupted copies", () => {
  assert.deepEqual(checkDatasetIntegrity(normalized), []);
  const corrupt = (mutate: (copy: NormalizedDataset) => void) => {
    const copy = structuredClone(normalized);
    mutate(copy);
    return checkDatasetIntegrity(copy);
  };
  assert.ok(corrupt((copy) => { copy.saleItems[0].lineTotal = "0.01"; }).length > 0);
  assert.ok(corrupt((copy) => { copy.sales[0].customerId = seedId("customer", 9_999); }).length > 0);
  assert.ok(corrupt((copy) => { copy.sales[0].saleDate = "2030-01-01T00:00:00.000Z"; }).length > 0);
  assert.ok(corrupt((copy) => { copy.saleItems[1].productId = copy.saleItems[2].productId; }).length > 0);
  assert.ok(corrupt((copy) => { copy.products.pop(); }).length > 0);
});

// --- Target guard (fictitious hosts and credentials only) -----------------

const FAKE_SECRET = "fake-secret-value";
const hosts = {
  production: "ep-prod-111111.us-east-2.aws.neon.tech",
  productionPooled: "ep-prod-111111-pooler.us-east-2.aws.neon.tech",
  e2e: "ep-e2e-222222.us-east-2.aws.neon.tech",
  e2ePooled: "ep-e2e-222222-pooler.us-east-2.aws.neon.tech",
  branch: "ep-branch-333333-pooler.us-east-2.aws.neon.tech",
};
const productionTarget = {
  PROD_ALLOWED_DIRECT_HOST: hosts.production,
  PROD_ALLOWED_POOLED_HOST: hosts.productionPooled,
};
const e2eTarget = {
  E2E_ALLOWED_DIRECT_HOST: hosts.e2e,
  E2E_ALLOWED_POOLED_HOST: hosts.e2ePooled,
};
const urlFor = (host: string, query = "?sslmode=require") =>
  `postgresql://seed_user:${FAKE_SECRET}@${host}/neondb${query}`;
const environmentFor = (host: string, extra: Record<string, string> = {}) => ({
  DATABASE_URL: urlFor(host),
  [SEED_TARGET_HOST_KEY]: host,
  ...extra,
});

function rejects(
  input: Parameters<typeof validateSeedTarget>[0],
  pattern: RegExp,
) {
  assert.throws(
    () => validateSeedTarget(input),
    (error: unknown) => {
      assert.ok(error instanceof SeedTargetError);
      assert.match(error.message, pattern);
      // Errors never echo credentials or connection strings.
      assert.ok(!error.message.includes(FAKE_SECRET));
      assert.ok(!error.message.includes("postgresql://"));
      return true;
    },
  );
}

test("guard accepts an explicitly confirmed isolated Neon branch", () => {
  const target = validateSeedTarget({
    environment: environmentFor(hosts.branch),
    productionTarget,
    e2eTarget,
  });
  assert.equal(target.host, hosts.branch);
  assert.equal(target.endpointId, "ep-branch-333333");
});

test("guard rejects the Production endpoint through its direct and pooled hosts", () => {
  for (const host of [hosts.production, hosts.productionPooled]) {
    rejects({ environment: environmentFor(host), productionTarget, e2eTarget }, /Production endpoint/);
  }
});

test("guard rejects the E2E endpoint and E2E environment variables", () => {
  for (const host of [hosts.e2e, hosts.e2ePooled]) {
    rejects({ environment: environmentFor(host), productionTarget, e2eTarget }, /E2E endpoint/);
  }
  rejects(
    { environment: environmentFor(hosts.branch, { E2E_DATABASE_URL: urlFor(hosts.e2e) }), productionTarget, e2eTarget },
    /E2E environment variables/,
  );
});

test("guard rejects CI and the production wrapper environment", () => {
  rejects({ environment: environmentFor(hosts.branch, { CI: "true" }), productionTarget, e2eTarget }, /CI/);
  rejects({ environment: environmentFor(hosts.branch, { GITHUB_ACTIONS: "true" }), productionTarget, e2eTarget }, /CI/);
  rejects(
    { environment: environmentFor(hosts.branch, { PULSEMARKET_DB_TARGET_KIND: "production" }), productionTarget, e2eTarget },
    /production database wrapper/,
  );
});

test("guard rejects when protected targets cannot be identified", () => {
  rejects({ environment: environmentFor(hosts.branch), productionTarget: undefined, e2eTarget }, /Production/);
  rejects({ environment: environmentFor(hosts.branch), productionTarget, e2eTarget: undefined }, /E2E/);
  rejects(
    { environment: environmentFor(hosts.branch), productionTarget: { PROD_ALLOWED_DIRECT_HOST: hosts.production }, e2eTarget },
    /PROD_ALLOWED_POOLED_HOST/,
  );
  rejects(
    { environment: environmentFor(hosts.branch), productionTarget: { ...productionTarget, PROD_ALLOWED_DIRECT_HOST: "localhost" }, e2eTarget },
    /Neon host names/,
  );
});

test("guard rejects a missing or different confirmation host", () => {
  rejects({ environment: { DATABASE_URL: urlFor(hosts.branch) }, productionTarget, e2eTarget }, new RegExp(SEED_TARGET_HOST_KEY));
  rejects(
    { environment: { DATABASE_URL: urlFor(hosts.branch), [SEED_TARGET_HOST_KEY]: "ep-other-444444.us-east-2.aws.neon.tech" }, productionTarget, e2eTarget },
    /does not match/,
  );
});

test("guard rejects invalid, incomplete, redirecting or non-Neon URLs", () => {
  const withUrl = (url: string, host = hosts.branch) => ({
    environment: { DATABASE_URL: url, [SEED_TARGET_HOST_KEY]: host },
    productionTarget,
    e2eTarget,
  });
  rejects({ environment: {}, productionTarget, e2eTarget }, /DATABASE_URL must be set/);
  rejects(withUrl(`not a url ${FAKE_SECRET}`), /not a valid PostgreSQL URL/);
  rejects(withUrl(`mysql://seed_user:${FAKE_SECRET}@${hosts.branch}/neondb`), /not a complete PostgreSQL URL/);
  rejects(withUrl(`postgresql://seed_user@${hosts.branch}/neondb`), /not a complete PostgreSQL URL/);
  rejects(withUrl(urlFor(hosts.branch, `?host=${hosts.production}`)), /unsupported query parameters: host/);
  rejects(withUrl(urlFor("db.example.com"), "db.example.com"), /Neon host/);
});

test("guard loads the protected targets from the existing target files and rejects when they are missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "seed-target-"));
  try {
    rejects(
      { environment: environmentFor(hosts.branch), productionTarget: undefined, e2eTarget: undefined },
      /Production/,
    );
    assert.throws(() => loadSeedTarget(directory, environmentFor(hosts.branch)), SeedTargetError);
    writeFileSync(
      join(directory, PRODUCTION_TARGET_FILE),
      `PROD_ALLOWED_DIRECT_HOST=${hosts.production}\nPROD_ALLOWED_POOLED_HOST=${hosts.productionPooled}\n`,
    );
    assert.throws(() => loadSeedTarget(directory, environmentFor(hosts.branch)), /E2E/);
    writeFileSync(
      join(directory, E2E_TARGET_FILE),
      `E2E_ALLOWED_DIRECT_HOST=${hosts.e2e}\nE2E_ALLOWED_POOLED_HOST=${hosts.e2ePooled}\n`,
    );
    assert.equal(loadSeedTarget(directory, environmentFor(hosts.branch)).endpointId, "ep-branch-333333");
    assert.throws(() => loadSeedTarget(directory, environmentFor(hosts.productionPooled)), /Production endpoint/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// --- Orchestration with an in-memory store --------------------------------
// This simulates unique keys, foreign keys and rollback in memory. It checks
// the seed's control flow; it does not verify PostgreSQL transactions.

type MemoryState = Record<Table, NormalizedRow[]>;

const MODEL_PREFIX: Record<Table, string> = {
  products: `${SEED_PREFIX}:product:`,
  customers: `${SEED_PREFIX}:customer:`,
  sales: `${SEED_PREFIX}:sale:`,
  saleItems: `${SEED_PREFIX}:saleItem:`,
};

class MemoryStore implements SeedStore {
  state: MemoryState = { products: [], customers: [], sales: [], saleItems: [] };
  calls: string[] = [];
  insertBatches: Array<{ table: Table; rows: number; columns: number }> = [];
  failOnInsertCall?: number;
  corruptReadBack = false;
  changeOtherRowsDuringSeed = false;
  private insertCalls = 0;

  async fingerprintOtherRows(table: Table) {
    this.calls.push(`fingerprint:${table}`);
    if (this.changeOtherRowsDuringSeed && this.insertCalls > 0 && table === "products") {
      const foreign = this.state.products.find((row) => !String(row.seedKey ?? "").startsWith(`${SEED_PREFIX}:`));
      if (foreign) foreign.name = `${foreign.name} changed`;
    }
    const rows = this.state[table]
      .filter((row) => !String(row.seedKey ?? "").startsWith(`${SEED_PREFIX}:`))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return { count: rows.length, digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }

  async findConflictCandidates(table: Table, keys: ConflictKeys) {
    this.calls.push(`conflicts:${table}`);
    const skus = new Set(keys.skus ?? []);
    const emails = new Set(keys.emails ?? []);
    const inRange = (value: unknown, range?: readonly [string, string]) =>
      range !== undefined && String(value) >= range[0] && String(value) <= range[1];
    return this.state[table]
      .filter(
        (row) =>
          inRange(row.id, keys.idRange) ||
          String(row.seedKey ?? "").startsWith(keys.seedKeyPrefix) ||
          skus.has(String(row.sku)) ||
          emails.has(String(row.email)) ||
          inRange(row.saleId, keys.saleIdRange),
      )
      .map((row) => ({ ...row }));
  }

  async insert(table: Table, rows: readonly object[]) {
    this.insertCalls += 1;
    this.calls.push(`insert:${table}`);
    this.insertBatches.push({ table, rows: rows.length, columns: Object.keys(rows[0]).length });
    if (this.failOnInsertCall === this.insertCalls) {
      throw new Error("simulated database failure");
    }
    const existing = this.state[table];
    const uniqueFields = ["id", "seedKey", "sku", "email"];
    const taken = new Map(
      uniqueFields.map((field) => [field, new Set(existing.map((row) => row[field]).filter((value) => value !== null && value !== undefined))]),
    );
    const pairs = new Set(existing.map((row) => `${row.saleId}|${row.productId}`));
    const ids = (target: Table) => new Set(this.state[target].map((row) => row.id));
    const customerIds = ids("customers");
    const saleIds = ids("sales");
    const productIds = ids("products");
    const accepted: NormalizedRow[] = [];
    for (const input of rows) {
      const row = normalizeRow(input);
      for (const field of uniqueFields) {
        const value = row[field];
        if (value === null || value === undefined) continue;
        if (taken.get(field)!.has(value)) throw new Error("simulated unique violation");
        taken.get(field)!.add(value);
      }
      if (table === "saleItems") {
        const pair = `${row.saleId}|${row.productId}`;
        if (pairs.has(pair)) throw new Error("simulated unique violation");
        pairs.add(pair);
      }
      if (
        (table === "sales" && !customerIds.has(row.customerId)) ||
        (table === "saleItems" && (!saleIds.has(row.saleId) || !productIds.has(row.productId)))
      ) {
        throw new Error("simulated foreign key violation");
      }
      accepted.push(row);
    }
    // A statement either inserts the whole batch or nothing.
    existing.push(...accepted);
    return rows.length;
  }

  async readSeededRows(table: Table) {
    this.calls.push(`read:${table}`);
    const rows = this.state[table]
      .filter((row) => String(row.seedKey ?? "").startsWith(MODEL_PREFIX[table]))
      .map((row) => ({ ...row }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    if (this.corruptReadBack && table === "sales") rows[0].total = "0.01";
    return rows;
  }

  // Stands in for prisma.$transaction: any error restores the snapshot.
  async transaction<T>(work: (store: SeedStore) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await work(this);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }
}

function foreignRows(): MemoryState {
  return {
    products: [normalizeRow({ id: "00000000-0000-4000-8000-000000000001", sku: "REAL-1", name: "Real product", description: null, category: "Real", price: "9.99", stock: 3, sortOrder: 0, deletedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", seedKey: null })],
    customers: [normalizeRow({ id: "00000000-0000-4000-8000-000000000002", name: "Real customer", email: "real@example.test", phone: null, deletedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", seedKey: null })],
    sales: [],
    saleItems: [],
  };
}

test("first run inserts every v2 row in parameter-sized batches and leaves other rows unchanged", async () => {
  const store = new MemoryStore();
  store.state = foreignRows();
  const before = structuredClone(store.state);
  const summary = await store.transaction((tx) => runSeedTransaction(tx, dataset));

  assert.deepEqual(summary.inserted, { products: 1_000, customers: 3_000, sales: 8_000, saleItems: 24_000 });
  assert.deepEqual(summary.alreadyPresent, { products: 0, customers: 0, sales: 0, saleItems: 0 });
  assert.deepEqual(summary.otherRowsUnchanged, { products: 1, customers: 1, sales: 0, saleItems: 0 });
  assert.deepEqual(store.state.products[0], before.products[0]);
  assert.deepEqual(store.state.customers[0], before.customers[0]);
  // Fingerprints and conflict checks run before the first insert.
  const firstInsert = store.calls.findIndex((call) => call.startsWith("insert:"));
  assert.ok(store.calls.slice(0, firstInsert).filter((call) => call.startsWith("fingerprint:")).length === 4);
  assert.ok(store.calls.slice(0, firstInsert).filter((call) => call.startsWith("conflicts:")).length === 4);
  for (const batch of store.insertBatches) {
    assert.ok(batch.rows * batch.columns <= MAX_BIND_PARAMETERS);
  }
  assert.deepEqual(
    store.insertBatches.map((batch) => `${batch.table}:${batch.rows}`),
    ["products:1000", "customers:3000", "sales:4095", "sales:3905", "saleItems:4095", "saleItems:4095", "saleItems:4095", "saleItems:4095", "saleItems:4095", "saleItems:3525"],
  );
});

test("batch size follows the inserted column count", () => {
  assert.equal(batchSize(dataset.products), Math.floor(MAX_BIND_PARAMETERS / 12));
  assert.equal(batchSize(dataset.saleItems), Math.floor(MAX_BIND_PARAMETERS / 8));
  assert.throws(() => batchSize([{ a: 1 }, { a: 1, b: 2 }]), /same columns/);
});

test("a repeated run with unchanged data inserts nothing", async () => {
  const store = new MemoryStore();
  await store.transaction((tx) => runSeedTransaction(tx, dataset));
  store.insertBatches = [];
  const summary = await store.transaction((tx) => runSeedTransaction(tx, dataset));
  assert.deepEqual(summary.inserted, { products: 0, customers: 0, sales: 0, saleItems: 0 });
  assert.deepEqual(summary.alreadyPresent, { products: 1_000, customers: 3_000, sales: 8_000, saleItems: 24_000 });
  assert.equal(store.insertBatches.length, 0);
});

test("coherent partial data is completed without touching the rows already present", async () => {
  const store = new MemoryStore();
  store.state.products = normalized.products.map((row) => ({ ...row }));
  store.state.customers = normalized.customers.slice(0, 100).map((row) => ({ ...row }));
  const summary = await store.transaction((tx) => runSeedTransaction(tx, dataset));
  assert.equal(summary.alreadyPresent.products, 1_000);
  assert.equal(summary.alreadyPresent.customers, 100);
  assert.equal(summary.inserted.products, 0);
  assert.equal(summary.inserted.customers, 2_900);
  assert.equal(summary.inserted.saleItems, 24_000);
});

test("divergent v2 rows abort without overwriting or inserting anything", async () => {
  const store = new MemoryStore();
  store.state.products = normalized.products.map((row) => ({ ...row }));
  store.state.products[5].price = "1.00";
  const before = structuredClone(store.state);
  await assert.rejects(
    store.transaction((tx) => runSeedTransaction(tx, dataset)),
    (error: unknown) => error instanceof SeedConflictError && /products: 1 existing v2 sample row\(s\) differ/.test(error.message),
  );
  assert.deepEqual(store.state, before);
  assert.equal(store.insertBatches.length, 0);
});

test("collisions with other data on reserved unique values abort without writing", async () => {
  const collisions: Array<[Table, NormalizedRow]> = [
    ["products", { ...foreignRows().products[0], sku: "PM2-0001" }],
    ["customers", { ...foreignRows().customers[0], email: "customer-v2-00007@seed.pulsemarket.example" }],
    ["products", { ...foreignRows().products[0], id: seedId("product", 3), seedKey: null }],
  ];
  for (const [table, row] of collisions) {
    const store = new MemoryStore();
    store.state[table] = [row];
    const before = structuredClone(store.state);
    await assert.rejects(
      store.transaction((tx) => runSeedTransaction(tx, dataset)),
      (error: unknown) => error instanceof SeedConflictError && /reserved for the v2 sample data/.test(error.message),
    );
    assert.deepEqual(store.state, before);
    assert.equal(store.insertBatches.length, 0);
  }
});

test("insert, verification and fingerprint failures propagate so the transaction rolls back", async () => {
  const failing = new MemoryStore();
  failing.failOnInsertCall = 4;
  await assert.rejects(
    failing.transaction((tx) => runSeedTransaction(tx, dataset)),
    /simulated database failure/,
  );
  assert.deepEqual(failing.state, { products: [], customers: [], sales: [], saleItems: [] });

  const corrupted = new MemoryStore();
  corrupted.corruptReadBack = true;
  await assert.rejects(
    corrupted.transaction((tx) => runSeedTransaction(tx, dataset)),
    (error: unknown) => error instanceof SeedVerificationError && /sales: stored v2 rows do not match/.test(error.message),
  );
  assert.equal(corrupted.state.sales.length, 0);

  const changed = new MemoryStore();
  changed.state = foreignRows();
  changed.changeOtherRowsDuringSeed = true;
  await assert.rejects(
    changed.transaction((tx) => runSeedTransaction(tx, dataset)),
    (error: unknown) => error instanceof SeedVerificationError && /products: rows outside the v2 sample data changed/.test(error.message),
  );
  assert.deepEqual(changed.state, foreignRows());
});
