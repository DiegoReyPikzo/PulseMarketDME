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
};

export type ProductValueUpdate = {
  id: string;
  price?: Prisma.Decimal;
  stock?: number;
};

export interface ProductMutationRepository {
  findByIds(ids: readonly string[]): Promise<ProductMutationRecord[]>;
  softDelete(ids: readonly string[], deletedAt: Date): Promise<number>;
  setCategory(ids: readonly string[], category: string): Promise<number>;
  updateValues(updates: readonly ProductValueUpdate[]): Promise<number>;
}

export class ProductMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductMutationError";
  }
}

export function createProductMutationRepository(
  transaction: PrismaTypes.TransactionClient,
): ProductMutationRepository {
  return {
    findByIds: (ids) =>
      transaction.product.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, deletedAt: true, price: true, stock: true },
      }),
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
        updates.map(({ id, ...data }) =>
          transaction.product.updateMany({
            where: { id, deletedAt: null },
            data,
          }),
        ),
      );
      return results.reduce((count, result) => count + result.count, 0);
    },
  };
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

  const updates = records.map((product) => {
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
      return { id: product.id, price };
    }

    const stock = adjusted.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    if (!stock.isInteger() || stock.isNegative() || stock.gt(2147483647)) {
      throw new ProductMutationError(
        `El ajuste dejaría el stock del producto ${product.id} fuera del rango permitido.`,
      );
    }
    return { id: product.id, stock: stock.toNumber() };
  });

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
