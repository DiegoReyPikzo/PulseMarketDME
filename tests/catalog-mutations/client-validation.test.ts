import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const { getAuthenticatedSession, transaction, revalidatePath } = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(async () => ({ user: {} })),
  transaction: vi.fn(async () => 2),
  revalidatePath: vi.fn(),
}));

// The real server action, with only its session, database and cache
// boundaries replaced. Nothing here connects to a database.
vi.mock("../../lib/auth-session", () => ({ getAuthenticatedSession }));
vi.mock("../../lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { bulkMutateProductsAction } from "../../app/dashboard/products/actions";
import { bulkProductMutationInputSchema } from "../../lib/catalog-mutations";
import {
  bulkProductMutationInputSchema as sharedBulkSchema,
  parseBulkProductMutationForm,
} from "../../lib/validation/bulk-products";

const ids = [
  "00000000-0000-4000-8000-000000000701",
  "00000000-0000-4000-8000-000000000702",
];

function formDataFrom(entries: [string, string][]): FormData {
  const formData = new FormData();
  for (const [key, value] of entries) formData.append(key, value);
  return formData;
}

afterEach(() => {
  vi.clearAllMocks();
});

test("the server bulk schema is the shared bulk schema", () => {
  assert.equal(bulkProductMutationInputSchema, sharedBulkSchema);
});

test("the shared form reader rejects repeated fields, invalid selections and invalid values", () => {
  assert.deepEqual(
    parseBulkProductMutationForm(
      formDataFrom([["productIds", JSON.stringify(ids)], ["operation", "category"], ["operation", "delete"]]),
    ),
    { success: false, message: "La selección contiene campos repetidos." },
  );
  assert.deepEqual(
    parseBulkProductMutationForm(formDataFrom([["productIds", "not-json"], ["operation", "delete"]])),
    { success: false, message: "La selección de productos no es válida." },
  );
  assert.deepEqual(
    parseBulkProductMutationForm(formDataFrom([["operation", "delete"]])),
    { success: false, message: "La selección de productos no es válida." },
  );
  assert.deepEqual(
    parseBulkProductMutationForm(
      formDataFrom([
        ["productIds", JSON.stringify(ids)],
        ["operation", "adjust"],
        ["field", "stock"],
        ["mode", "fixed"],
        ["amount", "1.5"],
      ]),
    ),
    { success: false, message: "El ajuste fijo de stock debe ser un número entero." },
  );
});

test("the shared form reader returns the parsed mutation for a valid submission", () => {
  assert.deepEqual(
    parseBulkProductMutationForm(
      formDataFrom([["productIds", JSON.stringify(ids)], ["operation", "category"], ["category", " Oficina "]]),
    ),
    { success: true, data: { ids, operation: "category", category: "Oficina" } },
  );
});

test("the server action rejects an invalid bulk change without writing, even without the client check", async () => {
  const formData = formDataFrom([
    ["productIds", JSON.stringify(ids)],
    ["operation", "adjust"],
    ["field", "price"],
    ["mode", "percentage"],
    ["amount", "1500"],
  ]);
  const state = await bulkMutateProductsAction(formData);

  assert.deepEqual(state, {
    status: "error",
    message: "El porcentaje debe estar entre -100 y 1000.",
  });
  assert.equal(getAuthenticatedSession.mock.calls.length, 1);
  assert.equal(transaction.mock.calls.length, 0);
  assert.equal(revalidatePath.mock.calls.length, 0);
});

test("the server action applies a valid bulk change", async () => {
  const state = await bulkMutateProductsAction(
    formDataFrom([["productIds", JSON.stringify(ids)], ["operation", "category"], ["category", "Oficina"]]),
  );

  assert.deepEqual(state, { status: "success", message: "Se actualizaron 2 productos." });
  assert.equal(transaction.mock.calls.length, 1);
  assert.deepEqual(revalidatePath.mock.calls, [["/dashboard/products"]]);
});
