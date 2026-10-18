import { z } from "zod";

import { collectFieldErrors } from "./field-errors";

// Product field rules shared by the creation and edit forms (browser) and by
// the server actions, which remain the authority. No server-only imports.

const MAXIMUM_STOCK = 2_147_483_647;

export const PRODUCT_VALUE_FIELDS = [
  "sku",
  "name",
  "description",
  "category",
  "price",
  "stock",
] as const;

export type ProductValueField = (typeof PRODUCT_VALUE_FIELDS)[number];

export const productValuesSchema = z.object({
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

export function isProductValueField(value: string): value is ProductValueField {
  return (PRODUCT_VALUE_FIELDS as readonly string[]).includes(value);
}

// Browser pre-check. Returns per-field messages, or null when the values pass
// or when no issue maps to a form field (the server then decides).
export function productValueErrors(
  values: Record<string, unknown>,
): Partial<Record<ProductValueField, string>> | null {
  const parsed = productValuesSchema.safeParse(values);
  if (parsed.success) return null;
  const { fieldErrors } = collectFieldErrors(
    parsed.error.issues,
    isProductValueField,
  );
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}
