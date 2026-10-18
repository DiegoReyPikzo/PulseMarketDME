"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent, KeyboardEvent, SyntheticEvent } from "react";

import type { UpdateProductActionState } from "../../../lib/product-update-action";
import { FORM_VALIDATION_MESSAGE } from "../../../lib/validation/field-errors";
import { productValueErrors } from "../../../lib/validation/product";
import { getProductForEditAction, updateProductAction } from "./actions";
import {
  ProductFields,
  type ProductFormField,
  type ProductFormValues,
} from "./product-fields";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; original: ProductFormValues }
  | { status: "error"; message: string };

const FIELDS: readonly ProductFormField[] = [
  "sku",
  "name",
  "description",
  "category",
  "price",
  "stock",
];

function pickFormValues(product: ProductFormValues): ProductFormValues {
  return Object.fromEntries(
    FIELDS.map((field) => [field, product[field]]),
  ) as ProductFormValues;
}

export function ProductEditDialog({
  productId,
  productName,
  onClose,
  onSaved,
}: {
  productId: string;
  productName: string;
  onClose(): void;
  onSaved(sku: string): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittingRef = useRef(false);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [values, setValues] = useState<ProductFormValues | null>(null);
  const [result, setResult] = useState<UpdateProductActionState | null>(null);
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
    formData.set("productId", productId);
    getProductForEditAction(formData)
      .then((state) => {
        if (!active) return;
        if (state.status === "found") {
          const original = pickFormValues(state.product);
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
            message: "No se pudo cargar el producto. Inténtalo de nuevo.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [productId, loadVersion]);

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

  function updateField(field: ProductFormField, value: string) {
    setValues((current) => (current ? { ...current, [field]: value } : current));
    if (result?.status !== "error" || !blocked) setResult(null);
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
    // Only the new values are checked here; original values and conflicts
    // stay with the server.
    const clientFieldErrors = productValueErrors(values);
    if (clientFieldErrors) {
      setResult({
        status: "error",
        code: "VALIDATION",
        message: FORM_VALIDATION_MESSAGE,
        fieldErrors: clientFieldErrors,
        conflictFields: [],
      });
      return;
    }
    submittingRef.current = true;

    const formData = new FormData();
    formData.set("productId", productId);
    for (const field of FIELDS) {
      formData.set(field, values[field]);
      formData.set(`original.${field}`, load.original[field]);
    }
    startTransition(async () => {
      try {
        const actionResult = await updateProductAction(formData);
        setResult(actionResult);
        if (actionResult.status === "success") onSaved(actionResult.sku);
      } catch {
        setResult({
          status: "error",
          code: "UNKNOWN",
          message: "No se pudo guardar el producto. Inténtalo de nuevo.",
          fieldErrors: {},
          conflictFields: [],
        });
      } finally {
        submittingRef.current = false;
      }
    });
  }

  const missingCategory =
    load.status === "ready" && load.original.category.trim().length === 0;

  return (
    <dialog
      aria-busy={load.status === "loading" || pending}
      aria-labelledby="product-edit-heading"
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
          id="product-edit-heading"
        >
          Editar producto
        </h2>
        <p className="dashboard-listing__hint mt-1 text-center text-sm">
          {productName}
        </p>

        {load.status === "loading" ? (
          <p className="dashboard-listing__pending mt-6 text-sm" role="status">
            Cargando producto...
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
          <form
            className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2"
            onSubmit={submit}
          >
            <ProductFields
              descriptionClassName="sm:col-span-2"
              disabled={pending || blocked}
              fieldErrors={fieldErrors}
              hints={
                missingCategory
                  ? {
                      category:
                        "Este producto no tiene categoría. Complétala para poder guardar.",
                    }
                  : {}
              }
              idPrefix="edit-"
              onChange={updateField}
              values={values}
            />
            <p className="dashboard-listing__hint text-xs sm:col-span-2">
              Si cambias el SKU, el anterior quedará disponible para otro
              producto.
            </p>

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
                    Recargar datos del producto
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
