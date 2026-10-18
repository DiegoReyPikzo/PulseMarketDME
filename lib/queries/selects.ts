import "server-only";

import type { Prisma } from "../../generated/prisma/client";

export const productListSelect = {
  id: true,
  sku: true,
  name: true,
  category: true,
  price: true,
  stock: true,
  createdAt: true,
} satisfies Prisma.ProductSelect;

export const customerListSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  createdAt: true,
} satisfies Prisma.CustomerSelect;

export const saleListSelect = {
  id: true,
  customerId: true,
  status: true,
  saleDate: true,
  total: true,
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.SaleSelect;
