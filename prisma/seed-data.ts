import { Prisma, SaleStatus } from "../generated/prisma/client";

// Deterministic v2 sample data. Pure: no database access and no dependency on
// the current date. Every timestamp derives from SEED_REFERENCE_DATE.

export const SEED_PREFIX = "pulsemarket-seed-v2";

// Last calendar day (UTC) covered by sample sales. Fixed so repeated runs and
// different machines produce identical rows.
export const SEED_REFERENCE_DATE = new Date("2026-10-17T00:00:00.000Z");

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export const SALE_DAY_SPAN = 730;
// First sale day: 729 days before the reference date (2024-10-18).
export const SALE_WINDOW_START = new Date(
  SEED_REFERENCE_DATE.getTime() - (SALE_DAY_SPAN - 1) * DAY_MS,
);
// Exclusive upper bound: the end of the reference date.
export const SALE_WINDOW_END = new Date(SEED_REFERENCE_DATE.getTime() + DAY_MS);
// Catalog and customers exist before the first sale.
const PRODUCTS_CREATED_FROM = new Date("2024-10-01T00:00:00.000Z");
const CUSTOMERS_CREATED_FROM = new Date("2024-10-02T00:00:00.000Z");
// Soft deletions happen after every sample sale, so history stays coherent.
export const SEED_DELETED_AT = SALE_WINDOW_END;

export const PRODUCT_COUNT = 1_000;
export const CUSTOMER_COUNT = 3_000;
export const SALE_COUNT = 8_000;
const PRODUCT_DELETE_EVERY = 20;
const CUSTOMER_DELETE_EVERY = 33;
const PRODUCT_SORT_ORDER_START = 100_000;

// Exact expected contents, checked against the generator and the database.
export const SEED_EXPECTED = {
  products: { total: 1_000, deleted: 50 },
  customers: { total: 3_000, deleted: 90 },
  sales: {
    total: 8_000,
    byStatus: { COMPLETED: 5_600, PENDING: 800, CANCELLED: 800, REFUNDED: 800 },
  },
  saleItems: { total: 24_000 },
} as const;

const categories = [
  "Books",
  "Clothing",
  "Electronics",
  "Home",
  "Stationery",
  "Sports",
  "Toys",
  "Garden",
  "Beauty",
  "Grocery",
];
const firstNames = ["Alex", "Jordan", "Morgan", "Riley", "Taylor", "Casey", "Avery", "Quinn", "Jamie", "Drew"];
const lastNames = ["Anderson", "Garcia", "Kim", "Patel", "Smith", "Lopez", "Nguyen", "Brown", "Silva", "Rossi"];

// v1 used namespaces 1–4; v2 uses 11–14 so the two sets never share IDs.
const NAMESPACES = { product: 11, customer: 12, sale: 13, saleItem: 14 } as const;

export type SeedModel = keyof typeof NAMESPACES;

export function seedId(model: SeedModel, index: number): string {
  const suffix = (NAMESPACES[model] * 1_000_000_000 + index)
    .toString(16)
    .padStart(12, "0");
  return `00000000-0000-4000-8000-${suffix}`;
}

export function seedKey(model: SeedModel, index: number): string {
  return `${SEED_PREFIX}:${model}:${String(index).padStart(6, "0")}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function money(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(`${Math.floor(cents / 100)}.${pad(cents % 100, 2)}`);
}

function productPriceCents(index: number): number {
  return 299 + ((index * 7_919) % 50_000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

export type SeedDataset = {
  products: Prisma.ProductCreateManyInput[];
  customers: Prisma.CustomerCreateManyInput[];
  sales: Prisma.SaleCreateManyInput[];
  saleItems: Prisma.SaleItemCreateManyInput[];
};

const statusCycle: SaleStatus[] = [
  SaleStatus.REFUNDED,
  SaleStatus.COMPLETED,
  SaleStatus.COMPLETED,
  SaleStatus.COMPLETED,
  SaleStatus.COMPLETED,
  SaleStatus.COMPLETED,
  SaleStatus.COMPLETED,
  SaleStatus.COMPLETED,
  SaleStatus.PENDING,
  SaleStatus.CANCELLED,
];

export function buildSeedDataset(): SeedDataset {
  const products = Array.from({ length: PRODUCT_COUNT }, (_, offset) => {
    const index = offset + 1;
    const createdAt = addMinutes(PRODUCTS_CREATED_FROM, offset);
    const deletedAt = index % PRODUCT_DELETE_EVERY === 0 ? SEED_DELETED_AT : null;
    const category = categories[offset % categories.length];
    return {
      id: seedId("product", index),
      sku: `PM2-${pad(index, 4)}`,
      name: `PulseMarket ${category} ${pad(index, 4)}`,
      description: `Deterministic seed v2 product ${index}.`,
      category,
      price: money(productPriceCents(index)),
      stock: (index * 37) % 500,
      sortOrder: PRODUCT_SORT_ORDER_START + offset,
      deletedAt,
      createdAt,
      updatedAt: deletedAt ?? createdAt,
      seedKey: seedKey("product", index),
    } satisfies Prisma.ProductCreateManyInput;
  });

  const customers = Array.from({ length: CUSTOMER_COUNT }, (_, offset) => {
    const index = offset + 1;
    const createdAt = addMinutes(CUSTOMERS_CREATED_FROM, offset);
    const deletedAt = index % CUSTOMER_DELETE_EVERY === 0 ? SEED_DELETED_AT : null;
    return {
      id: seedId("customer", index),
      name: `${firstNames[offset % firstNames.length]} ${lastNames[Math.floor(offset / firstNames.length) % lastNames.length]} ${pad(index, 4)}`,
      email: `customer-v2-${pad(index, 5)}@seed.pulsemarket.example`,
      phone: `+1556${pad(index, 7)}`,
      deletedAt,
      createdAt,
      updatedAt: deletedAt ?? createdAt,
      seedKey: seedKey("customer", index),
    } satisfies Prisma.CustomerCreateManyInput;
  });

  const sales: Prisma.SaleCreateManyInput[] = [];
  const saleItems: Prisma.SaleItemCreateManyInput[] = [];
  let itemIndex = 0;

  for (let saleIndex = 1; saleIndex <= SALE_COUNT; saleIndex += 1) {
    const day = (saleIndex - 1) % SALE_DAY_SPAN;
    const saleDate = addMinutes(
      new Date(SALE_WINDOW_START.getTime() + day * DAY_MS),
      (saleIndex * 37) % 1_440,
    );
    const saleId = seedId("sale", saleIndex);
    const itemCount = ((saleIndex - 1) % 5) + 1;
    let totalCents = 0;

    for (let itemOffset = 0; itemOffset < itemCount; itemOffset += 1) {
      itemIndex += 1;
      // 13 * k is distinct modulo 1,000 for k < 5, so a sale never repeats a product.
      const productIndex = (((saleIndex - 1) * 7 + itemOffset * 13) % PRODUCT_COUNT) + 1;
      const quantity = ((saleIndex + itemOffset) % 5) + 1;
      const unitCents = productPriceCents(productIndex);
      totalCents += unitCents * quantity;
      saleItems.push({
        id: seedId("saleItem", itemIndex),
        saleId,
        productId: seedId("product", productIndex),
        quantity,
        unitPrice: money(unitCents),
        lineTotal: money(unitCents * quantity),
        createdAt: saleDate,
        seedKey: seedKey("saleItem", itemIndex),
      });
    }

    sales.push({
      id: saleId,
      // 7 and 3,000 are coprime, so every customer receives sales.
      customerId: seedId("customer", (((saleIndex - 1) * 7) % CUSTOMER_COUNT) + 1),
      status: statusCycle[saleIndex % statusCycle.length],
      saleDate,
      total: money(totalCents),
      createdAt: saleDate,
      updatedAt: saleDate,
      seedKey: seedKey("sale", saleIndex),
    });
  }

  return { products, customers, sales, saleItems };
}

// Rows in a comparable form: Decimal as fixed two-decimal strings, dates as
// ISO strings, absent optional values as null.
export type NormalizedRow = Record<string, string | number | null>;

export type NormalizedDataset = Record<keyof SeedDataset, NormalizedRow[]>;

export function normalizeRow(row: object): NormalizedRow {
  const normalized: NormalizedRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null) {
      normalized[key] = null;
    } else if (value instanceof Date) {
      normalized[key] = value.toISOString();
    } else if (Prisma.Decimal.isDecimal(value)) {
      normalized[key] = (value as Prisma.Decimal).toFixed(2);
    } else if (typeof value === "string" || typeof value === "number") {
      normalized[key] = value;
    } else {
      throw new Error(`Unsupported seed column type for ${key}.`);
    }
  }
  return normalized;
}

export function normalizeDataset(dataset: SeedDataset): NormalizedDataset {
  return {
    products: dataset.products.map(normalizeRow),
    customers: dataset.customers.map(normalizeRow),
    sales: dataset.sales.map(normalizeRow),
    saleItems: dataset.saleItems.map(normalizeRow),
  };
}

function cents(value: string | number | null): number {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) {
    throw new Error("Expected a two-decimal amount.");
  }
  const [whole, fraction] = value.split(".");
  return Number(whole) * 100 + Number(fraction);
}

// Checks counts, soft deletions, statuses, relations, exact Decimal totals,
// date bounds and volume. Returns problem descriptions (no personal data);
// an empty list means the dataset is coherent.
export function checkDatasetIntegrity(data: NormalizedDataset): string[] {
  const problems: string[] = [];
  const expect = (condition: boolean, message: string) => {
    if (!condition) problems.push(message);
  };
  const deleted = (rows: NormalizedRow[]) => rows.filter((row) => row.deletedAt !== null).length;

  expect(data.products.length === SEED_EXPECTED.products.total, `Product count is ${data.products.length}.`);
  expect(deleted(data.products) === SEED_EXPECTED.products.deleted, `Deleted product count is ${deleted(data.products)}.`);
  expect(data.customers.length === SEED_EXPECTED.customers.total, `Customer count is ${data.customers.length}.`);
  expect(deleted(data.customers) === SEED_EXPECTED.customers.deleted, `Deleted customer count is ${deleted(data.customers)}.`);
  expect(data.sales.length === SEED_EXPECTED.sales.total, `Sale count is ${data.sales.length}.`);
  expect(data.saleItems.length === SEED_EXPECTED.saleItems.total, `SaleItem count is ${data.saleItems.length}.`);
  for (const [status, count] of Object.entries(SEED_EXPECTED.sales.byStatus)) {
    const actual = data.sales.filter((sale) => sale.status === status).length;
    expect(actual === count, `Sale count for ${status} is ${actual}.`);
  }
  expect(
    data.products.length + data.customers.length + data.sales.length >= 10_000,
    "Products, customers and sales total fewer than 10,000 records.",
  );

  for (const [model, rows] of Object.entries(data)) {
    for (const field of ["id", "seedKey"]) {
      const values = new Set(rows.map((row) => row[field]));
      expect(values.size === rows.length, `${model} has duplicate ${field} values.`);
    }
  }
  expect(new Set(data.products.map((row) => row.sku)).size === data.products.length, "Duplicate product SKU.");
  expect(new Set(data.customers.map((row) => row.email)).size === data.customers.length, "Duplicate customer email.");
  expect(
    data.customers.every((row) => typeof row.email === "string" && row.email === row.email.trim().toLowerCase()),
    "A customer email is not normalized.",
  );

  const productPrice = new Map(data.products.map((row) => [row.id, cents(row.price)]));
  const customerIds = new Set(data.customers.map((row) => row.id));
  const lineSums = new Map<string | number | null, number>();
  const salePairs = new Set<string>();

  for (const item of data.saleItems) {
    const unit = cents(item.unitPrice);
    expect(productPrice.has(item.productId), "A sale item references a product outside the seed.");
    expect(productPrice.get(item.productId) === unit, "A sale item unit price differs from its product price.");
    expect(
      typeof item.quantity === "number" && item.quantity >= 1 && cents(item.lineTotal) === unit * item.quantity,
      "A sale item line total is not unit price times quantity.",
    );
    const pair = `${item.saleId}|${item.productId}`;
    expect(!salePairs.has(pair), "A sale repeats a product.");
    salePairs.add(pair);
    lineSums.set(item.saleId, (lineSums.get(item.saleId) ?? 0) + cents(item.lineTotal));
  }

  const windowStart = SALE_WINDOW_START.getTime();
  const windowEnd = SALE_WINDOW_END.getTime();
  const deletedAt = SEED_DELETED_AT.getTime();
  for (const sale of data.sales) {
    expect(customerIds.has(sale.customerId), "A sale references a customer outside the seed.");
    expect(lineSums.has(sale.id), "A sale has no items.");
    expect(lineSums.get(sale.id) === cents(sale.total), "A sale total differs from the sum of its items.");
    const time = Date.parse(String(sale.saleDate));
    expect(time >= windowStart && time < windowEnd, "A sale date is outside the seed window.");
    expect(time < deletedAt, "A sale is dated after the soft-deletion time.");
  }
  const saleIds = new Set(data.sales.map((row) => row.id));
  expect(
    data.saleItems.every((item) => saleIds.has(item.saleId)),
    "A sale item references a sale outside the seed.",
  );

  return [...new Set(problems)];
}
