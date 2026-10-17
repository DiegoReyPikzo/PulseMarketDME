import "server-only";

import { z } from "zod";

import { Prisma, type Prisma as PrismaTypes } from "../generated/prisma/client";
import { createProductInputSchema } from "./product-creation";

const MAXIMUM_STOCK = 2_147_483_647;

export const PRODUCT_EDITABLE_FIELDS = [
  "sku",
  "name",
  "description",
  "category",
  "price",
  "stock",
] as const;

export type ProductEditableField = (typeof PRODUCT_EDITABLE_FIELDS)[number];

// Original values come from the browser. They are untrusted input used only to
// detect conflicts; they never authorize a write or replace database values.
// Legacy rows may have no category, so an empty original category means NULL.
const originalProductValuesSchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(160),
    description: z
      .string()
      .transform((value) => (value.trim().length === 0 ? null : value)),
    category: z
      .string()
      .trim()
      .max(100)
      .transform((value) => (value.length === 0 ? null : value)),
    price: z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/),
    stock: z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d{0,9})$/)
      .refine((value) => Number(value) <= MAXIMUM_STOCK),
  })
  .strict();

export const updateProductInputSchema = z
  .object({
    productId: z.uuid(),
    values: createProductInputSchema,
    original: originalProductValuesSchema,
  })
  .strict();

export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

export type ProductEditableValues = {
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  price: Prisma.Decimal;
  stock: number;
};

export type ProductForEdit = ProductEditableValues & {
  id: string;
  deletedAt: Date | null;
};

export type UpdateProductResult =
  | { status: "updated"; sku: string; changedFields: ProductEditableField[] }
  | { status: "unchanged"; sku: string };

export interface ProductUpdateRepository {
  findById(id: string): Promise<ProductForEdit | null>;
  findIdBySku(sku: string): Promise<{ id: string } | null>;
  // Writes `data` only while every `expected` value still matches the row.
  updateIfUnchanged(
    id: string,
    expected: Partial<ProductEditableValues>,
    data: Partial<ProductEditableValues>,
  ): Promise<number>;
}

export class ProductUpdateError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "DELETED" | "DUPLICATE_SKU" | "CONFLICT",
    readonly conflictFields: readonly ProductEditableField[] = [],
  ) {
    super(message);
    this.name = "ProductUpdateError";
  }
}

const FIELD_LABELS: Record<ProductEditableField, string> = {
  sku: "SKU",
  name: "nombre",
  description: "descripción",
  category: "categoría",
  price: "precio",
  stock: "stock",
};

const productForEditSelect = {
  id: true,
  sku: true,
  name: true,
  description: true,
  category: true,
  price: true,
  stock: true,
  deletedAt: true,
} satisfies Prisma.ProductSelect;

export function createProductUpdateRepository(
  client: PrismaTypes.TransactionClient,
): ProductUpdateRepository {
  return {
    findById: (id) =>
      client.product.findUnique({ where: { id }, select: productForEditSelect }),
    findIdBySku: (sku) =>
      client.product.findUnique({ where: { sku }, select: { id: true } }),
    updateIfUnchanged: async (id, expected, data) => {
      // A single conditional UPDATE: PostgreSQL re-checks the WHERE clause
      // against the latest committed row, so a concurrent change makes it
      // match zero rows instead of being overwritten.
      const result = await client.product.updateMany({
        where: { id, deletedAt: null, ...expected },
        data,
      });
      return result.count;
    },
  };
}

function toEditableValues(values: {
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  price: string;
  stock: string;
}): ProductEditableValues {
  return {
    sku: values.sku,
    name: values.name,
    description: values.description,
    category: values.category,
    price: new Prisma.Decimal(values.price),
    stock: Number(values.stock),
  };
}

function sameValue(
  field: ProductEditableField,
  left: ProductEditableValues,
  right: ProductEditableValues,
): boolean {
  return field === "price"
    ? left.price.equals(right.price)
    : left[field] === right[field];
}

function pickFields(
  values: ProductEditableValues,
  fields: readonly ProductEditableField[],
): Partial<ProductEditableValues> {
  return Object.fromEntries(
    fields.map((field) => [field, values[field]]),
  ) as Partial<ProductEditableValues>;
}

function conflictError(fields: readonly ProductEditableField[]) {
  const labels = fields.map((field) => FIELD_LABELS[field]).join(", ");
  return new ProductUpdateError(
    `Otro cambio modificó ${labels} desde que abriste el formulario. Recarga los datos del producto y vuelve a aplicar tus cambios.`,
    "CONFLICT",
    fields,
  );
}

function assertEditable(product: ProductForEdit | null): ProductForEdit {
  if (!product) {
    throw new ProductUpdateError("El producto ya no existe.", "NOT_FOUND");
  }
  if (product.deletedAt !== null) {
    throw new ProductUpdateError(
      "El producto fue eliminado del catálogo y no se puede editar.",
      "DELETED",
    );
  }
  return product;
}

export async function findProductForEdit(
  repository: ProductUpdateRepository,
  id: string,
): Promise<ProductForEdit> {
  return assertEditable(await repository.findById(id));
}

// `parsed` is the output of updateProductInputSchema (already normalized).
export async function updateProduct(
  repository: ProductUpdateRepository,
  parsed: UpdateProductInput,
): Promise<UpdateProductResult> {
  const next = toEditableValues(parsed.values);
  const original = toEditableValues(parsed.original);

  const current = assertEditable(await repository.findById(parsed.productId));
  const changedFields = PRODUCT_EDITABLE_FIELDS.filter(
    (field) => !sameValue(field, next, original),
  );
  if (changedFields.length === 0) {
    return { status: "unchanged", sku: current.sku };
  }

  const staleFields = changedFields.filter(
    (field) => !sameValue(field, current, original),
  );
  if (staleFields.length > 0) throw conflictError(staleFields);

  if (changedFields.includes("sku")) {
    const owner = await repository.findIdBySku(next.sku);
    if (owner && owner.id !== parsed.productId) {
      throw new ProductUpdateError(
        "Ese SKU ya está en uso y no se puede reutilizar.",
        "DUPLICATE_SKU",
      );
    }
  }

  const count = await repository.updateIfUnchanged(
    parsed.productId,
    pickFields(original, changedFields),
    pickFields(next, changedFields),
  );
  if (count !== 1) {
    const latest = assertEditable(await repository.findById(parsed.productId));
    const latestStale = changedFields.filter(
      (field) => !sameValue(field, latest, original),
    );
    throw conflictError(latestStale.length > 0 ? latestStale : changedFields);
  }

  return { status: "updated", sku: next.sku, changedFields };
}
