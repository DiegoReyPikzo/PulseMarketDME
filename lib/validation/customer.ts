import { z } from "zod";

import { collectFieldErrors } from "./field-errors";

// Customer field rules shared by the creation and edit forms (browser) and by
// the server actions, which remain the authority. No server-only imports.

export const CUSTOMER_VALUE_FIELDS = ["name", "email", "phone"] as const;

export type CustomerValueField = (typeof CUSTOMER_VALUE_FIELDS)[number];

// Format check only; this does not verify that a phone number is real.
const PHONE_CHARACTERS = /^[0-9+ ().-]*$/;

// New values. Emails are trimmed and lowercased before validation so stored
// values satisfy the database CHECK (email = lower(btrim(email))); the
// UNIQUE index then makes email uniqueness case-insensitive.
export const customerValuesSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "El nombre es obligatorio.")
      .max(160, "El nombre admite hasta 160 caracteres."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "El correo electrónico es obligatorio.")
      .max(254, "El correo electrónico admite hasta 254 caracteres.")
      .pipe(z.email("Ingresa un correo electrónico válido.")),
    phone: z
      .string()
      .trim()
      .max(32, "El teléfono admite hasta 32 caracteres.")
      .regex(
        PHONE_CHARACTERS,
        "El teléfono solo admite dígitos, espacios, +, paréntesis, guion y punto.",
      )
      .refine(
        (value) => value.length === 0 || /\d/.test(value),
        "El teléfono debe incluir al menos un dígito.",
      )
      .transform((value) => (value.length === 0 ? null : value)),
  })
  .strict();

export function isCustomerValueField(value: string): value is CustomerValueField {
  return (CUSTOMER_VALUE_FIELDS as readonly string[]).includes(value);
}

// Browser pre-check. Returns per-field messages, or null when the values pass
// or when no issue maps to a form field (the server then decides).
export function customerValueErrors(
  values: Record<string, unknown>,
): Partial<Record<CustomerValueField, string>> | null {
  const parsed = customerValuesSchema.safeParse(values);
  if (parsed.success) return null;
  const { fieldErrors } = collectFieldErrors(
    parsed.error.issues,
    isCustomerValueField,
  );
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}
