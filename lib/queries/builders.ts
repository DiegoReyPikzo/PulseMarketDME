import "server-only";

import type { Prisma } from "../../generated/prisma/client";

import type {
  CustomerListInput,
  ProductListInput,
  SaleListInput,
} from "./inputs";

export function buildProductWhere(
  input: ProductListInput,
): Prisma.ProductWhereInput {
  return {
    deletedAt: null,
    ...(input.category ? { category: input.category } : {}),
    ...(input.search
      ? {
          OR: [
            { name: { contains: input.search, mode: "insensitive" } },
            { sku: { contains: input.search, mode: "insensitive" } },
            { description: { contains: input.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export function buildProductOrderBy(
  input: ProductListInput,
): Prisma.ProductOrderByWithRelationInput[] {
  const tieBreaker = {
    id: "asc",
  } satisfies Prisma.ProductOrderByWithRelationInput;

  switch (input.sortBy) {
    case "name":
      return [{ name: input.sortOrder }, tieBreaker];
    case "sku":
      return [{ sku: input.sortOrder }, tieBreaker];
    case "price":
      return [{ price: input.sortOrder }, tieBreaker];
    case "createdAt":
      return [{ createdAt: input.sortOrder }, tieBreaker];
    case "sortOrder":
      return [{ sortOrder: input.sortOrder }, tieBreaker];
  }
}

// The customer directory lists active customers only. Sales filters do not use
// this builder, so sales of soft-deleted customers stay searchable.
export function buildCustomerWhere(
  input: CustomerListInput,
): Prisma.CustomerWhereInput {
  return {
    deletedAt: null,
    ...(input.search
      ? {
          OR: [
            { name: { contains: input.search, mode: "insensitive" } },
            { email: { contains: input.search, mode: "insensitive" } },
            { phone: { contains: input.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export function buildCustomerOrderBy(
  input: CustomerListInput,
): Prisma.CustomerOrderByWithRelationInput[] {
  const tieBreaker = {
    id: "asc",
  } satisfies Prisma.CustomerOrderByWithRelationInput;

  switch (input.sortBy) {
    case "name":
      return [{ name: input.sortOrder }, tieBreaker];
    case "email":
      return [{ email: input.sortOrder }, tieBreaker];
    case "createdAt":
      return [{ createdAt: input.sortOrder }, tieBreaker];
  }
}

export function buildSaleWhere(input: SaleListInput): Prisma.SaleWhereInput {
  const saleDate =
    input.from || input.to
      ? {
          ...(input.from ? { gte: new Date(input.from) } : {}),
          ...(input.to ? { lte: new Date(input.to) } : {}),
        }
      : undefined;

  return {
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(saleDate ? { saleDate } : {}),
    ...(input.search
      ? {
          customer: {
            is: {
              OR: [
                { name: { contains: input.search, mode: "insensitive" } },
                { email: { contains: input.search, mode: "insensitive" } },
              ],
            },
          },
        }
      : {}),
  };
}

export function buildSaleOrderBy(
  input: SaleListInput,
): Prisma.SaleOrderByWithRelationInput[] {
  const tieBreaker = {
    id: "asc",
  } satisfies Prisma.SaleOrderByWithRelationInput;

  switch (input.sortBy) {
    case "saleDate":
      return [{ saleDate: input.sortOrder }, tieBreaker];
    case "total":
      return [{ total: input.sortOrder }, tieBreaker];
    case "createdAt":
      return [{ createdAt: input.sortOrder }, tieBreaker];
  }
}
