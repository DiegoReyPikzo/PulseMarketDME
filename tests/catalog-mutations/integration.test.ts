import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, test } from "vitest";

import { Prisma } from "../../generated/prisma/client";
import {
  bulkProductMutationInputSchema,
  createProductMutationRepository,
  mutateProducts,
  reorderProductInputSchema,
  reorderProducts,
  softDeleteProduct,
  StaleProductOrderError,
} from "../../lib/catalog-mutations";
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

async function createFixture(
  sortOrder = 0,
  category = "Mutation test",
) {
  const fixture = await prisma.product.create({
    data: {
      sku: `MUTATION-TEST-${randomUUID()}`,
      name: `Mutation integration fixture ${randomUUID()}`,
      category,
      price: new Prisma.Decimal("12.34"),
      stock: 7,
      sortOrder,
    },
    select: {
      id: true,
      sku: true,
      category: true,
      price: true,
      stock: true,
      sortOrder: true,
    },
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

test("reordering page 2 preserves other pages and persists on the next query", async () => {
  const minimum = await prisma.product.aggregate({
    where: { deletedAt: null },
    _min: { sortOrder: true },
  });
  const firstPosition =
    minimum._min.sortOrder === null ? 0 : minimum._min.sortOrder - 40;
  assert.ok(firstPosition > -2_147_483_648);

  const fixtures = await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      createFixture(firstPosition + index),
    ),
  );
  const ids = fixtures.map(({ id }) => id);

  try {
    const queryPage = (page: number) =>
      listProducts({
        page,
        pageSize: 20,
        sortBy: "sortOrder",
        sortOrder: "asc",
      });
    const [pageOneBefore, pageTwoBefore, pageThreeBefore] = await Promise.all([
      queryPage(1),
      queryPage(2),
      queryPage(3),
    ]);
    assert.deepEqual(
      pageOneBefore.items.map(({ id }) => id),
      fixtures.slice(0, 20).map(({ id }) => id),
    );
    assert.deepEqual(
      pageTwoBefore.items.map(({ id }) => id),
      fixtures.slice(20).map(({ id }) => id),
    );

    const unchangedIds = [
      ...pageOneBefore.items.map(({ id }) => id),
      ...pageThreeBefore.items.map(({ id }) => id),
    ];
    const positionsBefore = await prisma.product.findMany({
      where: { id: { in: unchangedIds } },
      select: { id: true, sortOrder: true },
    });
    positionsBefore.sort((left, right) => left.id.localeCompare(right.id));
    const desiredPageTwoIds = pageTwoBefore.items
      .map(({ id }) => id)
      .reverse();
    const input = reorderProductInputSchema.parse({
      ids: desiredPageTwoIds,
      expectedIds: pageTwoBefore.items.map(({ id }) => id),
      page: 2,
      pageSize: 20,
    });

    await prisma.$transaction(
      (transaction) =>
        reorderProducts(createProductMutationRepository(transaction), input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const [pageOneAfter, pageTwoAfter, pageThreeAfter, positionsAfter] =
      await Promise.all([
        queryPage(1),
        queryPage(2),
        queryPage(3),
        prisma.product.findMany({
          where: { id: { in: unchangedIds } },
          select: { id: true, sortOrder: true },
        }),
      ]);
    positionsAfter.sort((left, right) => left.id.localeCompare(right.id));
    assert.deepEqual(
      pageOneAfter.items.map(({ id }) => id),
      pageOneBefore.items.map(({ id }) => id),
    );
    assert.deepEqual(
      pageTwoAfter.items.map(({ id }) => id),
      desiredPageTwoIds,
    );
    assert.deepEqual(
      pageThreeAfter.items.map(({ id }) => id),
      pageThreeBefore.items.map(({ id }) => id),
    );
    assert.deepEqual(positionsAfter, positionsBefore);

    await assert.rejects(
      prisma.$transaction(
        (transaction) =>
          reorderProducts(
            createProductMutationRepository(transaction),
            input,
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
      StaleProductOrderError,
    );
    const pageTwoAfterStaleRequest = await queryPage(2);
    assert.deepEqual(
      pageTwoAfterStaleRequest.items.map(({ id }) => id),
      desiredPageTwoIds,
    );
  } finally {
    const cleanup = await prisma.product.deleteMany({
      where: { id: { in: ids } },
    });
    assert.equal(cleanup.count, ids.length);
    for (const id of ids) fixtureIds.delete(id);
  }
});
