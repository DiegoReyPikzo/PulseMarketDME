import "server-only";

import { z } from "zod";

import type { Prisma as PrismaTypes } from "../generated/prisma/client";
import { customerValuesSchema } from "./validation/customer";

export { customerValuesSchema };

export const CUSTOMER_EDITABLE_FIELDS = ["name", "email", "phone"] as const;

export type CustomerEditableField = (typeof CUSTOMER_EDITABLE_FIELDS)[number];

// Original values come from the browser. They are untrusted input used only to
// detect conflicts; they never authorize a write or replace database values.
const originalCustomerValuesSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().toLowerCase().min(1).max(254),
    phone: z
      .string()
      .trim()
      .max(32)
      .transform((value) => (value.length === 0 ? null : value)),
  })
  .strict();

export const createCustomerInputSchema = customerValuesSchema;

export const updateCustomerInputSchema = z
  .object({
    customerId: z.uuid(),
    values: customerValuesSchema,
    original: originalCustomerValuesSchema,
  })
  .strict();

export const customerIdInputSchema = z.object({ customerId: z.uuid() }).strict();

export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;

export type CustomerEditableValues = {
  name: string;
  email: string;
  phone: string | null;
};

export type CustomerForEdit = CustomerEditableValues & {
  id: string;
  deletedAt: Date | null;
};

export type UpdateCustomerResult =
  | { status: "updated"; changedFields: CustomerEditableField[] }
  | { status: "unchanged" };

export interface CustomerMutationRepository {
  findById(id: string): Promise<CustomerForEdit | null>;
  findIdByEmail(email: string): Promise<{ id: string } | null>;
  create(data: CustomerEditableValues): Promise<{ id: string }>;
  // Writes `data` only while every `expected` value still matches the row.
  updateIfUnchanged(
    id: string,
    expected: Partial<CustomerEditableValues>,
    data: Partial<CustomerEditableValues>,
  ): Promise<number>;
  softDelete(id: string, deletedAt: Date): Promise<number>;
}

export class CustomerMutationError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "DELETED" | "DUPLICATE_EMAIL" | "CONFLICT",
    readonly conflictFields: readonly CustomerEditableField[] = [],
  ) {
    super(message);
    this.name = "CustomerMutationError";
  }
}

export const DUPLICATE_EMAIL_MESSAGE =
  "Ese correo electrónico ya está en uso y no se puede reutilizar.";

const FIELD_LABELS: Record<CustomerEditableField, string> = {
  name: "nombre",
  email: "correo electrónico",
  phone: "teléfono",
};

const customerForEditSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  deletedAt: true,
} satisfies PrismaTypes.CustomerSelect;

export function createCustomerMutationRepository(
  client: PrismaTypes.TransactionClient,
): CustomerMutationRepository {
  return {
    findById: (id) =>
      client.customer.findUnique({ where: { id }, select: customerForEditSelect }),
    // Stored emails are normalized (database CHECK), so an exact lookup of a
    // normalized email also finds soft-deleted customers that reserve it.
    findIdByEmail: (email) =>
      client.customer.findUnique({ where: { email }, select: { id: true } }),
    create: (data) =>
      client.customer.create({ data, select: { id: true } }),
    updateIfUnchanged: async (id, expected, data) => {
      // A single conditional UPDATE: PostgreSQL re-checks the WHERE clause
      // against the latest committed row, so a concurrent change makes it
      // match zero rows instead of being overwritten.
      const result = await client.customer.updateMany({
        where: { id, deletedAt: null, ...expected },
        data,
      });
      return result.count;
    },
    softDelete: async (id, deletedAt) => {
      const result = await client.customer.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt },
      });
      return result.count;
    },
  };
}

function assertEditable(customer: CustomerForEdit | null): CustomerForEdit {
  if (!customer) {
    throw new CustomerMutationError("El cliente ya no existe.", "NOT_FOUND");
  }
  if (customer.deletedAt !== null) {
    throw new CustomerMutationError(
      "El cliente fue eliminado del directorio y no se puede modificar.",
      "DELETED",
    );
  }
  return customer;
}

function conflictError(fields: readonly CustomerEditableField[]) {
  const labels = fields.map((field) => FIELD_LABELS[field]).join(", ");
  return new CustomerMutationError(
    `Otro cambio modificó ${labels} desde que abriste el formulario. Recarga los datos del cliente y vuelve a aplicar tus cambios.`,
    "CONFLICT",
    fields,
  );
}

function pickFields(
  values: CustomerEditableValues,
  fields: readonly CustomerEditableField[],
): Partial<CustomerEditableValues> {
  return Object.fromEntries(
    fields.map((field) => [field, values[field]]),
  ) as Partial<CustomerEditableValues>;
}

export async function findCustomerForEdit(
  repository: CustomerMutationRepository,
  id: string,
): Promise<CustomerForEdit> {
  return assertEditable(await repository.findById(id));
}

// `input` is the output of createCustomerInputSchema (already normalized).
export async function createCustomer(
  repository: CustomerMutationRepository,
  input: CreateCustomerInput,
): Promise<{ id: string }> {
  // Friendly early check; the UNIQUE index is the guarantee under concurrency.
  if (await repository.findIdByEmail(input.email)) {
    throw new CustomerMutationError(DUPLICATE_EMAIL_MESSAGE, "DUPLICATE_EMAIL");
  }
  return repository.create(input);
}

// `parsed` is the output of updateCustomerInputSchema (already normalized).
export async function updateCustomer(
  repository: CustomerMutationRepository,
  parsed: UpdateCustomerInput,
): Promise<UpdateCustomerResult> {
  const next = parsed.values;
  const original = parsed.original;

  const current = assertEditable(await repository.findById(parsed.customerId));
  const changedFields = CUSTOMER_EDITABLE_FIELDS.filter(
    (field) => next[field] !== original[field],
  );
  if (changedFields.length === 0) return { status: "unchanged" };

  const staleFields = changedFields.filter(
    (field) => current[field] !== original[field],
  );
  if (staleFields.length > 0) throw conflictError(staleFields);

  if (changedFields.includes("email")) {
    const owner = await repository.findIdByEmail(next.email);
    if (owner && owner.id !== parsed.customerId) {
      throw new CustomerMutationError(DUPLICATE_EMAIL_MESSAGE, "DUPLICATE_EMAIL");
    }
  }

  const count = await repository.updateIfUnchanged(
    parsed.customerId,
    pickFields(original, changedFields),
    pickFields(next, changedFields),
  );
  if (count !== 1) {
    const latest = assertEditable(await repository.findById(parsed.customerId));
    const latestStale = changedFields.filter(
      (field) => latest[field] !== original[field],
    );
    throw conflictError(latestStale.length > 0 ? latestStale : changedFields);
  }

  return { status: "updated", changedFields };
}

// Soft delete only: the row and its sales stay untouched, and the email
// remains reserved by the UNIQUE index.
export async function softDeleteCustomer(
  repository: CustomerMutationRepository,
  id: string,
  deletedAt: Date,
): Promise<void> {
  assertEditable(await repository.findById(id));
  const count = await repository.softDelete(id, deletedAt);
  if (count !== 1) {
    assertEditable(await repository.findById(id));
    throw new CustomerMutationError(
      "El cliente fue eliminado del directorio y no se puede modificar.",
      "DELETED",
    );
  }
}
