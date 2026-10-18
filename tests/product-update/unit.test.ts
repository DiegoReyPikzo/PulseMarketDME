import assert from "node:assert/strict";
import { test } from "vitest";

import { Prisma } from "../../generated/prisma/client";
import {
  handleGetProductForEditAction,
  handleUpdateProductAction,
} from "../../lib/product-update-action";
import {
  findProductForEdit,
  ProductUpdateError,
  updateProduct,
  updateProductInputSchema,
  type ProductEditableValues,
  type ProductForEdit,
  type ProductUpdateRepository,
} from "../../lib/product-update";

const productId = "00000000-0000-4000-8000-000000000101";
const otherId = "00000000-0000-4000-8000-000000000102";

function storedProduct(values: Partial<ProductForEdit> = {}): ProductForEdit {
  return {
    id: productId,
    sku: "SKU-1",
    name: "Lámpara",
    description: null,
    category: "Hogar",
    price: new Prisma.Decimal("10.00"),
    stock: 5,
    deletedAt: null,
    ...values,
  };
}

const formValues = {
  sku: "SKU-1",
  name: "Lámpara",
  description: "",
  category: "Hogar",
  price: "10.00",
  stock: "5",
};

function memoryRepository(initial: ProductForEdit[]) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const calls: string[] = [];
  const writes: {
    expected: Partial<ProductEditableValues>;
    data: Partial<ProductEditableValues>;
  }[] = [];
  const repository: ProductUpdateRepository = {
    async findById(id) {
      calls.push("findById");
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async findIdBySku(sku) {
      calls.push("findIdBySku");
      const row = [...rows.values()].find((candidate) => candidate.sku === sku);
      return row ? { id: row.id } : null;
    },
    async updateIfUnchanged(id, expected, data) {
      calls.push("updateIfUnchanged");
      writes.push({ expected, data });
      const row = rows.get(id);
      if (!row || row.deletedAt !== null) return 0;
      for (const [field, value] of Object.entries(expected)) {
        const current = row[field as keyof ProductEditableValues];
        const matches =
          value instanceof Prisma.Decimal
            ? value.equals(current as Prisma.Decimal)
            : value === current;
        if (!matches) return 0;
      }
      rows.set(id, { ...row, ...data });
      return 1;
    },
  };
  return { repository, rows, calls, writes };
}

function input(
  values: Partial<typeof formValues> = {},
  original: Partial<typeof formValues> = {},
) {
  return updateProductInputSchema.parse({
    productId,
    values: { ...formValues, ...values },
    original: { ...formValues, ...original },
  });
}

function formData(
  values: Record<string, string> = formValues,
  original: Record<string, string> = formValues,
  extra: [string, string][] = [],
): FormData {
  const data = new FormData();
  data.set("productId", productId);
  for (const [field, value] of Object.entries(values)) data.set(field, value);
  for (const [field, value] of Object.entries(original)) {
    data.set(`original.${field}`, value);
  }
  for (const [field, value] of extra) data.append(field, value);
  return data;
}

class RedirectSignal extends Error {}

test("update handler rejects an unauthorized request before parsing, reading, or writing", async () => {
  let updateCalls = 0;
  let revalidations = 0;
  await assert.rejects(
    handleUpdateProductAction(formData(), {
      requireSession: async () => {
        throw new RedirectSignal("redirect:/login?error=AccessDenied");
      },
      update: async () => {
        updateCalls += 1;
        return { status: "unchanged", sku: "SKU-1" };
      },
      revalidate: () => {
        revalidations += 1;
      },
    }),
    RedirectSignal,
  );
  assert.equal(updateCalls, 0);
  assert.equal(revalidations, 0);
});

test("edit lookup handler rejects an unauthorized request before reading", async () => {
  let reads = 0;
  const data = new FormData();
  data.set("productId", productId);
  await assert.rejects(
    handleGetProductForEditAction(data, {
      requireSession: async () => {
        throw new RedirectSignal("redirect:/login");
      },
      find: async () => {
        reads += 1;
        return storedProduct();
      },
    }),
    RedirectSignal,
  );
  assert.equal(reads, 0);
});

test("edit lookup serializes editable values and maps deleted or missing products", async () => {
  const requireSession = async () => ({});
  const data = new FormData();
  data.set("productId", productId);

  const found = await handleGetProductForEditAction(data, {
    requireSession,
    find: async () => storedProduct({ category: null, price: new Prisma.Decimal("7.5") }),
  });
  assert.deepEqual(found, {
    status: "found",
    product: {
      id: productId,
      sku: "SKU-1",
      name: "Lámpara",
      description: "",
      category: "",
      price: "7.50",
      stock: "5",
    },
  });

  const { repository } = memoryRepository([
    storedProduct({ deletedAt: new Date() }),
  ]);
  const deleted = await handleGetProductForEditAction(data, {
    requireSession,
    find: (id) => findProductForEdit(repository, id),
  });
  assert.equal(deleted.status === "error" && deleted.code, "DELETED");

  const missing = await handleGetProductForEditAction(data, {
    requireSession,
    find: (id) => findProductForEdit(memoryRepository([]).repository, id),
  });
  assert.equal(missing.status === "error" && missing.code, "NOT_FOUND");

  const invalid = new FormData();
  invalid.set("productId", "not-a-uuid");
  const rejected = await handleGetProductForEditAction(invalid, {
    requireSession,
    find: async () => storedProduct(),
  });
  assert.equal(rejected.status === "error" && rejected.code, "INVALID");
});

test("rejects internal, unknown, and repeated form fields without updating", async () => {
  let updateCalls = 0;
  const dependencies = {
    requireSession: async () => ({}),
    update: async () => {
      updateCalls += 1;
      return { status: "unchanged" as const, sku: "SKU-1" };
    },
    revalidate: () => {},
  };

  for (const extra of [
    ["id", otherId],
    ["deletedAt", "2026-01-01T00:00:00.000Z"],
    ["sortOrder", "0"],
    ["seedKey", "x"],
    ["createdAt", "2026-01-01T00:00:00.000Z"],
    ["updatedAt", "2026-01-01T00:00:00.000Z"],
    ["original.sortOrder", "0"],
    ["name", "duplicado"],
  ] as [string, string][]) {
    const result = await handleUpdateProductAction(
      formData(formValues, formValues, [extra]),
      dependencies,
    );
    assert.equal(result.status, "error", extra[0]);
    assert.equal(result.status === "error" && result.code, "INVALID", extra[0]);
  }
  assert.equal(updateCalls, 0);
});

test("validates new values with the creation rules and returns field errors", async () => {
  let updateCalls = 0;
  const result = await handleUpdateProductAction(
    formData({
      ...formValues,
      sku: "   ",
      category: "",
      price: "10.999",
      stock: "-1",
    }),
    {
      requireSession: async () => ({}),
      update: async () => {
        updateCalls += 1;
        return { status: "unchanged", sku: "SKU-1" };
      },
      revalidate: () => {},
    },
  );
  assert.equal(result.status === "error" && result.code, "VALIDATION");
  assert.deepEqual(
    Object.keys(result.status === "error" ? result.fieldErrors : {}).sort(),
    ["category", "price", "sku", "stock"],
  );
  assert.equal(updateCalls, 0);
});

test("treats malformed original values as untrusted input and rejects the request", async () => {
  let updateCalls = 0;
  for (const original of [
    { ...formValues, price: "abc" },
    { ...formValues, stock: "1.5" },
    { ...formValues, sku: "" },
    { ...formValues, name: "x".repeat(161) },
  ]) {
    const result = await handleUpdateProductAction(formData(formValues, original), {
      requireSession: async () => ({}),
      update: async () => {
        updateCalls += 1;
        return { status: "unchanged", sku: "SKU-1" };
      },
      revalidate: () => {},
    });
    assert.equal(result.status === "error" && result.code, "INVALID");
  }
  const missingOriginal = new FormData();
  missingOriginal.set("productId", productId);
  for (const [field, value] of Object.entries(formValues)) {
    missingOriginal.set(field, value);
  }
  const result = await handleUpdateProductAction(missingOriginal, {
    requireSession: async () => ({}),
    update: async () => {
      updateCalls += 1;
      return { status: "unchanged", sku: "SKU-1" };
    },
    revalidate: () => {},
  });
  assert.equal(result.status === "error" && result.code, "INVALID");
  assert.equal(updateCalls, 0);
});

test("normalizes values and treats equivalent prices as unchanged without writing", async () => {
  const { repository, writes } = memoryRepository([storedProduct()]);
  const result = await updateProduct(
    repository,
    input({ sku: "  SKU-1  ", price: "10", description: "   " }),
  );
  assert.deepEqual(result, { status: "unchanged", sku: "SKU-1" });
  assert.equal(writes.length, 0);
});

test("writes only changed fields and conditions the write on their original values", async () => {
  const { repository, rows, writes } = memoryRepository([storedProduct()]);
  const result = await updateProduct(
    repository,
    input({ name: "Lámpara de mesa", price: "12.5" }),
  );
  assert.deepEqual(result, {
    status: "updated",
    sku: "SKU-1",
    changedFields: ["name", "price"],
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0].data).sort(), ["name", "price"]);
  assert.deepEqual(Object.keys(writes[0].expected).sort(), ["name", "price"]);
  assert.ok(writes[0].expected.price?.equals("10.00"));
  const row = rows.get(productId);
  assert.equal(row?.name, "Lámpara de mesa");
  assert.ok(row?.price.equals("12.50"));
  assert.equal(row?.stock, 5);
  assert.equal(row?.category, "Hogar");
});

test("rejects missing and soft-deleted products before writing", async () => {
  const missing = memoryRepository([]);
  await assert.rejects(
    updateProduct(missing.repository, input({ name: "Nuevo" })),
    (error: unknown) =>
      error instanceof ProductUpdateError && error.code === "NOT_FOUND",
  );
  const deleted = memoryRepository([storedProduct({ deletedAt: new Date() })]);
  await assert.rejects(
    updateProduct(deleted.repository, input({ name: "Nuevo" })),
    (error: unknown) =>
      error instanceof ProductUpdateError && error.code === "DELETED",
  );
  assert.equal(missing.writes.length + deleted.writes.length, 0);
});

test("rejects a SKU owned by another active or soft-deleted product", async () => {
  for (const owner of [
    storedProduct({ id: otherId, sku: "SKU-2" }),
    storedProduct({ id: otherId, sku: "SKU-2", deletedAt: new Date() }),
  ]) {
    const { repository, writes } = memoryRepository([storedProduct(), owner]);
    await assert.rejects(
      updateProduct(repository, input({ sku: "SKU-2" })),
      (error: unknown) =>
        error instanceof ProductUpdateError && error.code === "DUPLICATE_SKU",
    );
    assert.equal(writes.length, 0);
  }
});

test("does not look up the SKU when only other fields change", async () => {
  const { repository, calls } = memoryRepository([storedProduct()]);
  await updateProduct(repository, input({ stock: "8" }));
  assert.ok(!calls.includes("findIdBySku"));
});

test("allows changing the SKU to a free value", async () => {
  const { repository, rows } = memoryRepository([storedProduct()]);
  const result = await updateProduct(repository, input({ sku: "SKU-NEW" }));
  assert.equal(result.status === "updated" && result.sku, "SKU-NEW");
  assert.equal(rows.get(productId)?.sku, "SKU-NEW");
});

test("reports a conflict when a changed field no longer matches its original", async () => {
  const { repository, writes } = memoryRepository([
    storedProduct({ price: new Prisma.Decimal("11.00") }),
  ]);
  await assert.rejects(
    updateProduct(repository, input({ price: "12.00" })),
    (error: unknown) =>
      error instanceof ProductUpdateError &&
      error.code === "CONFLICT" &&
      error.conflictFields.join() === "price",
  );
  assert.equal(writes.length, 0);
});

test("keeps a concurrent change to a field the user did not edit", async () => {
  const { repository, rows } = memoryRepository([
    storedProduct({ price: new Prisma.Decimal("11.00") }),
  ]);
  await updateProduct(repository, input({ name: "Lámpara renombrada" }));
  assert.equal(rows.get(productId)?.name, "Lámpara renombrada");
  assert.ok(rows.get(productId)?.price.equals("11.00"));
});

test("reports a conflict when the row changes between the read and the conditional write", async () => {
  const { repository, rows } = memoryRepository([storedProduct()]);
  const racing: ProductUpdateRepository = {
    ...repository,
    async updateIfUnchanged(id, expected, data) {
      const row = rows.get(id);
      assert.ok(row);
      rows.set(id, { ...row, price: new Prisma.Decimal("99.00") });
      return repository.updateIfUnchanged(id, expected, data);
    },
  };
  await assert.rejects(
    updateProduct(racing, input({ price: "12.00" })),
    (error: unknown) =>
      error instanceof ProductUpdateError &&
      error.code === "CONFLICT" &&
      error.conflictFields.join() === "price",
  );
  assert.ok(rows.get(productId)?.price.equals("99.00"));
});

test("maps domain errors and SKU unique violations, and revalidates only after success", async () => {
  let revalidations = 0;
  const base = {
    requireSession: async () => ({}),
    revalidate: () => {
      revalidations += 1;
    },
  };
  const changed = formData({ ...formValues, sku: "SKU-2" });

  const conflict = await handleUpdateProductAction(changed, {
    ...base,
    update: async () => {
      throw new ProductUpdateError("conflicto", "CONFLICT", ["price"]);
    },
  });
  assert.equal(conflict.status === "error" && conflict.code, "CONFLICT");
  assert.deepEqual(conflict.status === "error" && conflict.conflictFields, ["price"]);

  const duplicate = await handleUpdateProductAction(changed, {
    ...base,
    update: async () => {
      throw new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
        meta: { modelName: "Product", target: ["sku"] },
      });
    },
  });
  assert.equal(duplicate.status === "error" && duplicate.code, "DUPLICATE_SKU");
  assert.ok(duplicate.status === "error" && duplicate.fieldErrors.sku);

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const unrelated = await handleUpdateProductAction(changed, {
      ...base,
      update: async () => {
        throw new Prisma.PrismaClientKnownRequestError("unique", {
          code: "P2002",
          clientVersion: "test",
          meta: { modelName: "Product", target: ["seedKey"] },
        });
      },
    });
    assert.equal(unrelated.status === "error" && unrelated.code, "UNKNOWN");
  } finally {
    console.error = originalConsoleError;
  }

  const unchanged = await handleUpdateProductAction(formData(), {
    ...base,
    update: async () => ({ status: "unchanged", sku: "SKU-1" }),
  });
  assert.equal(unchanged.status, "unchanged");
  assert.equal(revalidations, 0);

  const success = await handleUpdateProductAction(changed, {
    ...base,
    update: async () => ({
      status: "updated",
      sku: "SKU-2",
      changedFields: ["sku"],
    }),
  });
  assert.deepEqual(success, { status: "success", sku: "SKU-2" });
  assert.equal(revalidations, 1);
});
