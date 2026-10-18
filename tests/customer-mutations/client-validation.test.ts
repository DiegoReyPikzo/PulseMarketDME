import assert from "node:assert/strict";
import { test } from "vitest";

import {
  handleCreateCustomerAction,
  handleUpdateCustomerAction,
} from "../../lib/customer-mutation-actions";
import {
  createCustomerInputSchema,
  updateCustomerInputSchema,
} from "../../lib/customer-mutations";
import {
  customerValueErrors,
  customerValuesSchema,
} from "../../lib/validation/customer";
import { FORM_VALIDATION_MESSAGE } from "../../lib/validation/field-errors";

const customerId = "00000000-0000-4000-8000-000000000601";
const original = { name: "Cliente", email: "cliente@example.test", phone: "" };

function formDataFrom(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

function trackingDependencies() {
  const writes: unknown[] = [];
  return {
    writes,
    dependencies: {
      requireSession: async () => undefined,
      create: async (input: unknown) => {
        writes.push(input);
        return { id: customerId };
      },
      update: async (input: unknown) => {
        writes.push(input);
        return { status: "updated" as const, changedFields: ["name" as const] };
      },
      revalidate: () => undefined,
    },
  };
}

test("the server customer schemas are the shared customer schema", () => {
  assert.equal(createCustomerInputSchema, customerValuesSchema);
  assert.equal(updateCustomerInputSchema.shape.values, customerValuesSchema);
});

test("server rejects an invalid new customer with the same field errors the browser shows, even without the client check", async () => {
  const values = { name: "Cliente", email: "no-es-un-correo", phone: "abc" };
  const { writes, dependencies } = trackingDependencies();
  const state = await handleCreateCustomerAction(formDataFrom(values), dependencies);

  assert.equal(state.status, "error");
  if (state.status !== "error") return;
  assert.equal(state.code, "VALIDATION");
  assert.equal(state.message, FORM_VALIDATION_MESSAGE);
  assert.deepEqual(state.fieldErrors, customerValueErrors(values));
  assert.deepEqual(Object.keys(state.fieldErrors).sort(), ["email", "phone"]);
  assert.equal(writes.length, 0);
});

test("server rejects invalid edited values with the same field errors the browser shows, even without the client check", async () => {
  const values = { ...original, email: "sin-arroba" };
  const formData = formDataFrom({ customerId, ...values });
  for (const [key, value] of Object.entries(original)) formData.set(`original.${key}`, value);
  const { writes, dependencies } = trackingDependencies();
  const state = await handleUpdateCustomerAction(formData, dependencies);

  assert.equal(state.status, "error");
  if (state.status !== "error") return;
  assert.equal(state.code, "VALIDATION");
  assert.deepEqual(state.fieldErrors, customerValueErrors(values));
  assert.equal(writes.length, 0);
});

test("valid values pass the browser check and reach the server normalized", async () => {
  const values = { name: " Cliente ", email: " CLIENTE@Example.test ", phone: "" };
  assert.equal(customerValueErrors(values), null);

  const { writes, dependencies } = trackingDependencies();
  const state = await handleCreateCustomerAction(formDataFrom(values), dependencies);
  assert.equal(state.status, "success");
  assert.deepEqual(writes, [{ name: "Cliente", email: "cliente@example.test", phone: null }]);
});
