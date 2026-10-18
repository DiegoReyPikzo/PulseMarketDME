import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, test, vi } from "vitest";

const { getProductForEditAction, updateProductAction } = vi.hoisted(() => ({
  getProductForEditAction: vi.fn(),
  updateProductAction: vi.fn(),
}));

vi.mock("../../app/dashboard/products/actions", () => ({
  getProductForEditAction,
  updateProductAction,
}));

import { ProductEditDialog } from "../../app/dashboard/products/product-edit-dialog";

const productId = "00000000-0000-4000-8000-000000000201";
const stored = {
  id: productId,
  sku: "SKU-EDIT-1",
  name: "Producto",
  description: "",
  category: "Papelería",
  price: "10.00",
  stock: "5",
};

beforeAll(() => {
  // jsdom may not implement modal dialogs; the component only needs `open`.
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderLoadedDialog(onSaved = vi.fn()) {
  getProductForEditAction.mockResolvedValue({ status: "found", product: stored });
  const view = render(
    <ProductEditDialog
      onClose={vi.fn()}
      onSaved={onSaved}
      productId={productId}
      productName={stored.name}
    />,
  );
  await waitFor(() => assert.equal(input(view.container, "sku").value, stored.sku));
  return view;
}

function input(container: HTMLElement, name: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!element) throw new Error(`Missing input ${name}.`);
  return element;
}

function submit(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) throw new Error("Missing form.");
  fireEvent.submit(form);
}

test("shows client-side field errors and does not call the update action for invalid values", async () => {
  const { container } = await renderLoadedDialog();
  fireEvent.change(input(container, "price"), { target: { value: "12.345" } });
  fireEvent.change(input(container, "category"), { target: { value: "  " } });
  submit(container);

  assert.equal(screen.getByRole("alert").textContent, "Revisa los campos indicados.");
  assert.equal(input(container, "price").getAttribute("aria-invalid"), "true");
  assert.equal(input(container, "category").getAttribute("aria-invalid"), "true");
  assert.ok(screen.getByText("La categoría es obligatoria."));
  assert.equal(input(container, "price").value, "12.345");
  assert.equal(updateProductAction.mock.calls.length, 0);
});

test("sends valid new values with the original values for conflict detection", async () => {
  updateProductAction.mockResolvedValue({ status: "success", sku: stored.sku });
  const onSaved = vi.fn();
  const { container } = await renderLoadedDialog(onSaved);
  fireEvent.change(input(container, "price"), { target: { value: "13.00" } });
  submit(container);

  await waitFor(() => assert.equal(updateProductAction.mock.calls.length, 1));
  const formData = updateProductAction.mock.calls[0][0] as FormData;
  assert.equal(formData.get("productId"), productId);
  assert.equal(formData.get("price"), "13.00");
  assert.equal(formData.get("original.price"), "10.00");
  assert.equal(formData.get("original.sku"), stored.sku);
  await waitFor(() => assert.deepEqual(onSaved.mock.calls, [[stored.sku]]));
});

test("still shows server-only conflict errors after a valid submission", async () => {
  updateProductAction.mockResolvedValue({
    status: "error",
    code: "CONFLICT",
    message: "Otra persona cambió este producto.",
    fieldErrors: {},
    conflictFields: ["price"],
  });
  const { container } = await renderLoadedDialog();
  fireEvent.change(input(container, "price"), { target: { value: "14.00" } });
  submit(container);

  await waitFor(() =>
    assert.match(screen.getByRole("alert").textContent ?? "", /Otra persona cambió este producto/),
  );
  assert.equal(updateProductAction.mock.calls.length, 1);
});
