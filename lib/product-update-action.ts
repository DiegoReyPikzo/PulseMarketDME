import "server-only";

import { z } from "zod";

import { Prisma } from "../generated/prisma/client";
import { isSkuUniqueViolation } from "./product-creation-action";
import {
  PRODUCT_EDITABLE_FIELDS,
  ProductUpdateError,
  updateProductInputSchema,
  type ProductEditableField,
  type ProductForEdit,
  type UpdateProductInput,
  type UpdateProductResult,
} from "./product-update";

export type EditableProductValues = Record<ProductEditableField, string>;

export type GetProductForEditActionState =
  | { status: "found"; product: { id: string } & EditableProductValues }
  | {
      status: "error";
      code: "INVALID" | "NOT_FOUND" | "DELETED" | "UNKNOWN";
      message: string;
    };

export type UpdateProductActionState =
  | { status: "success"; sku: string }
  | { status: "unchanged"; message: string }
  | {
      status: "error";
      code:
        | "INVALID"
        | "VALIDATION"
        | "NOT_FOUND"
        | "DELETED"
        | "DUPLICATE_SKU"
        | "CONFLICT"
        | "UNKNOWN";
      message: string;
      fieldErrors: Partial<Record<ProductEditableField, string>>;
      conflictFields: ProductEditableField[];
    };

export type GetProductForEditDependencies = {
  requireSession(): Promise<unknown>;
  find(id: string): Promise<ProductForEdit>;
};

export type UpdateProductActionDependencies = {
  requireSession(): Promise<unknown>;
  update(input: UpdateProductInput): Promise<UpdateProductResult>;
  revalidate(): void;
};

const ORIGINAL_PREFIX = "original.";
const productIdSchema = z.object({ productId: z.uuid() }).strict();

function serializeForEdit(product: ProductForEdit) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description ?? "",
    category: product.category ?? "",
    price: product.price.toFixed(2),
    stock: String(product.stock),
  };
}

function isEditableField(value: string): value is ProductEditableField {
  return (PRODUCT_EDITABLE_FIELDS as readonly string[]).includes(value);
}

export async function handleGetProductForEditAction(
  formData: FormData,
  dependencies: GetProductForEditDependencies,
): Promise<GetProductForEditActionState> {
  await dependencies.requireSession();

  const entries = [...formData.entries()];
  const parsed = productIdSchema.safeParse(
    entries.length === 1 ? Object.fromEntries(entries) : {},
  );
  if (!parsed.success) {
    return {
      status: "error",
      code: "INVALID",
      message: "El identificador del producto no es válido.",
    };
  }

  try {
    return {
      status: "found",
      product: serializeForEdit(await dependencies.find(parsed.data.productId)),
    };
  } catch (error: unknown) {
    if (
      error instanceof ProductUpdateError &&
      (error.code === "NOT_FOUND" || error.code === "DELETED")
    ) {
      return { status: "error", code: error.code, message: error.message };
    }
    console.error("Product edit lookup failed.", error);
    return {
      status: "error",
      code: "UNKNOWN",
      message: "No se pudo cargar el producto. Inténtalo de nuevo.",
    };
  }
}

function errorState(
  code: Extract<UpdateProductActionState, { status: "error" }>["code"],
  message: string,
  fieldErrors: Partial<Record<ProductEditableField, string>> = {},
  conflictFields: ProductEditableField[] = [],
): UpdateProductActionState {
  return { status: "error", code, message, fieldErrors, conflictFields };
}

export async function handleUpdateProductAction(
  formData: FormData,
  dependencies: UpdateProductActionDependencies,
): Promise<UpdateProductActionState> {
  await dependencies.requireSession();

  const values: Record<string, unknown> = {};
  const original: Record<string, unknown> = {};
  let productId: unknown;
  const seen = new Set<string>();
  for (const [key, value] of formData.entries()) {
    if (seen.has(key)) {
      return errorState("INVALID", "El formulario contiene campos repetidos.");
    }
    seen.add(key);
    if (key === "productId") {
      productId = value;
    } else if (isEditableField(key)) {
      values[key] = value;
    } else if (
      key.startsWith(ORIGINAL_PREFIX) &&
      isEditableField(key.slice(ORIGINAL_PREFIX.length))
    ) {
      original[key.slice(ORIGINAL_PREFIX.length)] = value;
    } else {
      return errorState(
        "INVALID",
        "El formulario contiene campos que no se pueden editar.",
      );
    }
  }

  const parsed = updateProductInputSchema.safeParse({
    productId,
    values,
    original,
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<ProductEditableField, string>> = {};
    let invalidEnvelope = false;
    for (const issue of parsed.error.issues) {
      const [group, field] = issue.path;
      if (
        group === "values" &&
        typeof field === "string" &&
        isEditableField(field)
      ) {
        fieldErrors[field] ??= issue.message;
      } else {
        invalidEnvelope = true;
      }
    }
    return invalidEnvelope
      ? errorState(
          "INVALID",
          "Los datos del formulario no son válidos. Recarga el producto e inténtalo de nuevo.",
        )
      : errorState("VALIDATION", "Revisa los campos indicados.", fieldErrors);
  }

  let result: UpdateProductResult;
  try {
    result = await dependencies.update(parsed.data);
  } catch (error: unknown) {
    if (error instanceof ProductUpdateError) {
      return errorState(
        error.code,
        error.message,
        error.code === "DUPLICATE_SKU" ? { sku: error.message } : {},
        [...error.conflictFields],
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      isSkuUniqueViolation(error.meta)
    ) {
      const message = "Ese SKU ya está en uso y no se puede reutilizar.";
      return errorState("DUPLICATE_SKU", message, { sku: message });
    }
    console.error("Product update failed.", error);
    return errorState(
      "UNKNOWN",
      "No se pudo guardar el producto. Inténtalo de nuevo.",
    );
  }

  if (result.status === "unchanged") {
    return { status: "unchanged", message: "No hay cambios que guardar." };
  }
  dependencies.revalidate();
  return { status: "success", sku: result.sku };
}
