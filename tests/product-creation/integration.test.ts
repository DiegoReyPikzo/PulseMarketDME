import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, test } from "vitest";

import { Prisma } from "../../generated/prisma/client";
import {
  createProduct as createCatalogProduct,
  createProductCreationRepository,
  type CreateProductInput,
} from "../../lib/product-creation";
import { prisma } from "../../lib/prisma";
import { listProducts } from "../../lib/queries/products";

const fixtureIds = new Set<string>();

afterAll(async () => {
  try {
    const ids = [...fixtureIds];
    if (ids.length > 0) {
      const cleanup = await prisma.product.deleteMany({
        where: { id: { in: ids } },
      });
      assert.equal(cleanup.count, ids.length);
    }
  } finally {
    await prisma.$disconnect();
  }
});

function input(sku = `CREATE-TEST-${randomUUID()}`): CreateProductInput {
  return {
    sku,
    name: "Product creation integration fixture",
    description: null,
    category: "Integration test",
    price: "0.01",
    stock: "0",
  };
}

async function insertExistingProduct(
  sku: string,
  deletedAt: Date | null = null,
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      sku,
      name: "Product creation integration fixture",
      category: "Integration test",
      price: new Prisma.Decimal("1.23"),
      stock: 1,
      deletedAt,
    },
    select: { id: true },
  });
  fixtureIds.add(product.id);
  return product.id;
}

test("creates a precise active product after current positions and listProducts sees it", async () => {
  const sku = `CREATE-TEST-${randomUUID()}`;
  const existingFixtureId = await insertExistingProduct(
    `CREATE-EXISTING-${randomUUID()}`,
  );
  try {
    const before = await prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { id: "asc" },
      select: { id: true, sortOrder: true },
    });
    assert.ok(before.some(({ id }) => id === existingFixtureId));
    const maximumBefore = Math.max(
      ...before.map(({ sortOrder }) => sortOrder),
    );

    const created = await prisma.$transaction(
      (transaction) =>
        createCatalogProduct(
          createProductCreationRepository(transaction),
          input(sku),
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    fixtureIds.add(created.id);

    const [after, stored, listed] = await Promise.all([
      prisma.product.findMany({
        where: { deletedAt: null },
        orderBy: { id: "asc" },
        select: { id: true, sortOrder: true },
      }),
      prisma.product.findUnique({
        where: { id: created.id },
        select: { price: true, description: true, deletedAt: true },
      }),
      listProducts({ search: sku }),
    ]);

    const afterExisting = after
      .filter(({ id }) => id !== created.id)
      .map(({ id, sortOrder }) => ({ id, sortOrder }));
    assert.deepEqual(afterExisting, before);
    assert.equal(created.sortOrder, maximumBefore + 1);
    assert.equal(stored?.price.toFixed(2), "0.01");
    assert.equal(stored?.description, null);
    assert.equal(stored?.deletedAt, null);
    assert.ok(listed.items.some((product) => product.id === created.id));
  } finally {
    const fixtureSkuProduct = await prisma.product.findUnique({
      where: { sku },
      select: { id: true },
    });
    if (fixtureSkuProduct) fixtureIds.add(fixtureSkuProduct.id);
  }
});

test("rejects a SKU reserved by an active product", async () => {
  const sku = `CREATE-DUP-ACTIVE-${randomUUID()}`;
  await insertExistingProduct(sku);

  await assert.rejects(
    prisma.$transaction(
      (transaction) =>
        createCatalogProduct(
          createProductCreationRepository(transaction),
          input(sku),
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
    /SKU ya está en uso/,
  );

  const matches = await prisma.product.count({ where: { sku } });
  assert.equal(matches, 1);
});

test("rejects a SKU reserved by a soft-deleted product", async () => {
  const sku = `CREATE-DUP-DELETED-${randomUUID()}`;
  await insertExistingProduct(sku, new Date("2026-01-01T00:00:00.000Z"));

  await assert.rejects(
    prisma.$transaction(
      (transaction) =>
        createCatalogProduct(
          createProductCreationRepository(transaction),
          input(sku),
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
    /SKU ya está en uso/,
  );

  const matches = await prisma.product.count({ where: { sku } });
  assert.equal(matches, 1);
});
