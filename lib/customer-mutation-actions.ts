import "server-only";

import { Prisma } from "../generated/prisma/client";
import {
  createCustomerInputSchema,
  CUSTOMER_EDITABLE_FIELDS,
  customerIdInputSchema,
  CustomerMutationError,
  DUPLICATE_EMAIL_MESSAGE,
  updateCustomerInputSchema,
  type CreateCustomerInput,
  type CustomerEditableField,
  type CustomerForEdit,
  type UpdateCustomerInput,
  type UpdateCustomerResult,
} from "./customer-mutations";
import {
  collectFieldErrors,
  FORM_VALIDATION_MESSAGE,
  type ValidationIssue,
} from "./validation/field-errors";

export type CustomerFieldErrors = Partial<Record<CustomerEditableField, string>>;

type ErrorCode =
  | "INVALID"
  | "VALIDATION"
  | "NOT_FOUND"
  | "DELETED"
  | "DUPLICATE_EMAIL"
  | "CONFLICT"
  | "UNKNOWN";

export type CustomerActionError = {
  status: "error";
  code: ErrorCode;
  message: string;
  fieldErrors: CustomerFieldErrors;
  conflictFields: CustomerEditableField[];
};

export type CreateCustomerActionState =
  | { status: "success"; message: string }
  | CustomerActionError;

export type UpdateCustomerActionState =
  | { status: "success"; message: string }
  | { status: "unchanged"; message: string }
  | CustomerActionError;

export type DeleteCustomerActionState =
  | { status: "success"; message: string }
  | CustomerActionError;

export type GetCustomerForEditActionState =
  | {
      status: "found";
      customer: { id: string } & Record<CustomerEditableField, string>;
    }
  | CustomerActionError;

type SessionDependency = { requireSession(): Promise<unknown> };

const ORIGINAL_PREFIX = "original.";

function errorState(
  code: ErrorCode,
  message: string,
  fieldErrors: CustomerFieldErrors = {},
  conflictFields: CustomerEditableField[] = [],
): CustomerActionError {
  return { status: "error", code, message, fieldErrors, conflictFields };
}

function isEditableField(value: string): value is CustomerEditableField {
  return (CUSTOMER_EDITABLE_FIELDS as readonly string[]).includes(value);
}

function adapterConstraintIndex(meta: Record<string, unknown> | undefined): unknown {
  const adapterError = meta?.driverAdapterError;
  if (typeof adapterError !== "object" || adapterError === null) return undefined;
  const cause = (adapterError as { cause?: unknown }).cause;
  if (typeof cause !== "object" || cause === null) return undefined;
  const constraint = (cause as { constraint?: unknown }).constraint;
  if (typeof constraint !== "object" || constraint === null) return undefined;
  return (constraint as { index?: unknown }).index;
}

// Recognizes both the classic `target` metadata and the shape reported by
// @prisma/adapter-pg (`driverAdapterError.cause.constraint.index`).
export function isEmailUniqueViolation(
  meta: Record<string, unknown> | undefined,
): boolean {
  if (meta?.modelName !== undefined && meta.modelName !== "Customer") {
    return false;
  }
  if (adapterConstraintIndex(meta) === "Customer_email_key") return true;
  const target = meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === "email";
  }
  return target === "email" || target === "Customer_email_key";
}

// Log only the error type: Prisma errors can carry query details, and the
// directory holds personal data.
function logFailure(message: string, error: unknown): void {
  const detail =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  console.error(message, detail);
}

function mapMutationError(
  error: unknown,
  fallback: string,
  logMessage: string,
): CustomerActionError {
  if (error instanceof CustomerMutationError) {
    return errorState(
      error.code,
      error.message,
      error.code === "DUPLICATE_EMAIL" ? { email: error.message } : {},
      [...error.conflictFields],
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    isEmailUniqueViolation(error.meta)
  ) {
    return errorState("DUPLICATE_EMAIL", DUPLICATE_EMAIL_MESSAGE, {
      email: DUPLICATE_EMAIL_MESSAGE,
    });
  }
  logFailure(logMessage, error);
  return errorState("UNKNOWN", fallback);
}

function validationState(
  issues: readonly ValidationIssue[],
  valuesPrefix: readonly PropertyKey[],
): CustomerActionError {
  const { fieldErrors, hasOtherIssues } = collectFieldErrors(
    issues,
    isEditableField,
    valuesPrefix,
  );
  return hasOtherIssues
    ? errorState(
        "INVALID",
        "Los datos del formulario no son válidos. Recarga la página e inténtalo de nuevo.",
      )
    : errorState("VALIDATION", FORM_VALIDATION_MESSAGE, fieldErrors);
}

function readCustomerId(formData: FormData): string | null {
  const entries = [...formData.entries()];
  const parsed = customerIdInputSchema.safeParse(
    entries.length === 1 ? Object.fromEntries(entries) : {},
  );
  return parsed.success ? parsed.data.customerId : null;
}

export async function handleCreateCustomerAction(
  formData: FormData,
  dependencies: SessionDependency & {
    create(input: CreateCustomerInput): Promise<{ id: string }>;
    revalidate(): void;
  },
): Promise<CreateCustomerActionState> {
  await dependencies.requireSession();

  const candidate: Record<string, unknown> = { phone: "" };
  const seen = new Set<string>();
  for (const [key, value] of formData.entries()) {
    if (seen.has(key)) {
      return errorState("INVALID", "El formulario contiene campos repetidos.");
    }
    seen.add(key);
    if (!isEditableField(key)) {
      return errorState("INVALID", "El formulario contiene campos no permitidos.");
    }
    candidate[key] = value;
  }

  const parsed = createCustomerInputSchema.safeParse(candidate);
  if (!parsed.success) return validationState(parsed.error.issues, []);

  try {
    await dependencies.create(parsed.data);
  } catch (error: unknown) {
    return mapMutationError(
      error,
      "No se pudo crear el cliente. Inténtalo de nuevo.",
      "Customer creation failed.",
    );
  }
  dependencies.revalidate();
  return { status: "success", message: `Cliente ${parsed.data.name} creado.` };
}

export async function handleGetCustomerForEditAction(
  formData: FormData,
  dependencies: SessionDependency & {
    find(id: string): Promise<CustomerForEdit>;
  },
): Promise<GetCustomerForEditActionState> {
  await dependencies.requireSession();

  const customerId = readCustomerId(formData);
  if (!customerId) {
    return errorState("INVALID", "El identificador del cliente no es válido.");
  }
  try {
    const customer = await dependencies.find(customerId);
    return {
      status: "found",
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone ?? "",
      },
    };
  } catch (error: unknown) {
    if (
      error instanceof CustomerMutationError &&
      (error.code === "NOT_FOUND" || error.code === "DELETED")
    ) {
      return errorState(error.code, error.message);
    }
    logFailure("Customer edit lookup failed.", error);
    return errorState("UNKNOWN", "No se pudo cargar el cliente. Inténtalo de nuevo.");
  }
}

export async function handleUpdateCustomerAction(
  formData: FormData,
  dependencies: SessionDependency & {
    update(input: UpdateCustomerInput): Promise<UpdateCustomerResult>;
    revalidate(): void;
  },
): Promise<UpdateCustomerActionState> {
  await dependencies.requireSession();

  const values: Record<string, unknown> = {};
  const original: Record<string, unknown> = {};
  let customerId: unknown;
  const seen = new Set<string>();
  for (const [key, value] of formData.entries()) {
    if (seen.has(key)) {
      return errorState("INVALID", "El formulario contiene campos repetidos.");
    }
    seen.add(key);
    if (key === "customerId") {
      customerId = value;
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

  const parsed = updateCustomerInputSchema.safeParse({
    customerId,
    values,
    original,
  });
  if (!parsed.success) return validationState(parsed.error.issues, ["values"]);

  let result: UpdateCustomerResult;
  try {
    result = await dependencies.update(parsed.data);
  } catch (error: unknown) {
    return mapMutationError(
      error,
      "No se pudo guardar el cliente. Inténtalo de nuevo.",
      "Customer update failed.",
    );
  }
  if (result.status === "unchanged") {
    return { status: "unchanged", message: "No hay cambios que guardar." };
  }
  dependencies.revalidate();
  return { status: "success", message: `Cliente ${parsed.data.values.name} actualizado.` };
}

export async function handleDeleteCustomerAction(
  formData: FormData,
  dependencies: SessionDependency & {
    remove(id: string): Promise<void>;
    revalidate(): void;
  },
): Promise<DeleteCustomerActionState> {
  await dependencies.requireSession();

  const customerId = readCustomerId(formData);
  if (!customerId) {
    return errorState("INVALID", "El identificador del cliente no es válido.");
  }
  try {
    await dependencies.remove(customerId);
  } catch (error: unknown) {
    return mapMutationError(
      error,
      "No se pudo eliminar el cliente. Inténtalo de nuevo.",
      "Customer deletion failed.",
    );
  }
  dependencies.revalidate();
  return {
    status: "success",
    message: "Cliente eliminado del directorio. Sus ventas se conservan en el historial.",
  };
}
