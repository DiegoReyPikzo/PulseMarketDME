"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent, KeyboardEvent, SyntheticEvent } from "react";

import type { UpdateCustomerActionState } from "../../../lib/customer-mutation-actions";
import { getCustomerForEditAction, updateCustomerAction } from "./actions";
import {
  CustomerFields,
  type CustomerFormField,
  type CustomerFormValues,
} from "./customer-fields";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; original: CustomerFormValues }
  | { status: "error"; message: string };

const FIELDS: readonly CustomerFormField[] = ["name", "email", "phone"];

export function CustomerEditDialog({
  customerId,
  customerName,
  onClose,
  onSaved,
}: {
  customerId: string;
  customerName: string;
  onClose(): void;
  onSaved(message: string): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittingRef = useRef(false);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [values, setValues] = useState<CustomerFormValues | null>(null);
  const [result, setResult] = useState<UpdateCustomerActionState | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [pending, startTransition] = useTransition();
  const fieldErrors = result?.status === "error" ? result.fieldErrors : {};
  const blocked =
    result?.status === "error" &&
    (result.code === "DELETED" || result.code === "NOT_FOUND");
  const dirty =
    load.status === "ready" &&
    values !== null &&
    FIELDS.some((field) => values[field] !== load.original[field]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const formData = new FormData();
    formData.set("customerId", customerId);
    getCustomerForEditAction(formData)
      .then((state) => {
        if (!active) return;
        if (state.status === "found") {
          const original = {
            name: state.customer.name,
            email: state.customer.email,
            phone: state.customer.phone,
          };
          setLoad({ status: "ready", original });
          setValues(original);
          setResult(null);
        } else {
          setLoad({ status: "error", message: state.message });
        }
      })
      .catch(() => {
        if (active) {
          setLoad({
            status: "error",
            message: "No se pudo cargar el cliente. Inténtalo de nuevo.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [customerId, loadVersion]);

  // The loading state's only control disappears once the form renders, so
  // move focus to the first field instead of letting it fall to the body.
  useEffect(() => {
    if (load.status === "ready") {
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    }
  }, [load.status]);

  function requestClose() {
    if (pending || submittingRef.current) return;
    if (
      dirty &&
      !blocked &&
      !window.confirm("¿Descartar los cambios sin guardar?")
    ) {
      return;
    }
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
    }
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    requestClose();
  }

  function updateField(field: CustomerFormField, value: string) {
    setValues((current) => (current ? { ...current, [field]: value } : current));
    if (!blocked) setResult(null);
  }

  function reload() {
    setLoad({ status: "loading" });
    setValues(null);
    setResult(null);
    setLoadVersion((version) => version + 1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submittingRef.current ||
      pending ||
      blocked ||
      load.status !== "ready" ||
      values === null
    ) {
      return;
    }
    submittingRef.current = true;

    const formData = new FormData();
    formData.set("customerId", customerId);
    for (const field of FIELDS) {
      formData.set(field, values[field]);
      formData.set(`original.${field}`, load.original[field]);
    }
    startTransition(async () => {
      try {
        const actionResult = await updateCustomerAction(formData);
        setResult(actionResult);
        if (actionResult.status === "success") onSaved(actionResult.message);
      } catch {
        setResult({
          status: "error",
          code: "UNKNOWN",
          message: "No se pudo guardar el cliente. Inténtalo de nuevo.",
          fieldErrors: {},
          conflictFields: [],
        });
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <dialog
      aria-busy={load.status === "loading" || pending}
      aria-labelledby="customer-edit-heading"
      className="dashboard-product-edit m-auto w-[calc(100%-2rem)] max-w-2xl rounded-xl p-0"
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      ref={dialogRef}
    >
      <div className="dashboard-product-edit__panel max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-5 sm:p-6">
        <p aria-hidden="true" className="dashboard-product-edit__ornament text-center text-xs">
          ◆
        </p>
        <h2
          className="dashboard-product-form__title mt-1 text-center text-lg font-semibold"
          id="customer-edit-heading"
        >
          Editar cliente
        </h2>
        <p className="dashboard-listing__hint mt-1 text-center text-sm">
          {customerName}
        </p>

        {load.status === "loading" ? (
          <p className="dashboard-listing__pending mt-6 text-sm" role="status">
            Cargando cliente...
          </p>
        ) : null}

        {load.status === "error" ? (
          <p
            className="dashboard-listing__feedback dashboard-listing__feedback--error mt-6 rounded-lg p-3 text-sm"
            role="alert"
          >
            {load.message}
          </p>
        ) : null}

        {load.status === "ready" && values ? (
          <form className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2" onSubmit={submit}>
            <CustomerFields
              disabled={pending || blocked}
              fieldErrors={fieldErrors}
              idPrefix="customer-edit-"
              onChange={updateField}
              values={values}
            />

            {result?.status === "error" ? (
              <div
                className="dashboard-listing__feedback dashboard-listing__feedback--error flex flex-col gap-3 rounded-lg p-3 text-sm sm:col-span-2"
                role="alert"
              >
                <p>{result.message}</p>
                {result.code === "CONFLICT" ? (
                  <button
                    className="dashboard-summary__secondary-button self-start rounded-md border px-3 py-1.5 text-sm font-medium"
                    onClick={reload}
                    type="button"
                  >
                    Recargar datos del cliente
                  </button>
                ) : null}
              </div>
            ) : null}
            {result?.status === "unchanged" ? (
              <p
                className="dashboard-listing__feedback dashboard-listing__feedback--warning rounded-lg p-3 text-sm sm:col-span-2"
                role="status"
              >
                {result.message}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-end">
              {pending ? (
                <p
                  aria-live="polite"
                  className="dashboard-listing__pending text-sm sm:mr-auto"
                >
                  Guardando cambios...
                </p>
              ) : null}
              <button
                className="dashboard-summary__secondary-button min-h-10 rounded-md border px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                disabled={pending}
                onClick={requestClose}
                type="button"
              >
                {blocked ? "Cerrar" : "Cancelar"}
              </button>
              <button
                className="dashboard-listing__apply min-h-10 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={pending || blocked}
                type="submit"
              >
                {pending ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </form>
        ) : null}

        {load.status !== "ready" ? (
          <div className="mt-6 flex justify-end">
            <button
              className="dashboard-summary__secondary-button min-h-10 rounded-md border px-4 text-sm font-medium"
              onClick={requestClose}
              type="button"
            >
              Cerrar
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
