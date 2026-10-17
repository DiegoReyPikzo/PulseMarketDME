"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";

import type {
  CreateProductActionState,
  CreateProductField,
} from "../../../lib/product-creation-action";
import { createProductAction } from "./actions";

type ProductFormValues = Record<CreateProductField, string>;

const initialValues: ProductFormValues = {
  sku: "",
  name: "",
  description: "",
  category: "",
  price: "",
  stock: "0",
};

export function ProductCreationForm() {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [result, setResult] = useState<CreateProductActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldErrors = result?.status === "error" ? result.fieldErrors : {};

  function updateField(field: CreateProductField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setResult(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const actionResult = await createProductAction(formData);
      setResult(actionResult);
      if (actionResult.status === "success") {
        setValues({ ...initialValues });
        router.refresh();
      }
    });
  }

  function fieldInput(
    field: CreateProductField,
    input: {
      autoComplete?: string;
      inputMode?: "decimal" | "numeric" | "text";
      maxLength?: number;
      required?: boolean;
      type?: "text";
    } = {},
  ) {
    const errorId = `${field}-error`;
    return (
      <>
        <input
          aria-describedby={fieldErrors[field] ? errorId : undefined}
          aria-invalid={Boolean(fieldErrors[field])}
          autoComplete={input.autoComplete}
          className="dashboard-listing__control mt-1 min-h-10 w-full rounded-md border px-3 text-sm"
          inputMode={input.inputMode}
          maxLength={input.maxLength}
          name={field}
          onChange={(event) => updateField(field, event.currentTarget.value)}
          required={input.required}
          type={input.type ?? "text"}
          value={values[field]}
        />
        {fieldErrors[field] ? (
          <span className="dashboard-listing__field-error mt-1 block text-xs" id={errorId}>
            {fieldErrors[field]}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <section
      aria-labelledby="product-creation-heading"
      className="dashboard-product-form mb-6 rounded-xl p-4"
    >
      <h2
        className="dashboard-product-form__title text-lg font-semibold"
        id="product-creation-heading"
      >
        Crear producto
      </h2>
      <form className="dashboard-product-form__grid mt-4 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3" onSubmit={submit}>
        <label className="dashboard-listing__label block text-xs font-medium">
          SKU
          {fieldInput("sku", { maxLength: 64, required: true })}
        </label>
        <label className="dashboard-listing__label block text-xs font-medium">
          Nombre
          {fieldInput("name", { maxLength: 160, required: true })}
        </label>
        <label className="dashboard-listing__label block text-xs font-medium">
          Categoría
          {fieldInput("category", { maxLength: 100, required: true })}
        </label>
        <label className="dashboard-listing__label block text-xs font-medium">
          Precio
          {fieldInput("price", {
            inputMode: "decimal",
            required: true,
          })}
        </label>
        <label className="dashboard-listing__label block text-xs font-medium">
          Stock
          {fieldInput("stock", { inputMode: "numeric" })}
        </label>
        <label className="dashboard-listing__label block text-xs font-medium sm:col-span-2 xl:col-span-3">
          Descripción (opcional)
          {fieldInput("description")}
        </label>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2 xl:col-span-3">
          <button
            className="dashboard-listing__apply min-h-10 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            {pending ? "Creando..." : "Crear producto"}
          </button>
          {pending ? (
            <p aria-live="polite" className="dashboard-listing__pending text-sm">
              Guardando producto...
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
          Producto {result.sku} creado. La vista actual conserva sus filtros,
          orden y página; si no coincide con ellos, puede no aparecer en esta
          página.
        </p>
      ) : null}
    </section>
  );
}
