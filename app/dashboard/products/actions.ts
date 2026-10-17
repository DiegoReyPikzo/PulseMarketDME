"use server";

import { revalidatePath } from "next/cache";

import {
  bulkProductMutationInputSchema,
  createProductMutationRepository,
  deleteProductInputSchema,
  mutateProducts,
  ProductMutationError,
  softDeleteProduct,
} from "../../../lib/catalog-mutations";
import { getAuthenticatedSession } from "../../../lib/auth-session";
import { prisma } from "../../../lib/prisma";

export type ProductMutationActionState =
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export async function softDeleteProductAction(
  formData: FormData,
): Promise<ProductMutationActionState> {
  await getAuthenticatedSession();

  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0][0] !== "productId") {
    return { status: "error", message: "Los datos del producto no son válidos." };
  }
  const parsed = deleteProductInputSchema.safeParse({
    id: entries[0][1],
  });
  if (!parsed.success) {
    return { status: "error", message: "El identificador del producto no es válido." };
  }

  try {
    await prisma.$transaction((transaction) =>
      softDeleteProduct(
        createProductMutationRepository(transaction),
        parsed.data.id,
        new Date(),
      ),
    );
  } catch (error: unknown) {
    return mutationErrorState(error, "No se pudo eliminar el producto.");
  }

  revalidatePath("/dashboard/products");
  return { status: "success", message: "Producto eliminado del catálogo." };
}

export async function bulkMutateProductsAction(
  formData: FormData,
): Promise<ProductMutationActionState> {
  await getAuthenticatedSession();

  const entries = [...formData.entries()];
  const entryNames = entries.map(([name]) => name);
  if (new Set(entryNames).size !== entryNames.length) {
    return { status: "error", message: "La selección contiene campos repetidos." };
  }
  const fields = Object.fromEntries(entries);
  const idsValue = fields.productIds;
  if (typeof idsValue !== "string") {
    return { status: "error", message: "La selección de productos no es válida." };
  }

  let ids: unknown;
  try {
    ids = JSON.parse(idsValue);
  } catch {
    return { status: "error", message: "La selección de productos no es válida." };
  }

  const fieldsWithoutIds = Object.fromEntries(
    entries.filter(([name]) => name !== "productIds"),
  );
  const candidate = { ...fieldsWithoutIds, ids };
  const parsed = bulkProductMutationInputSchema.safeParse(candidate);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues.map((issue) => issue.message).join(" "),
    };
  }

  let count: number;
  try {
    count = await prisma.$transaction((transaction) =>
      mutateProducts(
        createProductMutationRepository(transaction),
        parsed.data,
        new Date(),
      ),
    );
  } catch (error: unknown) {
    return mutationErrorState(error, "No se pudo aplicar el cambio masivo.");
  }

  revalidatePath("/dashboard/products");
  return {
    status: "success",
    message:
      parsed.data.operation === "delete"
        ? `Se eliminaron ${count} productos del catálogo.`
        : `Se actualizaron ${count} productos.`,
  };
}

function mutationErrorState(
  error: unknown,
  fallbackMessage: string,
): ProductMutationActionState {
  if (error instanceof ProductMutationError) {
    return { status: "error", message: error.message };
  }

  console.error("Product catalog mutation failed.", error);
  return { status: "error", message: fallbackMessage };
}
