import "server-only";

import { z } from "zod";

import { Prisma, type Prisma as PrismaTypes } from "../generated/prisma/client";

const productIdsSchema = z
  .array(z.uuid())
  .min(1, "Selecciona al menos un producto.")
  .max(50, "Puedes modificar hasta 50 productos por lote.")
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "La selección contiene IDs duplicados.",
  });

const reorderIdsSchema = z
  .array(z.uuid())
  .min(2, "Selecciona al menos dos productos para reordenar.")
  .max(50, "Puedes reordenar hasta 50 productos por operación.")
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "La lista contiene IDs duplicados.",
  });

export const reorderProductInputSchema = z
  .object({
    ids: reorderIdsSchema,
    expectedIds: reorderIdsSchema,
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(Math.floor(Number.MAX_SAFE_INTEGER / 50)),
    pageSize: z.coerce.number().int().refine((value) => value === 20 || value === 50),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.ids.length !== input.expectedIds.length ||
      input.ids.some((id) => !input.expectedIds.includes(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["ids"],
        message: "El orden nuevo debe contener exactamente los productos de la página actual.",
      });
    }
  });

export type ReorderProductInput = z.infer<typeof reorderProductInputSchema>;

const adjustmentAmountSchema = z
  .string()
  .trim()
  .max(14)
  .regex(/^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, "El ajuste debe ser un número válido con hasta dos decimales.");

const bulkAdjustmentSchema = z
  .object({
    ids: productIdsSchema,
    operation: z.literal("adjust"),
    field: z.enum(["price", "stock"]),
    mode: z.enum(["fixed", "percentage"]),
    amount: adjustmentAmountSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const amount = Number(input.amount);

    if (
      input.mode === "percentage" &&
      (!Number.isFinite(amount) || amount < -100 || amount > 1000)
    ) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "El porcentaje debe estar entre -100 y 1000.",
      });
    }

    if (
      input.field === "stock" &&
      input.mode === "fixed" &&
      !/^-?(?:0|[1-9]\d{0,9})$/.test(input.amount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "El ajuste fijo de stock debe ser un número entero.",
      });
    }
  });

export const deleteProductInputSchema = z
  .object({ id: z.uuid() })
  .strict();

export const bulkProductMutationInputSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        ids: productIdsSchema,
        operation: z.literal("delete"),
      })
      .strict(),
    z
      .object({
        ids: productIdsSchema,
        operation: z.literal("category"),
        category: z.string().trim().min(1, "La categoría no puede estar vacía.").max(100),
      })
      .strict(),
    bulkAdjustmentSchema,
  ],
);

export type BulkProductMutationInput = z.infer<
  typeof bulkProductMutationInputSchema
>;

export type ProductMutationRecord = {
  id: string;
  deletedAt: Date | null;
  price: Prisma.Decimal;
  stock: number;
  sortOrder: number;
};

// `expected` holds the value read before computing the adjustment; the write
// only applies while the row still has it, so a concurrent edit is not lost.
export type ProductValueUpdate =
  | { id: string; price: Prisma.Decimal; expected: { price: Prisma.Decimal } }
  | { id: string; stock: number; expected: { stock: number } };

export interface ProductMutationRepository {
  findByIds(ids: readonly string[]): Promise<ProductMutationRecord[]>;
  findActivePage(page: number, pageSize: number): Promise<string[]>;
  softDelete(ids: readonly string[], deletedAt: Date): Promise<number>;
  setCategory(ids: readonly string[], category: string): Promise<number>;
  updateValues(updates: readonly ProductValueUpdate[]): Promise<number>;
  updatePositions(updates: readonly { id: string; sortOrder: number }[]): Promise<number>;
}

export class ProductMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductMutationError";
  }
}

export class StaleProductOrderError extends ProductMutationError {
  constructor() {
    super(
      "El orden de esta página cambió desde que la abriste. Se restauró el orden anterior; recarga la página e inténtalo de nuevo.",
    );
    this.name = "StaleProductOrderError";
  }
}

export function createProductMutationRepository(
  transaction: PrismaTypes.TransactionClient,
): ProductMutationRepository {
  return {
    findByIds: (ids) =>
      transaction.product.findMany({
        where: { id: { in: [...ids] } },
        select: {
          id: true,
          deletedAt: true,
          price: true,
          stock: true,
          sortOrder: true,
        },
      }),
    findActivePage: async (page, pageSize) => {
      const products = await transaction.product.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true },
      });
      return products.map(({ id }) => id);
    },
    softDelete: async (ids, deletedAt) => {
      const result = await transaction.product.updateMany({
        where: { id: { in: [...ids] }, deletedAt: null },
        data: { deletedAt },
      });
      return result.count;
    },
    setCategory: async (ids, category) => {
      const result = await transaction.product.updateMany({
        where: { id: { in: [...ids] }, deletedAt: null },
        data: { category },
      });
      return result.count;
    },
    updateValues: async (updates) => {
      const results = await Promise.all(
        updates.map(({ id, expected, ...data }) =>
          transaction.product.updateMany({
            where: { id, deletedAt: null, ...expected },
            data,
          }),
        ),
      );
      return results.reduce((count, result) => count + result.count, 0);
    },
    updatePositions: async (updates) => {
      let count = 0;
      for (const { id, sortOrder } of updates) {
        const result = await transaction.product.updateMany({
          where: { id, deletedAt: null },
          data: { sortOrder },
        });
        count += result.count;
      }
      return count;
    },
  };
}

export async function reorderProducts(
  repository: ProductMutationRepository,
  input: ReorderProductInput,
): Promise<void> {
  const parsed = reorderProductInputSchema.parse(input);
  const currentPageIds = await repository.findActivePage(
    parsed.page,
    parsed.pageSize,
  );
  if (
    currentPageIds.length !== parsed.expectedIds.length ||
    currentPageIds.some((id, index) => id !== parsed.expectedIds[index])
  ) {
    throw new StaleProductOrderError();
  }

  const products = await assertProductsAreActive(repository, parsed.ids);
  const positions = products
    .map((product) => product.sortOrder)
    .sort((left, right) => left - right);
  const updates = parsed.ids.map((id, index) => ({
    id,
    sortOrder: positions[index],
  }));

  const count = await repository.updatePositions(updates);
  assertUpdatedCount(count, parsed.ids.length);
}

export async function softDeleteProduct(
  repository: ProductMutationRepository,
  id: string,
  deletedAt: Date,
): Promise<void> {
  await assertProductsAreActive(repository, [id]);
  const count = await repository.softDelete([id], deletedAt);
  assertUpdatedCount(count, 1);
}

export async function mutateProducts(
  repository: ProductMutationRepository,
  input: BulkProductMutationInput,
  deletedAt: Date,
): Promise<number> {
  const records = await assertProductsAreActive(repository, input.ids);

  if (input.operation === "delete") {
    const count = await repository.softDelete(input.ids, deletedAt);
    assertUpdatedCount(count, input.ids.length);
    return count;
  }

  if (input.operation === "category") {
    const count = await repository.setCategory(input.ids, input.category);
    assertUpdatedCount(count, input.ids.length);
    return count;
  }

  const updates = records.map((product): ProductValueUpdate => {
    const amount = new Prisma.Decimal(input.amount);
    const adjusted =
      input.mode === "percentage"
        ? (input.field === "price"
            ? product.price
            : new Prisma.Decimal(product.stock)
          )
            .mul(new Prisma.Decimal(1).plus(amount.div(100)))
        : (input.field === "price"
            ? product.price
            : new Prisma.Decimal(product.stock)
          ).plus(amount);

    if (input.field === "price") {
      const price = adjusted.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (price.isNegative() || price.gt("9999999999.99")) {
        throw new ProductMutationError(
          `El ajuste dejaría el precio del producto ${product.id} fuera del rango permitido.`,
        );
      }
      return { id: product.id, price, expected: { price: product.price } };
    }

    const stock = adjusted.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    if (!stock.isInteger() || stock.isNegative() || stock.gt(2147483647)) {
      throw new ProductMutationError(
        `El ajuste dejaría el stock del producto ${product.id} fuera del rango permitido.`,
      );
    }
    return {
      id: product.id,
      stock: stock.toNumber(),
      expected: { stock: product.stock },
    };
  });

  // A conflicting row makes the count fall short; the thrown error rolls back
  // the whole batch transaction.
  const count = await repository.updateValues(updates);
  assertUpdatedCount(count, input.ids.length);
  return count;
}

async function assertProductsAreActive(
  repository: ProductMutationRepository,
  ids: readonly string[],
): Promise<ProductMutationRecord[]> {
  const products = await repository.findByIds(ids);
  const byId = new Map(products.map((product) => [product.id, product]));
  const missing = ids.filter((id) => !byId.has(id));
  const deleted = ids.filter((id) => byId.get(id)?.deletedAt !== null && byId.has(id));

  if (missing.length > 0) {
    throw new ProductMutationError(
      `No existen productos con estos IDs: ${missing.join(", ")}.`,
    );
  }
  if (deleted.length > 0) {
    throw new ProductMutationError(
      `Estos productos ya están eliminados: ${deleted.join(", ")}.`,
    );
  }

  return products;
}

function assertUpdatedCount(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ProductMutationError(
      "El catálogo cambió durante la operación. Recarga los productos e inténtalo de nuevo.",
    );
  }
}
