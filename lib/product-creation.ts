import "server-only";

import { z } from "zod";
import { Prisma, type Prisma as PrismaTypes } from "../generated/prisma/client";

const MAXIMUM_STOCK = 2_147_483_647;
const MAXIMUM_SORT_ORDER = 2_147_483_647;

export const createProductInputSchema = z.object({
  sku: z.string().trim().min(1, "El SKU es obligatorio.").max(64, "El SKU admite hasta 64 caracteres."),
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(160, "El nombre admite hasta 160 caracteres."),
  description: z
    .string()
    .optional()
    .default("")
    .transform((value) => (value.trim().length === 0 ? null : value)),
  category: z
    .string()
    .trim()
    .min(1, "La categoría es obligatoria.")
    .max(100, "La categoría admite hasta 100 caracteres."),
  price: z
    .string()
    .trim()
    .regex(
      /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/,
      "Ingresa un precio no negativo con hasta dos decimales y dentro del límite permitido.",
    ),
  stock: z
    .string()
    .trim()
    .optional()
    .default("0")
    .transform((value) => (value.length === 0 ? "0" : value))
    .pipe(
      z
        .string()
        .regex(
          /^(?:0|[1-9]\d{0,9})$/,
          "El stock debe ser un entero no negativo.",
        )
        .refine(
          (value) => Number(value) <= MAXIMUM_STOCK,
          "El stock no puede superar 2147483647.",
        ),
    ),
}).strict();

export type CreateProductInput = z.infer<typeof createProductInputSchema>;

export type CreatedProduct = {
  id: string;
  sku: string;
  sortOrder: number;
};

export interface ProductCreationRepository {
  findBySku(sku: string): Promise<{ id: string } | null>;
  findMaximumActiveSortOrder(): Promise<number | null>;
  create(data: {
    sku: string;
    name: string;
    description: string | null;
    category: string;
    price: Prisma.Decimal;
    stock: number;
    sortOrder: number;
  }): Promise<CreatedProduct>;
}

export class ProductCreationError extends Error {
  constructor(
    message: string,
    readonly code: "DUPLICATE_SKU" | "SORT_ORDER_LIMIT",
  ) {
    super(message);
    this.name = "ProductCreationError";
  }
}

export function createProductCreationRepository(
  transaction: PrismaTypes.TransactionClient,
): ProductCreationRepository {
  return {
    findBySku: (sku) =>
      transaction.product.findUnique({
        where: { sku },
        select: { id: true },
      }),
    findMaximumActiveSortOrder: async () => {
      const result = await transaction.product.aggregate({
        where: { deletedAt: null },
        _max: { sortOrder: true },
      });
      return result._max.sortOrder;
    },
    create: (data) =>
      transaction.product.create({
        data,
        select: { id: true, sku: true, sortOrder: true },
      }),
  };
}

export async function createProduct(
  repository: ProductCreationRepository,
  input: CreateProductInput,
): Promise<CreatedProduct> {
  const existing = await repository.findBySku(input.sku);
  if (existing) {
    throw new ProductCreationError(
      "Ese SKU ya está en uso y no se puede reutilizar.",
      "DUPLICATE_SKU",
    );
  }

  const maximumSortOrder = await repository.findMaximumActiveSortOrder();
  if (
    maximumSortOrder !== null &&
    maximumSortOrder >= MAXIMUM_SORT_ORDER
  ) {
    throw new ProductCreationError(
      "No se puede agregar el producto porque se alcanzó el límite de posiciones del catálogo.",
      "SORT_ORDER_LIMIT",
    );
  }

  return repository.create({
    sku: input.sku,
    name: input.name,
    description: input.description,
    category: input.category,
    price: new Prisma.Decimal(input.price),
    stock: Number(input.stock),
    sortOrder:
      maximumSortOrder === null ? 0 : maximumSortOrder + 1,
  });
}
