import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { Prisma } from "../../generated/prisma/client";
import {
  bulkProductMutationInputSchema,
  createProductMutationRepository,
  mutateProducts,
  softDeleteProduct,
} from "../../lib/catalog-mutations";
import { prisma } from "../../lib/prisma";
import { listProducts } from "../../lib/queries/products";

const fixtureIds = new Set<string>();

after(async () => {
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

async function createFixture() {
  const fixture = await prisma.product.create({
    data: {
      sku: `MUTATION-TEST-${randomUUID()}`,
      name: "Mutation integration fixture",
      category: "Mutation test",
      price: new Prisma.Decimal("12.34"),
      stock: 7,
    },
    select: { id: true, sku: true, category: true, price: true, stock: true },
  });
  fixtureIds.add(fixture.id);
  return fixture;
}

async function cleanupFixture(id: string): Promise<void> {
  const cleanup = await prisma.product.deleteMany({ where: { id } });
  assert.equal(cleanup.count, 1);
  fixtureIds.delete(id);
}

test("soft delete stores deletedAt and removes the product from listProducts", async () => {
  const fixture = await createFixture();
  try {
    await prisma.$transaction((transaction) =>
      softDeleteProduct(
        createProductMutationRepository(transaction),
        fixture.id,
        new Date(),
      ),
    );

    const [stored, result] = await Promise.all([
      prisma.product.findUnique({
        where: { id: fixture.id },
        select: { deletedAt: true },
      }),
      listProducts({ search: fixture.sku }),
    ]);

    assert.ok(stored?.deletedAt instanceof Date);
    assert.ok(!result.items.some((product) => product.id === fixture.id));
  } finally {
    await cleanupFixture(fixture.id);
  }
});

test("bulk category update changes every selected row in one transaction", async () => {
  const fixtures = await Promise.all([createFixture(), createFixture()]);
  const ids = fixtures.map(({ id }) => id);

  try {
    const input = bulkProductMutationInputSchema.parse({
      ids,
      operation: "category",
      category: "Bulk test category",
    });
    const updated = await prisma.$transaction((transaction) =>
      mutateProducts(
        createProductMutationRepository(transaction),
        input,
        new Date(),
      ),
    );
    const rows = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, category: true },
    });

    assert.equal(updated, ids.length);
    assert.equal(rows.length, ids.length);
    assert.ok(rows.every((row) => row.category === "Bulk test category"));
  } finally {
    const cleanup = await prisma.product.deleteMany({
      where: { id: { in: ids } },
    });
    assert.equal(cleanup.count, ids.length);
    for (const id of ids) fixtureIds.delete(id);
  }
});

test("transaction leaves valid products unchanged when a selected ID is missing", async () => {
  const fixture = await createFixture();

  try {
    const input = bulkProductMutationInputSchema.parse({
      ids: [fixture.id, randomUUID()],
      operation: "category",
      category: "Must roll back",
    });

    await assert.rejects(
      prisma.$transaction((transaction) =>
        mutateProducts(
          createProductMutationRepository(transaction),
          input,
          new Date(),
        ),
      ),
      /No existen productos/,
    );

    const unchanged = await prisma.product.findUnique({
      where: { id: fixture.id },
      select: { category: true },
    });
    assert.equal(unchanged?.category, fixture.category);
  } finally {
    await cleanupFixture(fixture.id);
  }
});
