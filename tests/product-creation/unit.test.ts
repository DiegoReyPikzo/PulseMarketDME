import assert from "node:assert/strict";
import { test } from "vitest";

import { Prisma } from "../../generated/prisma/client";
import type { Session } from "next-auth";
import { isAuthorizedProviderIdentity } from "../../lib/auth-authorization";
import { requireAuthorizedSession } from "../../lib/require-authenticated-session";
import {
  createProduct,
  createProductInputSchema,
  ProductCreationError,
  type CreateProductInput,
  type ProductCreationRepository,
} from "../../lib/product-creation";
import {
  handleCreateProductAction,
  isSkuUniqueViolation,
  type CreateProductActionState,
} from "../../lib/product-creation-action";

function parseInput(
  overrides: Partial<Record<keyof CreateProductInput, unknown>> = {},
): CreateProductInput {
  return createProductInputSchema.parse({
    sku: " NEW-SKU ",
    name: " New product ",
    description: " Description ",
    category: " Stationery ",
    price: "12.34",
    stock: "7",
    ...overrides,
  });
}

function createMemoryRepository(initialMaximum: number | null = 9): {
  repository: ProductCreationRepository;
  inserted: Array<Parameters<ProductCreationRepository["create"]>[0]>;
} {
  const skus = new Set<string>();
  const inserted: Array<Parameters<ProductCreationRepository["create"]>[0]> = [];
  const repository: ProductCreationRepository = {
    async findBySku(sku) {
      return skus.has(sku) ? { id: "existing" } : null;
    },
    async findMaximumActiveSortOrder() {
      return initialMaximum;
    },
    async create(data) {
      inserted.push(data);
      skus.add(data.sku);
      return { id: "created", sku: data.sku, sortOrder: data.sortOrder };
    },
  };
  return { repository, inserted };
}

function formData(
  values: Record<string, string> = {
    sku: "SKU-1",
    name: "Test product",
    category: "Books",
    price: "0.00",
    stock: "",
  },
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

test("rejects an unauthorized action before validating or attempting a write", async () => {
  let writes = 0;
  const unauthorisedSession: Session = {
    expires: "2026-10-18T00:00:00.000Z",
    user: {
      provider: "google",
      providerAccountId: "unapproved-google-account",
    },
  };
  await assert.rejects(
    handleCreateProductAction(formData({ unexpected: "value" }), {
      async requireSession() {
        return requireAuthorizedSession(
          unauthorisedSession,
          (session) =>
            isAuthorizedProviderIdentity(
              {
                provider: session.user?.provider ?? "",
                providerAccountId: session.user?.providerAccountId ?? "",
              },
              { PULSEMARKET_AUTHORIZED_ACCOUNTS: "[]" },
            ),
          () => {
            throw new Error("Unauthenticated");
          },
          () => {
            throw new Error("AccessDenied");
          },
        );
      },
      async create() {
        writes += 1;
        return { sku: "unused" };
      },
      revalidate() {},
    }),
    /AccessDenied/,
  );
  assert.equal(writes, 0);
});

test("validates required fields and actual schema length limits", () => {
  const base = {
    sku: "SKU",
    name: "Name",
    description: "",
    category: "Category",
    price: "1.00",
    stock: "0",
  };
  for (const key of ["sku", "name", "category"] as const) {
    assert.equal(
      createProductInputSchema.safeParse({ ...base, [key]: "  " }).success,
      false,
    );
  }
  assert.equal(
    createProductInputSchema.safeParse({ ...base, sku: "S".repeat(65) }).success,
    false,
  );
  assert.equal(
    createProductInputSchema.safeParse({ ...base, name: "N".repeat(161) }).success,
    false,
  );
  assert.equal(
    createProductInputSchema.safeParse({ ...base, category: "C".repeat(101) })
      .success,
    false,
  );
  assert.equal(
    createProductInputSchema.safeParse({ ...base, sku: "S".repeat(64) }).success,
    true,
  );
  assert.equal(
    createProductInputSchema.safeParse({ ...base, name: "N".repeat(160) })
      .success,
    true,
  );
  assert.equal(
    createProductInputSchema.safeParse({ ...base, category: "C".repeat(100) })
      .success,
    true,
  );
});

test("trims SKU and category and normalizes an empty description to null", () => {
  const parsed = parseInput({
    sku: " SKU-1 ",
    category: " General ",
    description: "   ",
  });
  assert.equal(parsed.sku, "SKU-1");
  assert.equal(parsed.category, "General");
  assert.equal(parsed.description, null);
  assert.equal(
    createProductInputSchema.safeParse({
      sku: "SKU",
      name: "Name",
      description: "",
      category: "   ",
      price: "1.00",
      stock: "1",
    }).success,
    false,
  );
});

test("accepts zero and exact decimals but rejects negative, imprecise, and out-of-range prices", () => {
  for (const price of ["0.00", "0", "9999999999.99"]) {
    assert.equal(createProductInputSchema.safeParse({
      sku: "SKU",
      name: "Name",
      description: "",
      category: "Books",
      price,
      stock: "0",
    }).success, true);
  }
  for (const price of ["-0.01", "1.001", "10000000000.00", "1e2"]) {
    assert.equal(createProductInputSchema.safeParse({
      sku: "SKU",
      name: "Name",
      description: "",
      category: "Books",
      price,
      stock: "0",
    }).success, false);
  }

  const { inserted, repository } = createMemoryRepository();
  return createProduct(repository, parseInput({ price: "0.01" })).then(() => {
    assert.ok(inserted[0].price instanceof Prisma.Decimal);
    assert.equal(inserted[0].price.toFixed(2), "0.01");
  });
});

test("defaults blank or absent stock to zero and enforces PostgreSQL Int bounds", () => {
  const common = {
    sku: "SKU",
    name: "Name",
    description: "",
    category: "Books",
    price: "1.00",
  };
  for (const stock of ["", "0", "2147483647"]) {
    assert.equal(
      createProductInputSchema.safeParse({ ...common, stock }).success,
      true,
    );
  }
  assert.equal(
    createProductInputSchema.safeParse({ ...common, stock: "-1" }).success,
    false,
  );
  assert.equal(
    createProductInputSchema.safeParse({ ...common, stock: "2147483648" })
      .success,
    false,
  );
  const parsedWithoutStock = createProductInputSchema.safeParse(common);
  assert.equal(parsedWithoutStock.success, true);
  if (parsedWithoutStock.success) assert.equal(parsedWithoutStock.data.stock, "0");
});

test("rejects internal model fields from submitted form data", async () => {
  let writes = 0;
  const result = await handleCreateProductAction(
    formData({ sku: "SKU", name: "Name", category: "Books", price: "1.00", id: "x" }),
    {
      async requireSession() {},
      async create() {
        writes += 1;
        return { sku: "SKU" };
      },
      revalidate() {},
    },
  );
  assert.equal(result.status, "error");
  assert.equal(writes, 0);
});

test("assigns position after the active maximum without changing existing rows", async () => {
  const { inserted, repository } = createMemoryRepository(42);
  const created = await createProduct(repository, parseInput());
  assert.equal(created.sortOrder, 43);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].sortOrder, 43);
});

test("uses position zero when the active catalog is empty", async () => {
  const { repository } = createMemoryRepository(null);
  const created = await createProduct(repository, parseInput());
  assert.equal(created.sortOrder, 0);
});

test("rejects insertion when the active position range is exhausted", async () => {
  const { inserted, repository } = createMemoryRepository(2_147_483_647);
  await assert.rejects(
    createProduct(repository, parseInput()),
    (error: unknown) =>
      error instanceof ProductCreationError &&
      error.code === "SORT_ORDER_LIMIT",
  );
  assert.equal(inserted.length, 0);
});

test("recognizes only Prisma unique violations that identify the Product SKU", () => {
  assert.equal(
    isSkuUniqueViolation({ modelName: "Product", target: ["sku"] }),
    true,
  );
  assert.equal(isSkuUniqueViolation({ target: "Product_sku_key" }), true);
  assert.equal(
    isSkuUniqueViolation({ modelName: "Product", target: ["seedKey"] }),
    false,
  );
  assert.equal(
    isSkuUniqueViolation({ modelName: "Customer", target: ["sku"] }),
    false,
  );
  assert.equal(isSkuUniqueViolation({}), false);
});

// Shape built by @prisma/client 7.10.1 for a @prisma/adapter-pg 23505 error:
// meta carries the adapter error (and its table), not `target`.
function adapterUniqueMeta(
  index: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...extra,
    table: "Product",
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: {
        originalCode: "23505",
        kind: "UniqueConstraintViolation",
        constraint: { index },
        table: "Product",
      },
    },
  };
}

test("recognizes the adapter-pg UNIQUE violation shape for the SKU index only", () => {
  assert.equal(isSkuUniqueViolation(adapterUniqueMeta("Product_sku_key")), true);
  assert.equal(
    isSkuUniqueViolation(
      adapterUniqueMeta("Product_sku_key", { modelName: "Product" }),
    ),
    true,
  );
  assert.equal(
    isSkuUniqueViolation(adapterUniqueMeta("Product_seedKey_key")),
    false,
  );
  assert.equal(
    isSkuUniqueViolation(
      adapterUniqueMeta("Product_sku_key", { modelName: "Customer" }),
    ),
    false,
  );
  assert.equal(
    isSkuUniqueViolation({ driverAdapterError: { cause: { constraint: { fields: ["sku"] } } } }),
    false,
  );
});

test("maps an adapter-pg SKU violation to SKU field feedback and keeps other indexes generic", async () => {
  const skuResult = await handleCreateProductAction(formData(), {
    async requireSession() {},
    async create() {
      throw new Prisma.PrismaClientKnownRequestError("unique violation", {
        code: "P2002",
        clientVersion: "test",
        meta: adapterUniqueMeta("Product_sku_key"),
      });
    },
    revalidate() {
      assert.fail("A duplicate SKU must not revalidate.");
    },
  });
  assert.equal(skuResult.status, "error");
  if (skuResult.status === "error") {
    assert.equal(
      skuResult.fieldErrors.sku,
      "Ese SKU ya está en uso y no se puede reutilizar.",
    );
    assert.doesNotMatch(skuResult.message, /constraint|Product_sku_key/);
  }

  const originalConsoleError = console.error;
  console.error = () => {};
  let otherResult: CreateProductActionState;
  try {
    otherResult = await handleCreateProductAction(formData(), {
      async requireSession() {},
      async create() {
        throw new Prisma.PrismaClientKnownRequestError("unique violation", {
          code: "P2002",
          clientVersion: "test",
          meta: adapterUniqueMeta("Product_seedKey_key"),
        });
      },
      revalidate() {
        assert.fail("An unsuccessful create must not revalidate.");
      },
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(otherResult.status, "error");
  if (otherResult.status === "error") {
    assert.deepEqual(otherResult.fieldErrors, {});
    assert.match(otherResult.message, /No se pudo crear/);
  }
});

test("returns field errors for an active or soft-deleted duplicate SKU", async () => {
  for (const existingType of ["active", "soft-deleted"]) {
    const error = new ProductCreationError(
      `Duplicate SKU reserved by ${existingType}`,
      "DUPLICATE_SKU",
    );
    const result = await handleCreateProductAction(formData(), {
      async requireSession() {},
      async create() {
        throw error;
      },
      revalidate() {
        assert.fail("Duplicate SKU must not revalidate.");
      },
    });
    assert.equal(result.status, "error");
    if (result.status === "error") {
      assert.ok(result.fieldErrors.sku);
      assert.match(result.message, /Duplicate SKU/);
    }
  }
});

test("maps a serializable transaction conflict to recoverable feedback", async () => {
  const conflict = new Prisma.PrismaClientKnownRequestError(
    "serialization conflict",
    { code: "P2034", clientVersion: "test" },
  );
  const result = await handleCreateProductAction(formData(), {
    async requireSession() {},
    async create() {
      throw conflict;
    },
    revalidate() {
      assert.fail("A failed transaction must not revalidate as success.");
    },
  });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.match(result.message, /Vuelve a intentarlo/);
  }
});

test("maps only a SKU-specific P2002 to SKU field feedback", async () => {
  const skuError = new Prisma.PrismaClientKnownRequestError(
    "unique violation",
    {
      code: "P2002",
      clientVersion: "test",
      meta: { modelName: "Product", target: ["sku"] },
    },
  );
  const result = await handleCreateProductAction(formData(), {
    async requireSession() {},
    async create() {
      throw skuError;
    },
    revalidate() {
      assert.fail("A duplicate SKU must not revalidate.");
    },
  });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(
      result.fieldErrors.sku,
      "Ese SKU ya está en uso y no se puede reutilizar.",
    );
    assert.doesNotMatch(result.message, /constraint|Product_sku_key/);
  }
});

test("revalidates only after a confirmed create and returns the created SKU", async () => {
  let revalidations = 0;
  const result = await handleCreateProductAction(formData(), {
    async requireSession() {},
    async create(input) {
      assert.equal(input.price, "0.00");
      assert.equal(input.stock, "0");
      assert.equal(input.description, null);
      return { sku: input.sku };
    },
    revalidate() {
      revalidations += 1;
    },
  });
  assert.deepEqual(result, { status: "success", sku: "SKU-1" });
  assert.equal(revalidations, 1);
});

test("does not label an unrelated P2002 constraint as a duplicate SKU", async () => {
  const unrelatedUniqueError = new Prisma.PrismaClientKnownRequestError(
    "unique violation",
    {
      code: "P2002",
      clientVersion: "test",
      meta: { modelName: "Product", target: ["seedKey"] },
    },
  );
  const originalConsoleError = console.error;
  console.error = () => {};
  let result: CreateProductActionState;
  try {
    result = await handleCreateProductAction(formData(), {
      async requireSession() {},
      async create() {
        throw unrelatedUniqueError;
      },
      revalidate() {
        assert.fail("An unsuccessful create must not revalidate.");
      },
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.doesNotMatch(result.message, /SKU ya está/);
    assert.match(result.message, /No se pudo crear/);
  }
});
