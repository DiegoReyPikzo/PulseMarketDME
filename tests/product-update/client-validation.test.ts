import assert from "node:assert/strict";
import { test } from "vitest";

import { updateProductInputSchema } from "../../lib/product-update";
import { handleUpdateProductAction } from "../../lib/product-update-action";
import { FORM_VALIDATION_MESSAGE } from "../../lib/validation/field-errors";
import {
  productValueErrors,
  productValuesSchema,
} from "../../lib/validation/product";

const productId = "00000000-0000-4000-8000-000000000501";
const original = {
  sku: "SKU-1",
  name: "Producto",
  description: "",
  category: "Papelería",
  price: "10.00",
  stock: "5",
};

function formDataFor(values: Record<string, string>): FormData {
  const formData = new FormData();
  formData.set("productId", productId);
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  for (const [key, value] of Object.entries(original)) {
    formData.set(`original.${key}`, value);
  }
  return formData;
}

function trackingDependencies() {
  const updates: unknown[] = [];
  return {
    updates,
    dependencies: {
      requireSession: async () => undefined,
      update: async (input: unknown) => {
        updates.push(input);
        return { status: "updated" as const, sku: "SKU-1", changedFields: ["price" as const] };
      },
      revalidate: () => undefined,
    },
  };
}

test("the server update schema validates new values with the shared product schema", () => {
  assert.equal(updateProductInputSchema.shape.values, productValuesSchema);
});

test("server rejects invalid new values with the same field errors the browser shows, even without the client check", async () => {
  const values = { ...original, price: "12.345", category: " " };
  const { updates, dependencies } = trackingDependencies();
  const state = await handleUpdateProductAction(formDataFor(values), dependencies);

  assert.equal(state.status, "error");
  if (state.status !== "error") return;
  assert.equal(state.code, "VALIDATION");
  assert.equal(state.message, FORM_VALIDATION_MESSAGE);
  assert.deepEqual(state.fieldErrors, productValueErrors(values));
  assert.deepEqual(Object.keys(state.fieldErrors).sort(), ["category", "price"]);
  assert.equal(updates.length, 0);
});

test("valid new values pass the browser check and reach the server update", async () => {
  const values = { ...original, price: "13.00" };
  assert.equal(productValueErrors(values), null);

  const { updates, dependencies } = trackingDependencies();
  const state = await handleUpdateProductAction(formDataFor(values), dependencies);
  assert.deepEqual(state, { status: "success", sku: "SKU-1" });
  assert.equal(updates.length, 1);
});
