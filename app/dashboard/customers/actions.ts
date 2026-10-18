"use server";

import { revalidatePath } from "next/cache";

import { getAuthenticatedSession } from "../../../lib/auth-session";
import {
  handleCreateCustomerAction,
  handleDeleteCustomerAction,
  handleGetCustomerForEditAction,
  handleUpdateCustomerAction,
  type CreateCustomerActionState,
  type DeleteCustomerActionState,
  type GetCustomerForEditActionState,
  type UpdateCustomerActionState,
} from "../../../lib/customer-mutation-actions";
import {
  createCustomer,
  createCustomerMutationRepository,
  findCustomerForEdit,
  softDeleteCustomer,
  updateCustomer,
} from "../../../lib/customer-mutations";
import { prisma } from "../../../lib/prisma";

// Customer names and emails also appear in the sales listing.
function revalidateCustomerViews(): void {
  revalidatePath("/dashboard/customers");
  revalidatePath("/dashboard/sales");
}

export async function createCustomerAction(
  formData: FormData,
): Promise<CreateCustomerActionState> {
  return handleCreateCustomerAction(formData, {
    requireSession: getAuthenticatedSession,
    create: (input) =>
      prisma.$transaction((transaction) =>
        createCustomer(createCustomerMutationRepository(transaction), input),
      ),
    revalidate: revalidateCustomerViews,
  });
}

export async function getCustomerForEditAction(
  formData: FormData,
): Promise<GetCustomerForEditActionState> {
  return handleGetCustomerForEditAction(formData, {
    requireSession: getAuthenticatedSession,
    find: (id) => findCustomerForEdit(createCustomerMutationRepository(prisma), id),
  });
}

export async function updateCustomerAction(
  formData: FormData,
): Promise<UpdateCustomerActionState> {
  return handleUpdateCustomerAction(formData, {
    requireSession: getAuthenticatedSession,
    update: (input) =>
      prisma.$transaction((transaction) =>
        updateCustomer(createCustomerMutationRepository(transaction), input),
      ),
    revalidate: revalidateCustomerViews,
  });
}

export async function deleteCustomerAction(
  formData: FormData,
): Promise<DeleteCustomerActionState> {
  return handleDeleteCustomerAction(formData, {
    requireSession: getAuthenticatedSession,
    remove: (id) =>
      prisma.$transaction((transaction) =>
        softDeleteCustomer(
          createCustomerMutationRepository(transaction),
          id,
          new Date(),
        ),
      ),
    revalidate: revalidateCustomerViews,
  });
}
