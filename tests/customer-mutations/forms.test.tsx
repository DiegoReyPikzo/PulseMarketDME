import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, test, vi } from "vitest";

const { createCustomerAction, getCustomerForEditAction, updateCustomerAction, refresh } =
  vi.hoisted(() => ({
    createCustomerAction: vi.fn(),
    getCustomerForEditAction: vi.fn(),
    updateCustomerAction: vi.fn(),
    refresh: vi.fn(),
  }));

vi.mock("../../app/dashboard/customers/actions", () => ({
  createCustomerAction,
  getCustomerForEditAction,
  updateCustomerAction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CustomerCreationForm } from "../../app/dashboard/customers/customer-creation-form";
import { CustomerEditDialog } from "../../app/dashboard/customers/customer-edit-dialog";

const customerId = "00000000-0000-4000-8000-000000000301";
const stored = {
  id: customerId,
  name: "Cliente",
  email: "cliente@example.test",
  phone: "",
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

async function renderLoadedEditor(onSaved = vi.fn()) {
  getCustomerForEditAction.mockResolvedValue({ status: "found", customer: stored });
  const view = render(
    <CustomerEditDialog
      customerId={customerId}
      customerName={stored.name}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  );
  await waitFor(() => assert.equal(input(view.container, "email").value, stored.email));
  return view;
}

test("creation shows client-side field errors and does not call the action for invalid values", () => {
  const { container } = render(<CustomerCreationForm />);
  fillForm(container, { name: "Cliente", email: "no-es-un-correo", phone: "abc" });
  submit(container);

  assert.equal(screen.getByRole("alert").textContent, "Revisa los campos indicados.");
  assert.equal(input(container, "email").getAttribute("aria-invalid"), "true");
  assert.equal(input(container, "phone").getAttribute("aria-invalid"), "true");
  assert.equal(input(container, "name").getAttribute("aria-invalid"), "false");
  assert.ok(screen.getByText("Ingresa un correo electrónico válido."));
  assert.equal(input(container, "name").value, "Cliente");
  assert.equal(createCustomerAction.mock.calls.length, 0);
});

test("creation sends valid values unchanged to the server action", async () => {
  createCustomerAction.mockResolvedValue({ status: "success", message: "Cliente Cliente creado." });
  const { container } = render(<CustomerCreationForm />);
  fillForm(container, { name: "Cliente", email: " CLIENTE@Example.test ", phone: "" });
  submit(container);

  await waitFor(() => assert.equal(createCustomerAction.mock.calls.length, 1));
  const formData = createCustomerAction.mock.calls[0][0] as FormData;
  // Email normalization and uniqueness stay on the server.
  assert.equal(formData.get("email"), " CLIENTE@Example.test ");
  assert.equal(formData.get("phone"), "");
  await waitFor(() => assert.equal(refresh.mock.calls.length, 1));
});

test("creation still shows the server's duplicate email error", async () => {
  const message = "Ese correo electrónico ya está en uso.";
  createCustomerAction.mockResolvedValue({
    status: "error",
    code: "DUPLICATE_EMAIL",
    message,
    fieldErrors: { email: message },
    conflictFields: [],
  });
  const { container } = render(<CustomerCreationForm />);
  fillForm(container, { name: "Cliente", email: "cliente@example.test", phone: "" });
  submit(container);

  await waitFor(() => assert.equal(screen.getByRole("alert").textContent, message));
  assert.equal(input(container, "email").getAttribute("aria-invalid"), "true");
});

test("edit shows client-side field errors and does not call the update action for invalid values", async () => {
  const { container } = await renderLoadedEditor();
  fireEvent.change(input(container, "email"), { target: { value: "sin-arroba" } });
  submit(container);

  assert.equal(screen.getByRole("alert").textContent, "Revisa los campos indicados.");
  assert.equal(input(container, "email").getAttribute("aria-invalid"), "true");
  assert.equal(input(container, "email").value, "sin-arroba");
  assert.equal(updateCustomerAction.mock.calls.length, 0);
});

test("edit sends valid new values with the original values for conflict detection", async () => {
  updateCustomerAction.mockResolvedValue({
    status: "success",
    message: "Cliente Cliente actualizado.",
  });
  const onSaved = vi.fn();
  const { container } = await renderLoadedEditor(onSaved);
  fireEvent.change(input(container, "phone"), { target: { value: "+52 55 1234 5678" } });
  submit(container);

  await waitFor(() => assert.equal(updateCustomerAction.mock.calls.length, 1));
  const formData = updateCustomerAction.mock.calls[0][0] as FormData;
  assert.equal(formData.get("customerId"), customerId);
  assert.equal(formData.get("phone"), "+52 55 1234 5678");
  assert.equal(formData.get("original.phone"), "");
  assert.equal(formData.get("original.email"), stored.email);
  await waitFor(() =>
    assert.deepEqual(onSaved.mock.calls, [["Cliente Cliente actualizado."]]),
  );
});
