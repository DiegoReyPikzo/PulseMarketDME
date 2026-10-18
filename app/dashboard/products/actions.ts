"use server";

import { revalidatePath } from "next/cache";

import {
  createProductMutationRepository,
  deleteProductInputSchema,
  mutateProducts,
  ProductMutationError,
  reorderProductInputSchema,
  reorderProducts,
  softDeleteProduct,
  StaleProductOrderError,
} from "../../../lib/catalog-mutations";
import { getAuthenticatedSession } from "../../../lib/auth-session";
import { prisma } from "../../../lib/prisma";
import { Prisma } from "../../../generated/prisma/client";
import {
  createProduct,
  createProductCreationRepository,
} from "../../../lib/product-creation";
import {
  handleCreateProductAction,
  type CreateProductActionState,
} from "../../../lib/product-creation-action";
import {
  createProductUpdateRepository,
  findProductForEdit,
  updateProduct,
} from "../../../lib/product-update";
import {
  handleGetProductForEditAction,
  handleUpdateProductAction,
  type GetProductForEditActionState,
  type UpdateProductActionState,
} from "../../../lib/product-update-action";
import { parseBulkProductMutationForm } from "../../../lib/validation/bulk-products";

export type ProductMutationActionState =
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export async function createProductAction(
  formData: FormData,
): Promise<CreateProductActionState> {
  return handleCreateProductAction(formData, {
    requireSession: getAuthenticatedSession,
    create: (input) =>
      prisma.$transaction(
        (transaction) =>
          createProduct(createProductCreationRepository(transaction), input),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    revalidate: () => revalidatePath("/dashboard/products"),
  });
}

export async function getProductForEditAction(
  formData: FormData,
): Promise<GetProductForEditActionState> {
  return handleGetProductForEditAction(formData, {
    requireSession: getAuthenticatedSession,
    find: (id) => findProductForEdit(createProductUpdateRepository(prisma), id),
  });
}

export async function updateProductAction(
  formData: FormData,
): Promise<UpdateProductActionState> {
  return handleUpdateProductAction(formData, {
    requireSession: getAuthenticatedSession,
    update: (input) =>
      prisma.$transaction((transaction) =>
        updateProduct(createProductUpdateRepository(transaction), input),
      ),
    revalidate: () => revalidatePath("/dashboard/products"),
  });
}

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

  const parsed = parseBulkProductMutationForm(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.message };
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

export async function reorderProductsAction(
  formData: FormData,
): Promise<ProductMutationActionState> {
  await getAuthenticatedSession();

  const entries = [...formData.entries()];
  const entryNames = entries.map(([name]) => name);
  const requiredNames = ["productIds", "expectedProductIds", "page", "pageSize"];
  if (
    entries.length !== requiredNames.length ||
    requiredNames.some((name) => !entryNames.includes(name)) ||
    new Set(entryNames).size !== entryNames.length
  ) {
    return { status: "error", message: "La lista de productos no es válida." };
  }
  const fields = Object.fromEntries(entries);
  if (
    typeof fields.productIds !== "string" ||
    typeof fields.expectedProductIds !== "string" ||
    typeof fields.page !== "string" ||
    typeof fields.pageSize !== "string"
  ) {
    return { status: "error", message: "La lista de productos no es válida." };
  }

  let ids: unknown;
  let expectedIds: unknown;
  try {
    ids = JSON.parse(fields.productIds);
    expectedIds = JSON.parse(fields.expectedProductIds);
  } catch {
    return { status: "error", message: "La lista de productos no es válida." };
  }

  const parsed = reorderProductInputSchema.safeParse({
    ids,
    expectedIds,
    page: fields.page,
    pageSize: fields.pageSize,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues.map((issue) => issue.message).join(" "),
    };
  }

  try {
    await prisma.$transaction(
      (transaction) =>
        reorderProducts(createProductMutationRepository(transaction), parsed.data),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error: unknown) {
    if (error instanceof StaleProductOrderError) {
      return { status: "error", message: error.message };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return {
        status: "error",
        message:
          "Otro reordenamiento ocurrió al mismo tiempo. Se restauró el orden anterior; recarga la página e inténtalo de nuevo.",
      };
    }
    return mutationErrorState(error, "No se pudo guardar el nuevo orden.");
  }

  revalidatePath("/dashboard/products");
  return { status: "success", message: "Nuevo orden guardado." };
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
