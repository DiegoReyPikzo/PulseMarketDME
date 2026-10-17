import "server-only";

import type { Prisma } from "../../generated/prisma/client";

import {
  customerListSelect,
  productListSelect,
  saleListSelect,
} from "./selects";

type ProductRow = Prisma.ProductGetPayload<{
  select: typeof productListSelect;
}>;
type CustomerRow = Prisma.CustomerGetPayload<{
  select: typeof customerListSelect;
}>;
type SaleRow = Prisma.SaleGetPayload<{ select: typeof saleListSelect }>;

export function serializeProduct(product: ProductRow) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    price: product.price.toFixed(2),
    stock: product.stock,
    createdAt: product.createdAt.toISOString(),
  };
}

export function serializeCustomer(customer: CustomerRow) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    createdAt: customer.createdAt.toISOString(),
  };
}

export function serializeSale(sale: SaleRow) {
  return {
    id: sale.id,
    customerId: sale.customerId,
    status: sale.status,
    saleDate: sale.saleDate.toISOString(),
    total: sale.total.toFixed(2),
    customer: {
      id: sale.customer.id,
      name: sale.customer.name,
      email: sale.customer.email,
    },
  };
}
