"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

import type { CreateCustomerActionState } from "../../../lib/customer-mutation-actions";
import { createCustomerAction } from "./actions";
import {
  CustomerFields,
  type CustomerFormField,
  type CustomerFormValues,
} from "./customer-fields";

const initialValues: CustomerFormValues = { name: "", email: "", phone: "" };

export function CustomerCreationForm() {
  const router = useRouter();
  const submittingRef = useRef(false);
  const [values, setValues] = useState(initialValues);
  const [result, setResult] = useState<CreateCustomerActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldErrors = result?.status === "error" ? result.fieldErrors : {};

  function updateField(field: CustomerFormField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setResult(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || pending) return;
    submittingRef.current = true;
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const actionResult = await createCustomerAction(formData);
        setResult(actionResult);
        if (actionResult.status === "success") {
          setValues({ ...initialValues });
          router.refresh();
        }
      } catch {
        setResult({
          status: "error",
          code: "UNKNOWN",
          message: "No se pudo crear el cliente. Inténtalo de nuevo.",
          fieldErrors: {},
          conflictFields: [],
        });
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <section
      aria-labelledby="customer-creation-heading"
      className="dashboard-product-form mb-6 rounded-xl p-4"
    >
      <h2
        className="dashboard-product-form__title text-lg font-semibold"
        id="customer-creation-heading"
      >
        Crear cliente
      </h2>
      <form
        className="dashboard-product-form__grid mt-4 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        onSubmit={submit}
      >
        <CustomerFields
          fieldErrors={fieldErrors}
          idPrefix="customer-"
          onChange={updateField}
          values={values}
        />
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2 xl:col-span-3">
          <button
            className="dashboard-listing__apply min-h-10 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            {pending ? "Creando..." : "Crear cliente"}
          </button>
          {pending ? (
            <p aria-live="polite" className="dashboard-listing__pending text-sm">
              Guardando cliente...
            </p>
          ) : null}
        </div>
      </form>
      {result?.status === "error" ? (
        <p
          aria-live="polite"
          className="dashboard-listing__feedback dashboard-listing__feedback--error mt-4 rounded-lg p-3 text-sm"
          role="alert"
        >
          {result.message}
        </p>
      ) : null}
      {result?.status === "success" ? (
        <p
          aria-live="polite"
          className="dashboard-listing__feedback dashboard-listing__feedback--success mt-4 rounded-lg p-3 text-sm"
          role="status"
        >
          {result.message} La vista actual conserva sus filtros, orden y página;
          si no coincide con ellos, puede no aparecer en esta página.
        </p>
      ) : null}
    </section>
  );
}
