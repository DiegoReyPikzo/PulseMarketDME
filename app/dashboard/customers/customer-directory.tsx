"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import type { DeleteCustomerActionState } from "../../../lib/customer-mutation-actions";
import { ListingTable, TableCell } from "../listing-table";
import { deleteCustomerAction } from "./actions";
import { CustomerEditDialog } from "./customer-edit-dialog";

export type CustomerDirectoryItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAtLabel: string;
};

type Feedback =
  | { status: "success"; message: string }
  | { status: "error"; message: string };

// This component is not keyed by its rows, so the feedback region keeps its
// message across the refresh that follows a mutation; the next operation
// replaces it.
export function CustomerDirectory({
  customers,
}: {
  customers: readonly CustomerDirectoryItem[];
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  );
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const [pending, startTransition] = useTransition();

  function closeEditor() {
    const customerId = editing?.id;
    setEditing(null);
    if (customerId) {
      requestAnimationFrame(() => editButtons.current.get(customerId)?.focus());
    }
  }

  function handleEditSaved(message: string) {
    closeEditor();
    setFeedback({ status: "success", message });
    router.refresh();
  }

  function runDelete(customer: CustomerDirectoryItem) {
    if (
      !window.confirm(
        `¿Eliminar a ${customer.name} del directorio? Sus ventas se conservan en el historial.`,
      )
    ) {
      return;
    }
    const formData = new FormData();
    formData.set("customerId", customer.id);
    startTransition(async () => {
      let result: DeleteCustomerActionState;
      try {
        result = await deleteCustomerAction(formData);
      } catch {
        setFeedback({
          status: "error",
          message: "No se pudo eliminar el cliente. Inténtalo de nuevo.",
        });
        return;
      }
      setFeedback({ status: result.status, message: result.message });
      if (result.status === "success") router.refresh();
    });
  }

  return (
    <section aria-label="Gestión de clientes" className="min-w-0 space-y-4">
      {feedback ? (
        <p
          aria-live="polite"
          className={`dashboard-listing__feedback rounded-lg p-3 text-sm ${
            feedback.status === "success"
              ? "dashboard-listing__feedback--success"
              : "dashboard-listing__feedback--error"
          }`}
          role={feedback.status === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
      <ListingTable
        caption="Resultados de clientes"
        columns={[
          { label: "Nombre" },
          { label: "Correo electrónico" },
          { label: "Teléfono" },
          { label: "Creado" },
          { label: "Acción" },
        ]}
        empty={customers.length === 0}
      >
        {customers.map((customer) => (
          <tr className="dashboard-listing__row" key={customer.id}>
            <TableCell>{customer.name}</TableCell>
            <TableCell>{customer.email}</TableCell>
            <TableCell>{customer.phone ?? "—"}</TableCell>
            <TableCell mono>{customer.createdAtLabel}</TableCell>
            <TableCell>
              <span className="flex justify-end gap-1 whitespace-nowrap">
                <button
                  aria-label={`Editar ${customer.name}`}
                  className="dashboard-product-catalog__edit rounded px-2 py-1 text-xs underline underline-offset-4 disabled:opacity-50"
                  disabled={pending}
                  onClick={() => setEditing({ id: customer.id, name: customer.name })}
                  ref={(element) => {
                    if (element) editButtons.current.set(customer.id, element);
                    else editButtons.current.delete(customer.id);
                  }}
                  type="button"
                >
                  Editar
                </button>
                <button
                  aria-label={`Eliminar ${customer.name}`}
                  className="dashboard-product-catalog__delete rounded px-2 py-1 text-xs underline underline-offset-4 disabled:opacity-50"
                  disabled={pending}
                  onClick={() => runDelete(customer)}
                  type="button"
                >
                  Eliminar
                </button>
              </span>
            </TableCell>
          </tr>
        ))}
      </ListingTable>
      {pending ? (
        <p aria-live="polite" className="dashboard-listing__pending text-sm">
          Aplicando cambios...
        </p>
      ) : null}
      {editing ? (
        <CustomerEditDialog
          customerId={editing.id}
          customerName={editing.name}
          key={editing.id}
          onClose={closeEditor}
          onSaved={handleEditSaved}
        />
      ) : null}
    </section>
  );
}
