import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "../../generated/prisma/client";
import {
  bulkProductMutationInputSchema,
  mutateProducts,
  ProductMutationError,
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
      for (const update of updates) {
        const product = products.get(update.id);
        assert.ok(product);
        products.set(update.id, { ...product, ...update });
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
