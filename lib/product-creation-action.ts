import "server-only";

import { Prisma } from "../generated/prisma/client";
import {
  createProductInputSchema,
  ProductCreationError,
  type CreateProductInput,
} from "./product-creation";
import {
  collectFieldErrors,
  FORM_VALIDATION_MESSAGE,
} from "./validation/field-errors";

export type CreateProductField =
  | "sku"
  | "name"
  | "description"
  | "category"
  | "price"
  | "stock";

export type CreateProductActionState =
  | { status: "success"; sku: string }
  | {
      status: "error";
      message: string;
      fieldErrors: Partial<Record<CreateProductField, string>>;
    };

export type CreateProductActionDependencies = {
  requireSession(): Promise<unknown>;
  create(input: CreateProductInput): Promise<{ sku: string }>;
  revalidate(): void;
};

export async function handleCreateProductAction(
  formData: FormData,
  dependencies: CreateProductActionDependencies,
): Promise<CreateProductActionState> {
  await dependencies.requireSession();

  const candidate: Record<string, unknown> = {
    description: "",
    stock: "0",
  };
  const seen = new Set<string>();
  for (const [key, value] of formData.entries()) {
    if (seen.has(key)) {
      return {
        status: "error",
        message: "El formulario contiene campos repetidos.",
        fieldErrors: {},
      };
    }
    seen.add(key);
    candidate[key] = value;
  }

  const parsed = createProductInputSchema.safeParse(candidate);
  if (!parsed.success) {
    const { fieldErrors } = collectFieldErrors(
      parsed.error.issues,
      isCreateProductField,
    );
    return {
      status: "error",
      message: FORM_VALIDATION_MESSAGE,
      fieldErrors,
    };
  }

  let created: { sku: string };
  try {
    created = await dependencies.create(parsed.data);
  } catch (error: unknown) {
    if (error instanceof ProductCreationError) {
      return {
        status: "error",
        message: error.message,
        fieldErrors:
          error.code === "DUPLICATE_SKU"
            ? { sku: error.message }
            : {},
      };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      isSkuUniqueViolation(error.meta)
    ) {
      const message = "Ese SKU ya está en uso y no se puede reutilizar.";
      return {
        status: "error",
        message,
        fieldErrors: { sku: message },
      };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return {
        status: "error",
        message:
          "El catálogo cambió mientras se guardaba el producto. Vuelve a intentarlo.",
        fieldErrors: {},
      };
    }

    console.error("Product creation failed.", error);
    return {
      status: "error",
      message: "No se pudo crear el producto. Inténtalo de nuevo.",
      fieldErrors: {},
    };
  }

  dependencies.revalidate();
  return { status: "success", sku: created.sku };
}

export function isSkuUniqueViolation(
  meta: Record<string, unknown> | undefined,
): boolean {
  if (meta?.modelName !== undefined && meta.modelName !== "Product") {
    return false;
  }
  const target = meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === "sku";
  }
  return target === "sku" || target === "Product_sku_key";
}

function isCreateProductField(value: string): value is CreateProductField {
  return (
    value === "sku" ||
    value === "name" ||
    value === "description" ||
    value === "category" ||
    value === "price" ||
    value === "stock"
  );
}
