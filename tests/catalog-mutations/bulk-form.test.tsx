import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

const { bulkMutateProductsAction, refresh } = vi.hoisted(() => ({
  bulkMutateProductsAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../../app/dashboard/products/actions", () => ({
  bulkMutateProductsAction,
  reorderProductsAction: vi.fn(),
  softDeleteProductAction: vi.fn(),
  getProductForEditAction: vi.fn(),
  updateProductAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ProductCatalogTable } from "../../app/dashboard/products/product-catalog-table";

const products = [
  {
    id: "00000000-0000-4000-8000-000000000401",
    sku: "SKU-BULK-1",
    name: "Producto uno",
    category: "Papelería",
    price: "10.00",
    stock: 5,
  },
  {
    id: "00000000-0000-4000-8000-000000000402",
    sku: "SKU-BULK-2",
    name: "Producto dos",
    category: "Papelería",
    price: "20.00",
    stock: 7,
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function renderWithSelection(onFeedback = vi.fn()) {
  const view = render(
    <ProductCatalogTable
      allowReorder={false}
      onFeedback={onFeedback}
      page={1}
      pageSize={20}
      products={products}
    />,
  );
  fireEvent.click(screen.getByLabelText("Seleccionar todos los productos visibles"));
  return view;
}

function bulkForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector("form");
  if (!form) throw new Error("Missing bulk form.");
  return form;
}

function field(container: HTMLElement, selector: string): HTMLInputElement | HTMLSelectElement {
  const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (!element) throw new Error(`Missing ${selector}.`);
  return element;
}

test("rejects an invalid adjustment in the browser without confirming or calling the action", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const onFeedback = vi.fn();
  const { container } = renderWithSelection(onFeedback);
  fireEvent.change(field(container, 'select[name="operation"]'), { target: { value: "adjust" } });
  fireEvent.change(field(container, 'select[name="field"]'), { target: { value: "stock" } });
  fireEvent.change(field(container, 'input[name="amount"]'), { target: { value: "1.5" } });
  // Native required/step checks are skipped by fireEvent.submit.
  fireEvent.submit(bulkForm(container));

  await waitFor(() =>
    assert.deepEqual(onFeedback.mock.calls, [
      [{ status: "error", message: "El ajuste fijo de stock debe ser un número entero." }],
    ]),
  );
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(bulkMutateProductsAction.mock.calls.length, 0);
});

test("rejects a percentage outside the allowed range in the browser", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const onFeedback = vi.fn();
  const { container } = renderWithSelection(onFeedback);
  fireEvent.change(field(container, 'select[name="operation"]'), { target: { value: "adjust" } });
  fireEvent.change(field(container, 'select[name="mode"]'), { target: { value: "percentage" } });
  fireEvent.change(field(container, 'input[name="amount"]'), { target: { value: "1500" } });
  fireEvent.submit(bulkForm(container));

  await waitFor(() =>
    assert.deepEqual(onFeedback.mock.calls, [
      [{ status: "error", message: "El porcentaje debe estar entre -100 y 1000." }],
    ]),
  );
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(bulkMutateProductsAction.mock.calls.length, 0);
});

test("sends a valid bulk change to the server action after confirmation", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  bulkMutateProductsAction.mockResolvedValue({
    status: "success",
    message: "Se actualizaron 2 productos.",
  });
  const onFeedback = vi.fn();
  const { container } = renderWithSelection(onFeedback);
  fireEvent.change(field(container, 'input[name="category"]'), {
    target: { value: "Oficina" },
  });
  fireEvent.submit(bulkForm(container));

  await waitFor(() => assert.equal(bulkMutateProductsAction.mock.calls.length, 1));
  assert.equal(confirm.mock.calls.length, 1);
  const formData = bulkMutateProductsAction.mock.calls[0][0] as FormData;
  assert.deepEqual(JSON.parse(String(formData.get("productIds"))), products.map(({ id }) => id));
  assert.equal(formData.get("operation"), "category");
  assert.equal(formData.get("category"), "Oficina");
  await waitFor(() =>
    assert.deepEqual(onFeedback.mock.calls, [
      [{ status: "success", message: "Se actualizaron 2 productos." }],
    ]),
  );
});
