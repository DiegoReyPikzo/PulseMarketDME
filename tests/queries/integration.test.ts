import "dotenv/config";

import assert from "node:assert/strict";
import { afterAll, test } from "vitest";

import { prisma } from "../../lib/prisma";
import { listCustomers } from "../../lib/queries/customers";
import { listProducts } from "../../lib/queries/products";
import { listSales } from "../../lib/queries/sales";

afterAll(async () => {
  await prisma.$disconnect();
});

test("lists products and counts only active catalog rows", async () => {
  const [result, activeCount] = await Promise.all([
    listProducts({ page: 1, pageSize: 20 }),
    prisma.product.count({ where: { deletedAt: null } }),
  ]);

  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 20);
  assert.equal(result.total, activeCount);
  assert.ok(result.items.length <= 20);
  assert.ok(result.items.every((product) => typeof product.price === "string"));
});

test("lists customers using a database page and exact total", async () => {
  const result = await listCustomers({ page: 1, pageSize: 20 });

  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 20);
  assert.ok(result.total >= result.items.length);
  assert.ok(result.items.length <= 20);
  assert.ok(result.items.every((customer) => customer.email.length > 0));
});

test("returns distinct database pages and the matching page count", async () => {
  const [firstPage, secondPage] = await Promise.all([
    listCustomers({ page: 1, pageSize: 20 }),
    listCustomers({ page: 2, pageSize: 20 }),
  ]);
  const firstIds = new Set(firstPage.items.map((customer) => customer.id));

  assert.equal(firstPage.total, secondPage.total);
  assert.equal(firstPage.totalPages, secondPage.totalPages);
  assert.ok(secondPage.items.every((customer) => !firstIds.has(customer.id)));
});

test("lists sales with one selected customer relation and no sale items", async () => {
  const result = await listSales({ page: 1, pageSize: 20 });

  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 20);
  assert.ok(result.total >= result.items.length);
  assert.ok(result.items.length <= 20);
  assert.ok(
    result.items.every(
      (sale) =>
        typeof sale.total === "string" &&
        sale.customer.id === sale.customerId &&
        !("items" in sale),
    ),
  );
});

test("returns a real empty result for an unmatched product search", async () => {
  const result = await listProducts({
    search: "pulsemarket-query-empty-7f9b1d3",
  });

  assert.deepEqual(result, {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 0,
  });
});
