import assert from "node:assert/strict";
import { test } from "vitest";

import { Prisma } from "../../generated/prisma/client";
import {
  bulkProductMutationInputSchema,
  mutateProducts,
  ProductMutationError,
  reorderProductInputSchema,
  reorderProducts,
  StaleProductOrderError,
  type ProductMutationRecord,
  type ProductMutationRepository,
  type ProductValueUpdate,
} from "../../lib/catalog-mutations";

const productA = "00000000-0000-4000-8000-000000000001";
const productB = "00000000-0000-4000-8000-000000000002";

function activeProduct(
  id: string,
  values: Partial<ProductMutationRecord> = {},
): ProductMutationRecord {
  return {
    id,
    deletedAt: null,
    price: new Prisma.Decimal("10.00"),
    stock: 10,
    sortOrder: 0,
    ...values,
  };
}

function createMemoryRepository(
  initial: ProductMutationRecord[],
): {
  repository: ProductMutationRepository;
  products: Map<string, ProductMutationRecord>;
} {
  const products = new Map(initial.map((product) => [product.id, product]));
  const repository: ProductMutationRepository = {
    async findByIds(ids) {
      return ids.flatMap((id) => {
        const product = products.get(id);
        return product ? [product] : [];
      });
    },
    async findActivePage(page, pageSize) {
      return [...products.values()]
        .filter(({ deletedAt }) => deletedAt === null)
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
        )
        .slice((page - 1) * pageSize, page * pageSize)
        .map(({ id }) => id);
    },
    async softDelete(ids, deletedAt) {
      let count = 0;
      for (const id of ids) {
        const product = products.get(id);
        if (product && product.deletedAt === null) {
          products.set(id, { ...product, deletedAt });
          count += 1;
        }
      }
      return count;
    },
    async setCategory(ids) {
      return ids.length;
    },
    async updateValues(updates: readonly ProductValueUpdate[]) {
      let count = 0;
      for (const { expected, ...update } of updates) {
        const product = products.get(update.id);
        assert.ok(product);
        const matches =
          "price" in expected
            ? product.price.equals(expected.price)
            : product.stock === expected.stock;
        if (product.deletedAt === null && matches) {
          products.set(update.id, { ...product, ...update });
          count += 1;
        }
      }
      return count;
    },
    async updatePositions(updates) {
      for (const update of updates) {
        const product = products.get(update.id);
        assert.ok(product);
        products.set(update.id, { ...product, sortOrder: update.sortOrder });
      }
      return updates.length;
    },
  };

  return { repository, products };
}

test("rejects empty mutation batches", () => {
  const result = bulkProductMutationInputSchema.safeParse({
    ids: [],
    operation: "delete",
  });
  assert.equal(result.success, false);
});

test("rejects mutation batches over 50 product IDs", () => {
  const ids = Array.from({ length: 51 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return `00000000-0000-4000-8000-${suffix}`;
  });

  assert.equal(
    bulkProductMutationInputSchema.safeParse({ ids, operation: "delete" })
      .success,
    false,
  );
});

test("rejects duplicate, malformed, and empty category values", () => {
  assert.equal(
    bulkProductMutationInputSchema.safeParse({
      ids: [productA, productA],
      operation: "delete",
    }).success,
    false,
  );
  assert.equal(
    bulkProductMutationInputSchema.safeParse({
      ids: ["not-a-uuid"],
      operation: "delete",
    }).success,
    false,
  );
  assert.equal(
    bulkProductMutationInputSchema.safeParse({
      ids: [productA],
      operation: "category",
      category: "  ",
    }).success,
    false,
  );
});

test("rejects fixed stock adjustments that are not whole numbers", () => {
  assert.equal(
    bulkProductMutationInputSchema.safeParse({
      ids: [productA],
      operation: "adjust",
      field: "stock",
      mode: "fixed",
      amount: "1.5",
    }).success,
    false,
  );
});

test("rejects malformed adjustment values", () => {
  assert.equal(
    bulkProductMutationInputSchema.safeParse({
      ids: [productA],
      operation: "adjust",
      field: "price",
      mode: "fixed",
      amount: "not-a-number",
    }).success,
    false,
  );
});

test("updates category for all selected products", async () => {
  const { repository } = createMemoryRepository([
    activeProduct(productA),
    activeProduct(productB),
  ]);
  const parsed = bulkProductMutationInputSchema.parse({
    ids: [productA, productB],
    operation: "category",
    category: "Stationery",
  });
  let updatedIds: readonly string[] = [];
  const wrappedRepository: ProductMutationRepository = {
    ...repository,
    async setCategory(ids, category) {
      assert.equal(category, "Stationery");
      updatedIds = ids;
      return ids.length;
    },
  };

  assert.equal(
    await mutateProducts(wrappedRepository, parsed, new Date()),
    2,
  );
  assert.deepEqual(updatedIds, [productA, productB]);
});

test("applies percentage adjustments with price and stock rounding", async () => {
  const { repository, products } = createMemoryRepository([
    activeProduct(productA, {
      price: new Prisma.Decimal("19.99"),
      stock: 11,
    }),
  ]);
  const parsed = bulkProductMutationInputSchema.parse({
    ids: [productA],
    operation: "adjust",
    field: "price",
    mode: "percentage",
    amount: "10",
  });

  await mutateProducts(repository, parsed, new Date());
  assert.equal(products.get(productA)?.price.toFixed(2), "21.99");

  const stockInput = bulkProductMutationInputSchema.parse({
    ids: [productA],
    operation: "adjust",
    field: "stock",
    mode: "percentage",
    amount: "10",
  });
  await mutateProducts(repository, stockInput, new Date());
  assert.equal(products.get(productA)?.stock, 12);
});

test("rejects adjustments that would make price or stock negative", async () => {
  const { repository, products } = createMemoryRepository([
    activeProduct(productA, { price: new Prisma.Decimal("2.00"), stock: 2 }),
  ]);

  const priceInput = bulkProductMutationInputSchema.parse({
    ids: [productA],
    operation: "adjust",
    field: "price",
    mode: "fixed",
    amount: "-3",
  });
  await assert.rejects(
    mutateProducts(repository, priceInput, new Date()),
    ProductMutationError,
  );

  const stockInput = bulkProductMutationInputSchema.parse({
    ids: [productA],
    operation: "adjust",
    field: "stock",
    mode: "fixed",
    amount: "-3",
  });
  await assert.rejects(
    mutateProducts(repository, stockInput, new Date()),
    ProductMutationError,
  );
  assert.equal(products.get(productA)?.price.toFixed(2), "2.00");
  assert.equal(products.get(productA)?.stock, 2);
});

test("rejects missing and soft-deleted product IDs", async () => {
  const { repository } = createMemoryRepository([
    activeProduct(productA, { deletedAt: new Date("2026-01-01T00:00:00Z") }),
  ]);
  const parsed = bulkProductMutationInputSchema.parse({
    ids: [productA, productB],
    operation: "delete",
  });

  await assert.rejects(
    mutateProducts(repository, parsed, new Date()),
    /No existen productos/,
  );

  const deletedOnly = bulkProductMutationInputSchema.parse({
    ids: [productA],
    operation: "delete",
  });
  await assert.rejects(
    mutateProducts(repository, deletedOnly, new Date()),
    /ya están eliminados/,
  );
});

test("rejects empty, one-item, and duplicate product order lists", () => {
  const base = { expectedIds: [productA, productB], page: 1, pageSize: 20 };
  assert.equal(
    reorderProductInputSchema.safeParse({ ...base, ids: [] }).success,
    false,
  );
  assert.equal(
    reorderProductInputSchema.safeParse({
      ...base,
      ids: [productA],
      expectedIds: [productA],
    }).success,
    false,
  );
  assert.equal(
    reorderProductInputSchema.safeParse({
      ...base,
      ids: [productA, productA],
    }).success,
    false,
  );
});

test("rejects reorder requests with more than 50 product IDs", () => {
  const ids = Array.from({ length: 51 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return `00000000-0000-4000-8000-${suffix}`;
  });

  assert.equal(
    reorderProductInputSchema.safeParse({
      ids,
      expectedIds: ids,
      page: 1,
      pageSize: 50,
    }).success,
    false,
  );
});

test("reorders products while preserving their current position slots", async () => {
  const { repository, products } = createMemoryRepository([
    activeProduct(productA, { sortOrder: 100 }),
    activeProduct(productB, { sortOrder: 200 }),
  ]);

  await reorderProducts(repository, {
    ids: [productB, productA],
    expectedIds: [productA, productB],
    page: 1,
    pageSize: 20,
  });

  assert.equal(products.get(productB)?.sortOrder, 100);
  assert.equal(products.get(productA)?.sortOrder, 200);
});

test("rejects a reorder containing a missing ID before changing positions", async () => {
  const { repository, products } = createMemoryRepository([
    activeProduct(productA, { sortOrder: 100 }),
  ]);

  await assert.rejects(
    reorderProducts(repository, {
      ids: [productA, productB],
      expectedIds: [productA, productB],
      page: 1,
      pageSize: 20,
    }),
    ProductMutationError,
  );
  assert.equal(products.get(productA)?.sortOrder, 100);
});

test("rejects a stale page snapshot before changing any positions", async () => {
  const { repository, products } = createMemoryRepository([
    activeProduct(productA, { sortOrder: 100 }),
    activeProduct(productB, { sortOrder: 200 }),
  ]);

  await assert.rejects(
    reorderProducts(repository, {
      ids: [productB, productA],
      expectedIds: [productB, productA],
      page: 1,
      pageSize: 20,
    }),
    StaleProductOrderError,
  );
  assert.equal(products.get(productA)?.sortOrder, 100);
  assert.equal(products.get(productB)?.sortOrder, 200);
});

test("conditions every bulk adjustment write on the value read before computing it", async () => {
  const { repository } = createMemoryRepository([
    activeProduct(productA, { price: new Prisma.Decimal("10.00"), stock: 4 }),
    activeProduct(productB, { price: new Prisma.Decimal("20.00"), stock: 6 }),
  ]);
  const captured: ProductValueUpdate[] = [];
  const recording: ProductMutationRepository = {
    ...repository,
    async updateValues(updates) {
      captured.push(...updates);
      return repository.updateValues(updates);
    },
  };

  await mutateProducts(
    recording,
    bulkProductMutationInputSchema.parse({
      ids: [productA, productB],
      operation: "adjust",
      field: "price",
      mode: "fixed",
      amount: "1",
    }),
    new Date(),
  );
  assert.deepEqual(
    captured.map((update) =>
      "price" in update.expected ? update.expected.price.toFixed(2) : null,
    ),
    ["10.00", "20.00"],
  );

  captured.length = 0;
  await mutateProducts(
    recording,
    bulkProductMutationInputSchema.parse({
      ids: [productA],
      operation: "adjust",
      field: "stock",
      mode: "fixed",
      amount: "2",
    }),
    new Date(),
  );
  assert.deepEqual(captured, [
    { id: productA, stock: 6, expected: { stock: 4 } },
  ]);
});

test("fails the bulk adjustment when a row changed between the read and the write", async () => {
  const { repository, products } = createMemoryRepository([
    activeProduct(productA, { price: new Prisma.Decimal("10.00") }),
    activeProduct(productB, { price: new Prisma.Decimal("20.00") }),
  ]);
  const racing: ProductMutationRepository = {
    ...repository,
    async findByIds(ids) {
      const records = await repository.findByIds(ids);
      const current = products.get(productB);
      assert.ok(current);
      products.set(productB, {
        ...current,
        price: new Prisma.Decimal("25.00"),
      });
      return records;
    },
  };

  await assert.rejects(
    mutateProducts(
      racing,
      bulkProductMutationInputSchema.parse({
        ids: [productA, productB],
        operation: "adjust",
        field: "price",
        mode: "percentage",
        amount: "10",
      }),
      new Date(),
    ),
    (error: unknown) =>
      error instanceof ProductMutationError &&
      error.message.startsWith("El catálogo cambió durante la operación."),
  );
  assert.ok(products.get(productB)?.price.equals("25.00"));
});
