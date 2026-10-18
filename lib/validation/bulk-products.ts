import { z } from "zod";

// Bulk catalog mutation rules shared by the catalog bulk form (browser) and the
// server action, which remains the authority. No server-only imports.

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

// Reads the bulk form (selected IDs as JSON in `productIds` plus the operation
// fields) and validates it. The server action and the browser form both call
// this, so they accept and reject exactly the same submissions.
export function parseBulkProductMutationForm(
  formData: FormData,
):
  | { success: true; data: BulkProductMutationInput }
  | { success: false; message: string } {
  const entries = [...formData.entries()];
  const entryNames = entries.map(([name]) => name);
  if (new Set(entryNames).size !== entryNames.length) {
    return { success: false, message: "La selección contiene campos repetidos." };
  }
  const fields = Object.fromEntries(entries);
  const idsValue = fields.productIds;
  if (typeof idsValue !== "string") {
    return { success: false, message: "La selección de productos no es válida." };
  }

  let ids: unknown;
  try {
    ids = JSON.parse(idsValue);
  } catch {
    return { success: false, message: "La selección de productos no es válida." };
  }

  const fieldsWithoutIds = Object.fromEntries(
    entries.filter(([name]) => name !== "productIds"),
  );
  const candidate = { ...fieldsWithoutIds, ids };
  const parsed = bulkProductMutationInputSchema.safeParse(candidate);

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues.map((issue) => issue.message).join(" "),
    };
  }
  return { success: true, data: parsed.data };
}
