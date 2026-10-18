import assert from "node:assert/strict";
import { test } from "vitest";

import { createProductInputSchema } from "../../lib/product-creation";
import { handleCreateProductAction } from "../../lib/product-creation-action";
import {
  collectFieldErrors,
  FORM_VALIDATION_MESSAGE,
} from "../../lib/validation/field-errors";
import {
  isProductValueField,
  productValueErrors,
  productValuesSchema,
} from "../../lib/validation/product";

const validValues = {
  sku: "SKU-1",
  name: "Producto",
  description: "",
  category: "Papelería",
  price: "10.50",
  stock: "3",
};

function formDataFrom(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

function trackingDependencies() {
  const created: unknown[] = [];
  return {
    created,
    dependencies: {
      requireSession: async () => undefined,
      create: async (input: unknown) => {
        created.push(input);
        return { sku: "SKU-1" };
      },
      revalidate: () => undefined,
    },
  };
}

test("the server creation schema is the shared product schema", () => {
  assert.equal(createProductInputSchema, productValuesSchema);
});

test("keeps the first message per recognized field and flags other issues", () => {
  const result = collectFieldErrors(
    [
      { path: ["values", "price"], message: "first" },
      { path: ["values", "price"], message: "second" },
      { path: ["values", "unknown"], message: "other field" },
      { path: ["productId"], message: "envelope" },
    ],
    isProductValueField,
    ["values"],
  );
  assert.deepEqual(result, { fieldErrors: { price: "first" }, hasOtherIssues: true });
  assert.deepEqual(collectFieldErrors([], isProductValueField), {
    fieldErrors: {},
    hasOtherIssues: false,
  });
});

for (const [label, overrides] of [
  ["blank required fields", { sku: "  ", name: "", category: " " }],
  ["imprecise price and negative stock", { price: "1.001", stock: "-1" }],
  ["values above the length and range limits", { sku: "S".repeat(65), stock: "2147483648" }],
] as const) {
  test(`server rejects ${label} with the same field errors the browser shows, even without the client check`, async () => {
    const values = { ...validValues, ...overrides };
    const { created, dependencies } = trackingDependencies();
    // Submitting straight to the handler is what a client that skips the
    // browser check would do.
    const state = await handleCreateProductAction(formDataFrom(values), dependencies);

    assert.equal(state.status, "error");
    if (state.status !== "error") return;
    assert.equal(state.message, FORM_VALIDATION_MESSAGE);
    assert.deepEqual(state.fieldErrors, productValueErrors(values));
    assert.ok(Object.keys(state.fieldErrors).length > 0);
    assert.equal(created.length, 0);
  });
}

test("valid values pass the browser check and reach the server normalized", async () => {
  const values = { ...validValues, sku: "  SKU-1 ", description: "   " };
  assert.equal(productValueErrors(values), null);

  const { created, dependencies } = trackingDependencies();
  const state = await handleCreateProductAction(formDataFrom(values), dependencies);
  assert.deepEqual(state, { status: "success", sku: "SKU-1" });
  assert.deepEqual(created, [
    { ...validValues, sku: "SKU-1", description: null },
  ]);
});

test("the browser check leaves non-field issues such as unknown keys to the server", async () => {
  const values = { ...validValues, sortOrder: "0" };
  assert.equal(productValueErrors(values), null);

  const { created, dependencies } = trackingDependencies();
  const state = await handleCreateProductAction(formDataFrom(values), dependencies);
  assert.equal(state.status, "error");
  assert.equal(created.length, 0);
});
