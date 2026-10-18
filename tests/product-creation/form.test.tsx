import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

const { createProductAction, refresh } = vi.hoisted(() => ({
  createProductAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../../app/dashboard/products/actions", () => ({ createProductAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ProductCreationForm } from "../../app/dashboard/products/product-creation-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function input(container: HTMLElement, name: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!element) throw new Error(`Missing input ${name}.`);
  return element;
}

function fillForm(container: HTMLElement, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    fireEvent.change(input(container, name), { target: { value } });
  }
}

// fireEvent.submit skips the browser's native required/maxLength checks, so
// these tests exercise the Zod pre-check itself.
function submit(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) throw new Error("Missing form.");
  fireEvent.submit(form);
}

const validValues = {
  sku: "SKU-CLIENT-1",
  name: "Producto",
  category: "Papelería",
  price: "10.50",
  stock: "3",
  description: "",
};

test("shows client-side field errors and does not call the action for invalid values", () => {
  const { container } = render(<ProductCreationForm />);
  fillForm(container, { ...validValues, sku: "   ", price: "1.001", stock: "-1" });
  submit(container);

  assert.equal(screen.getByRole("alert").textContent, "Revisa los campos indicados.");
  assert.equal(input(container, "sku").getAttribute("aria-invalid"), "true");
  assert.equal(input(container, "price").getAttribute("aria-invalid"), "true");
  assert.equal(input(container, "stock").getAttribute("aria-invalid"), "true");
  assert.equal(input(container, "name").getAttribute("aria-invalid"), "false");
  assert.ok(screen.getByText("El SKU es obligatorio."));
  assert.ok(
    screen.getByText(
      "Ingresa un precio no negativo con hasta dos decimales y dentro del límite permitido.",
    ),
  );
  assert.ok(screen.getByText("El stock debe ser un entero no negativo."));
  // The entered values stay in place for correction.
  assert.equal(input(container, "price").value, "1.001");
  assert.equal(createProductAction.mock.calls.length, 0);
});

test("sends valid values unchanged to the server action", async () => {
  createProductAction.mockResolvedValue({ status: "success", sku: "SKU-CLIENT-1" });
  const { container } = render(<ProductCreationForm />);
  fillForm(container, { ...validValues, sku: "  SKU-CLIENT-1 " });
  submit(container);

  await waitFor(() => assert.equal(createProductAction.mock.calls.length, 1));
  const formData = createProductAction.mock.calls[0][0] as FormData;
  // Normalization stays on the server: the raw form value is sent.
  assert.equal(formData.get("sku"), "  SKU-CLIENT-1 ");
  assert.equal(formData.get("price"), "10.50");
  assert.equal(formData.get("stock"), "3");
  await waitFor(() => assert.ok(screen.getByRole("status")));
  assert.match(screen.getByRole("status").textContent ?? "", /Producto SKU-CLIENT-1 creado/);
  assert.equal(refresh.mock.calls.length, 1);
});

test("still shows server-only errors such as a duplicate SKU", async () => {
  const message = "Ese SKU ya está en uso y no se puede reutilizar.";
  createProductAction.mockResolvedValue({
    status: "error",
    message,
    fieldErrors: { sku: message },
  });
  const { container } = render(<ProductCreationForm />);
  fillForm(container, validValues);
  submit(container);

  await waitFor(() => assert.equal(screen.getByRole("alert").textContent, message));
  assert.equal(createProductAction.mock.calls.length, 1);
  assert.equal(input(container, "sku").getAttribute("aria-invalid"), "true");
});
