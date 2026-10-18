import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "../../generated/prisma/client";
import {
  buildCustomerOrderBy,
  buildCustomerWhere,
  buildProductOrderBy,
  buildProductWhere,
  buildSaleOrderBy,
  buildSaleWhere,
} from "../../lib/queries/builders";
import {
  customerListInputSchema,
  productListInputSchema,
  saleListInputSchema,
} from "../../lib/queries/inputs";
import { pageFields } from "../../lib/queries/pagination";
import {
  pageResult,
  paginationArgs,
} from "../../lib/queries/pagination";
import { serializeProduct, serializeSale } from "../../lib/queries/serializers";

test("list inputs default to page 1 and page size 20", () => {
  assert.deepEqual(productListInputSchema.parse({}), {
    page: 1,
    pageSize: 20,
    sortBy: "createdAt",
    sortOrder: "desc",
  });
  assert.deepEqual(customerListInputSchema.parse({}), {
    page: 1,
    pageSize: 20,
    sortBy: "createdAt",
    sortOrder: "desc",
  });
  assert.deepEqual(saleListInputSchema.parse({}), {
    page: 1,
    pageSize: 20,
    sortBy: "saleDate",
    sortOrder: "desc",
  });
});

test("rejects page numbers below one", () => {
  assert.throws(() => productListInputSchema.parse({ page: 0 }));
});

test("rejects page numbers that would lose offset integer precision", () => {
  assert.throws(() =>
    pageFields.page.parse(Number.MAX_SAFE_INTEGER),
  );
});

test("rejects page sizes above one hundred", () => {
  assert.throws(() => customerListInputSchema.parse({ pageSize: 101 }));
});

test("rejects unapproved sort fields", () => {
  assert.throws(() => productListInputSchema.parse({ sortBy: "deletedAt" }));
  assert.throws(() => saleListInputSchema.parse({ sortBy: "customerId" }));
});

test("rejects unrecognized input keys", () => {
  assert.throws(() => customerListInputSchema.parse({ password: "ignored?" }));
});

test("builds PostgreSQL offset pagination arguments", () => {
  const page = productListInputSchema.parse({ page: "3", pageSize: "10" });

  assert.deepEqual(paginationArgs(page), { skip: 20, take: 10 });
});

test("builds product text and exact-category filters while excluding soft deletes", () => {
  const input = productListInputSchema.parse({
    search: "  notebook ",
    category: "Stationery",
  });

  assert.deepEqual(buildProductWhere(input), {
    deletedAt: null,
    category: "Stationery",
    OR: [
      { name: { contains: "notebook", mode: "insensitive" } },
      { sku: { contains: "notebook", mode: "insensitive" } },
      { description: { contains: "notebook", mode: "insensitive" } },
    ],
  });
});

test("builds customer search across existing searchable fields", () => {
  const input = customerListInputSchema.parse({ search: "alex" });

  assert.deepEqual(buildCustomerWhere(input), {
    deletedAt: null,
    OR: [
      { name: { contains: "alex", mode: "insensitive" } },
      { email: { contains: "alex", mode: "insensitive" } },
      { phone: { contains: "alex", mode: "insensitive" } },
    ],
  });
  assert.deepEqual(buildCustomerWhere(customerListInputSchema.parse({})), {
    deletedAt: null,
  });
});

test("builds sales status, customer, and inclusive date filters", () => {
  const input = saleListInputSchema.parse({
    customerId: "00000000-0000-4000-8000-000000000001",
    status: "COMPLETED",
    from: "2026-01-01T00:00:00Z",
    to: "2026-01-31T23:59:59Z",
  });

  assert.deepEqual(buildSaleWhere(input), {
    customerId: "00000000-0000-4000-8000-000000000001",
    status: "COMPLETED",
    saleDate: {
      gte: new Date("2026-01-01T00:00:00Z"),
      lte: new Date("2026-01-31T23:59:59Z"),
    },
  });
});

test("rejects reversed sales date ranges", () => {
  assert.throws(() =>
    saleListInputSchema.parse({
      from: "2026-02-01T00:00:00Z",
      to: "2026-01-01T00:00:00Z",
    }),
  );
});

test("adds unique ID tie-breakers to every allowed sort", () => {
  const productInput = productListInputSchema.parse({
    sortBy: "price",
    sortOrder: "asc",
  });
  const productPositionInput = productListInputSchema.parse({
    sortBy: "sortOrder",
    sortOrder: "asc",
  });
  const customerInput = customerListInputSchema.parse({ sortBy: "email" });
  const saleInput = saleListInputSchema.parse({ sortBy: "total" });

  assert.deepEqual(buildProductOrderBy(productInput), [
    { price: "asc" },
    { id: "asc" },
  ]);
  assert.deepEqual(buildProductOrderBy(productPositionInput), [
    { sortOrder: "asc" },
    { id: "asc" },
  ]);
  assert.deepEqual(buildCustomerOrderBy(customerInput), [
    { email: "desc" },
    { id: "asc" },
  ]);
  assert.deepEqual(buildSaleOrderBy(saleInput), [
    { total: "desc" },
    { id: "asc" },
  ]);
});

test("represents an empty result with zero matches and zero pages", () => {
  const input = productListInputSchema.parse({});

  assert.deepEqual(pageResult([], 0, input), {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 0,
  });
});

test("serializes product Decimal and Date as strings", () => {
  const result = serializeProduct({
    id: "product-id",
    sku: "SKU-1",
    name: "Product",
    category: null,
    price: new Prisma.Decimal("1234.50"),
    stock: 4,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(result.price, "1234.50");
  assert.equal(result.createdAt, "2026-01-01T00:00:00.000Z");
});

test("serializes sale totals and date while including only selected customer data", () => {
  const result = serializeSale({
    id: "sale-id",
    customerId: "customer-id",
    status: "COMPLETED",
    saleDate: new Date("2026-01-01T00:00:00.000Z"),
    total: new Prisma.Decimal("1234.50"),
    customer: {
      id: "customer-id",
      name: "Customer",
      email: "customer@example.test",
      deletedAt: null,
    },
  });

  assert.equal(result.total, "1234.50");
  assert.equal(result.saleDate, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(result.customer, {
    id: "customer-id",
    name: "Customer",
    email: "customer@example.test",
    deleted: false,
  });

  const deletedCustomerSale = serializeSale({
    id: "sale-id",
    customerId: "customer-id",
    status: "COMPLETED",
    saleDate: new Date("2026-01-01T00:00:00.000Z"),
    total: new Prisma.Decimal("1.00"),
    customer: {
      id: "customer-id",
      name: "Customer",
      email: "customer@example.test",
      deletedAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  });
  // The flag is exposed, the deletion timestamp is not; name and email stay.
  assert.deepEqual(deletedCustomerSale.customer, {
    id: "customer-id",
    name: "Customer",
    email: "customer@example.test",
    deleted: true,
  });
});
