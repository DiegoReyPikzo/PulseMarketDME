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
          className="mt-1 min-h-10 w-full rounded-md border border-slate-700 bg-[#0b1117] px-3 text-sm text-slate-100 outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/40"
          inputMode={input.inputMode}
          maxLength={input.maxLength}
          name={field}
          onChange={(event) => updateField(field, event.currentTarget.value)}
          required={input.required}
          type={input.type ?? "text"}
          value={values[field]}
        />
        {fieldErrors[field] ? (
          <span className="mt-1 block text-xs text-rose-300" id={errorId}>
            {fieldErrors[field]}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <section
      aria-labelledby="product-creation-heading"
      className="mb-6 rounded-xl border border-slate-800 bg-[#0e151d] p-4"
    >
      <h2
        className="text-lg font-semibold text-slate-100"
        id="product-creation-heading"
      >
        Crear producto
      </h2>
      <form className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" onSubmit={submit}>
        <label className="block text-xs font-medium text-slate-400">
          SKU
          {fieldInput("sku", { maxLength: 64, required: true })}
        </label>
        <label className="block text-xs font-medium text-slate-400">
          Nombre
          {fieldInput("name", { maxLength: 160, required: true })}
        </label>
        <label className="block text-xs font-medium text-slate-400">
          Categoría
          {fieldInput("category", { maxLength: 100, required: true })}
        </label>
        <label className="block text-xs font-medium text-slate-400">
          Precio
          {fieldInput("price", {
            inputMode: "decimal",
            required: true,
          })}
        </label>
        <label className="block text-xs font-medium text-slate-400">
          Stock
          {fieldInput("stock", { inputMode: "numeric" })}
        </label>
        <label className="block text-xs font-medium text-slate-400 sm:col-span-2 xl:col-span-3">
          Descripción (opcional)
          {fieldInput("description")}
        </label>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2 xl:col-span-3">
          <button
            className="min-h-10 rounded-md bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            {pending ? "Creando..." : "Crear producto"}
          </button>
          {pending ? (
            <p aria-live="polite" className="text-sm text-cyan-300">
              Guardando producto...
            </p>
          ) : null}
        </div>
      </form>
      {result?.status === "error" ? (
        <p
          aria-live="polite"
          className="mt-4 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300"
          role="alert"
        >
          {result.message}
        </p>
      ) : null}
      {result?.status === "success" ? (
        <p
          aria-live="polite"
          className="mt-4 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300"
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
