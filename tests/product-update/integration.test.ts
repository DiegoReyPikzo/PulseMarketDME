import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, test } from "vitest";

import { Prisma } from "../../generated/prisma/client";
import {
  bulkProductMutationInputSchema,
  createProductMutationRepository,
  mutateProducts,
  ProductMutationError,
  type ProductMutationRepository,
} from "../../lib/catalog-mutations";
import { prisma } from "../../lib/prisma";
import {
  createProductUpdateRepository,
  findProductForEdit,
  ProductUpdateError,
  updateProduct,
  updateProductInputSchema,
  type ProductForEdit,
  type ProductUpdateRepository,
} from "../../lib/product-update";
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
  values: { price?: string; deletedAt?: Date | null } = {},
) {
  const fixture = await prisma.product.create({
    data: {
      sku: `PRODUCT-UPDATE-TEST-${randomUUID()}`,
      name: `Product update fixture ${randomUUID()}`,
      description: "Fixture description",
      category: "Update test",
      price: new Prisma.Decimal(values.price ?? "10.00"),
      stock: 7,
      sortOrder: 0,
      deletedAt: values.deletedAt ?? null,
    },
    select: { id: true, sku: true },
  });
  fixtureIds.add(fixture.id);
  return fixture;
}

async function readRow(id: string) {
  const row = await prisma.product.findUniqueOrThrow({
    where: { id },
    select: {
      sku: true,
      name: true,
      description: true,
      category: true,
      price: true,
      stock: true,
      sortOrder: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      seedKey: true,
    },
  });
  return row;
}

function formValues(product: ProductForEdit) {
  return {
    sku: product.sku,
    name: product.name,
    description: product.description ?? "",
    category: product.category ?? "",
    price: product.price.toFixed(2),
    stock: String(product.stock),
  };
}

async function baselineFor(id: string) {
  return formValues(
    await findProductForEdit(createProductUpdateRepository(prisma), id),
  );
}

function editInput(
  id: string,
  original: ReturnType<typeof formValues>,
  changes: Partial<ReturnType<typeof formValues>>,
) {
  return updateProductInputSchema.parse({
    productId: id,
    values: { ...original, ...changes },
    original,
  });
}

function runEdit(
  input: ReturnType<typeof editInput>,
  wrap: (repository: ProductUpdateRepository) => ProductUpdateRepository = (
    repository,
  ) => repository,
) {
  return prisma.$transaction((transaction) =>
    updateProduct(wrap(createProductUpdateRepository(transaction)), input),
  );
}

function runBulkPriceAdjustment(
  ids: string[],
  amount: string,
  wrap: (repository: ProductMutationRepository) => ProductMutationRepository = (
    repository,
  ) => repository,
) {
  const input = bulkProductMutationInputSchema.parse({
    ids,
    operation: "adjust",
    field: "price",
    mode: "percentage",
    amount,
  });
  return prisma.$transaction((transaction) =>
    mutateProducts(
      wrap(createProductMutationRepository(transaction)),
      input,
      new Date(),
    ),
  );
}

test("persists only the changed fields and leaves internal fields untouched", async () => {
  const fixture = await createFixture();
  const before = await readRow(fixture.id);
  const original = await baselineFor(fixture.id);
  const renamedSku = `PRODUCT-UPDATE-TEST-${randomUUID()}`;

  const result = await runEdit(
    editInput(fixture.id, original, {
      sku: `  ${renamedSku}  `,
      name: "  Edited fixture  ",
      price: "15.5",
      description: "   ",
    }),
  );
  const after = await readRow(fixture.id);
  const listed = await listProducts({ search: renamedSku });

  assert.deepEqual(result, {
    status: "updated",
    sku: renamedSku,
    changedFields: ["sku", "name", "description", "price"],
  });
  assert.equal(after.sku, renamedSku);
  assert.equal(after.name, "Edited fixture");
  assert.equal(after.description, null);
  assert.ok(after.price.equals("15.50"));
  assert.equal(after.stock, before.stock);
  assert.equal(after.category, before.category);
  assert.equal(after.sortOrder, before.sortOrder);
  assert.equal(after.deletedAt, null);
  assert.equal(after.seedKey, before.seedKey);
  assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].price, "15.50");
});

test("does not write when submitted values are equivalent to the original", async () => {
  const fixture = await createFixture();
  const before = await readRow(fixture.id);
  const original = await baselineFor(fixture.id);

  const result = await runEdit(
    editInput(fixture.id, original, { price: "10", sku: ` ${fixture.sku} ` }),
  );

  assert.equal(result.status, "unchanged");
  assert.equal(
    (await readRow(fixture.id)).updatedAt.getTime(),
    before.updatedAt.getTime(),
  );
});

test("rejects a SKU reserved by an active or a soft-deleted product without changes", async () => {
  const fixture = await createFixture();
  const active = await createFixture();
  const deleted = await createFixture({ deletedAt: new Date() });
  const before = await readRow(fixture.id);
  const original = await baselineFor(fixture.id);

  for (const owner of [active, deleted]) {
    await assert.rejects(
      runEdit(editInput(fixture.id, original, { sku: owner.sku, name: "Nope" })),
      (error: unknown) =>
        error instanceof ProductUpdateError && error.code === "DUPLICATE_SKU",
    );
  }
  assert.deepEqual(await readRow(fixture.id), before);
});

test("rejects editing a soft-deleted product without changes", async () => {
  const fixture = await createFixture();
  const original = await baselineFor(fixture.id);
  await prisma.product.update({
    where: { id: fixture.id },
    data: { deletedAt: new Date() },
  });
  const before = await readRow(fixture.id);

  await assert.rejects(
    runEdit(editInput(fixture.id, original, { name: "Should not persist" })),
    (error: unknown) =>
      error instanceof ProductUpdateError && error.code === "DELETED",
  );
  assert.deepEqual(await readRow(fixture.id), before);
});

test("a bulk adjustment committed before saving is kept for untouched fields and conflicts for edited ones", async () => {
  const fixture = await createFixture({ price: "10.00" });
  const original = await baselineFor(fixture.id);

  await runBulkPriceAdjustment([fixture.id], "10");
  assert.ok((await readRow(fixture.id)).price.equals("11.00"));

  const renamed = await runEdit(
    editInput(fixture.id, original, { name: "Renamed after bulk" }),
  );
  assert.equal(renamed.status, "updated");
  let row = await readRow(fixture.id);
  assert.equal(row.name, "Renamed after bulk");
  assert.ok(row.price.equals("11.00"));

  await assert.rejects(
    runEdit(editInput(fixture.id, original, { price: "12.00" })),
    (error: unknown) =>
      error instanceof ProductUpdateError &&
      error.code === "CONFLICT" &&
      error.conflictFields.join() === "price",
  );
  row = await readRow(fixture.id);
  assert.ok(row.price.equals("11.00"));
});

test("an individual edit committed between the bulk read and write rolls back the whole batch", async () => {
  const untouched = await createFixture({ price: "10.00" });
  const edited = await createFixture({ price: "20.00" });
  const editedOriginal = await baselineFor(edited.id);
  let editCommitted = false;

  await assert.rejects(
    runBulkPriceAdjustment([untouched.id, edited.id], "10", (repository) => ({
      ...repository,
      async findByIds(ids) {
        const records = await repository.findByIds(ids);
        // Commit an individual edit on another connection after the bulk
        // transaction has read the prices and before it writes them.
        await runEdit(
          editInput(edited.id, editedOriginal, { price: "25.00" }),
        );
        editCommitted = true;
        return records;
      },
    })),
    (error: unknown) =>
      error instanceof ProductMutationError &&
      error.message.startsWith("El catálogo cambió durante la operación."),
  );

  assert.equal(editCommitted, true);
  assert.ok((await readRow(edited.id)).price.equals("25.00"));
  assert.ok((await readRow(untouched.id)).price.equals("10.00"));
});

test("a bulk adjustment committed between the edit read and write is reported as a conflict", async () => {
  const fixture = await createFixture({ price: "10.00" });
  const original = await baselineFor(fixture.id);
  let bulkCommitted = false;

  await assert.rejects(
    runEdit(editInput(fixture.id, original, { price: "12.00" }), (repository) => ({
      ...repository,
      async updateIfUnchanged(id, expected, data) {
        // Commit a bulk adjustment on another connection after the edit has
        // read the row and before its conditional write.
        await runBulkPriceAdjustment([fixture.id], "10");
        bulkCommitted = true;
        return repository.updateIfUnchanged(id, expected, data);
      },
    })),
    (error: unknown) =>
      error instanceof ProductUpdateError &&
      error.code === "CONFLICT" &&
      error.conflictFields.join() === "price",
  );

  assert.equal(bulkCommitted, true);
  assert.ok((await readRow(fixture.id)).price.equals("11.00"));
});
