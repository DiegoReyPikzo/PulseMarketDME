import "server-only";

import type { z } from "zod";
import { Prisma, type Prisma as PrismaTypes } from "../generated/prisma/client";
import { productValuesSchema } from "./validation/product";

const MAXIMUM_SORT_ORDER = 2_147_483_647;

export const createProductInputSchema = productValuesSchema;

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
