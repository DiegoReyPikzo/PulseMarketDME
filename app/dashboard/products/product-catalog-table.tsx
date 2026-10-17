"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  bulkMutateProductsAction,
  softDeleteProductAction,
  type ProductMutationActionState,
} from "./actions";

type ProductListItem = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  price: string;
  stock: number;
};

export function ProductCatalogTable({
  products,
}: {
  products: readonly ProductListItem[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [operation, setOperation] = useState<"category" | "adjust">("category");
  const [field, setField] = useState<"price" | "stock">("price");
  const [mode, setMode] = useState<"fixed" | "percentage">("fixed");
  const [feedback, setFeedback] = useState<ProductMutationActionState | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const visibleIds = products.map(({ id }) => id);
  const selectedVisibleCount = visibleIds.filter((id) =>
    selectedIds.includes(id),
  ).length;
  const selectionExceedsLimit = selectedIds.length > 50;
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;

  function toggleVisibleSelection(checked: boolean) {
    setSelectedIds((current) => {
      const otherPages = current.filter((id) => !visibleIds.includes(id));
      return checked ? [...otherPages, ...visibleIds] : otherPages;
    });
  }

  function applyResult(result: ProductMutationActionState) {
    setFeedback(result);
    if (result.status === "success") {
      setSelectedIds([]);
      router.refresh();
    }
  }

  function runIndividualDelete(id: string) {
    if (!window.confirm("¿Eliminar este producto del catálogo?")) return;

    const formData = new FormData();
    formData.set("productId", id);
    startTransition(async () => {
      applyResult(await softDeleteProductAction(formData));
    });
  }

  function runBulkDelete() {
    if (
      !window.confirm(
        `¿Eliminar los ${selectedIds.length} productos seleccionados del catálogo?`,
      )
    ) {
      return;
    }

    const formData = new FormData();
    formData.set("productIds", JSON.stringify(selectedIds));
    formData.set("operation", "delete");
    startTransition(async () => {
      applyResult(await bulkMutateProductsAction(formData));
    });
  }

  return (
    <section aria-label="Gestión del catálogo" className="space-y-4">
      {selectedIds.length > 0 ? (
        <form
          action={async (formData) => {
            if (
              !window.confirm(
                `¿Aplicar el cambio a ${selectedIds.length} productos?`,
              )
            ) {
              return;
            }
            startTransition(async () => {
              applyResult(await bulkMutateProductsAction(formData));
            });
          }}
          className="flex flex-col gap-4 rounded-xl border border-cyan-900/70 bg-[#0e151d] p-4 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <input
            name="productIds"
            type="hidden"
            value={JSON.stringify(selectedIds)}
          />
          <div className="text-sm font-medium text-cyan-300">
            {selectedIds.length} seleccionados
          </div>
          <label className="text-xs font-medium text-slate-400">
            Acción masiva
            <select
              className="mt-1 min-h-10 rounded-md border border-slate-700 bg-[#0b1117] px-3 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400"
              name="operation"
              onChange={(event) => {
                if (isBulkOperation(event.target.value)) {
                  setOperation(event.target.value);
                }
              }}
              value={operation}
            >
              <option value="category">Cambiar categoría</option>
              <option value="adjust">Ajustar precio o stock</option>
            </select>
          </label>
          {operation === "category" ? (
            <label className="text-xs font-medium text-slate-400">
              Nueva categoría
              <input
                className="mt-1 min-h-10 rounded-md border border-slate-700 bg-[#0b1117] px-3 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400"
                maxLength={100}
                name="category"
                required
              />
            </label>
          ) : (
            <>
              <label className="text-xs font-medium text-slate-400">
                Campo
                <select
                  className="mt-1 min-h-10 rounded-md border border-slate-700 bg-[#0b1117] px-3 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400"
                  name="field"
                  onChange={(event) => {
                    if (isAdjustmentField(event.target.value)) {
                      setField(event.target.value);
                    }
                  }}
                  value={field}
                >
                  <option value="price">Precio</option>
                  <option value="stock">Stock</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-400">
                Tipo de ajuste
                <select
                  className="mt-1 min-h-10 rounded-md border border-slate-700 bg-[#0b1117] px-3 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400"
                  name="mode"
                  onChange={(event) => {
                    if (isAdjustmentMode(event.target.value)) {
                      setMode(event.target.value);
                    }
                  }}
                  value={mode}
                >
                  <option value="fixed">Cantidad fija</option>
                  <option value="percentage">Porcentaje</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-400">
                {mode === "percentage" ? "Porcentaje (+/-)" : "Ajuste (+/-)"}
                <input
                  className="mt-1 min-h-10 w-36 rounded-md border border-slate-700 bg-[#0b1117] px-3 text-right font-mono text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400"
                  inputMode="decimal"
                  name="amount"
                  required
                  step={field === "stock" && mode === "fixed" ? "1" : "0.01"}
                  type="number"
                />
              </label>
            </>
          )}
          <button
            className="min-h-10 rounded-md bg-cyan-400 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50"
            disabled={pending || selectionExceedsLimit}
            type="submit"
          >
            Aplicar cambio
          </button>
          <button
            className="min-h-10 rounded-md border border-rose-900 px-4 text-sm font-medium text-rose-300 hover:border-rose-500 focus-visible:outline-2 focus-visible:outline-rose-400 disabled:opacity-50"
            disabled={pending || selectionExceedsLimit}
            onClick={runBulkDelete}
            type="button"
          >
            Eliminar seleccionados
          </button>
        </form>
      ) : null}
      {selectionExceedsLimit ? (
        <p className="text-sm text-amber-300" role="status">
          El lote admite hasta 50 productos. Desmarca algunos para continuar.
        </p>
      ) : null}

      {feedback ? (
        <p
          aria-live="polite"
          className={`rounded-lg border p-3 text-sm ${
            feedback.status === "success"
              ? "border-emerald-800 bg-emerald-950/40 text-emerald-300"
              : "border-rose-800 bg-rose-950/40 text-rose-300"
          }`}
          role={feedback.status === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0e151d]">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">Resultados y acciones de productos</caption>
          <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  aria-label="Seleccionar todos los productos visibles"
                  checked={allVisibleSelected}
                  className="h-4 w-4 accent-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-400"
                  onChange={(event) =>
                    toggleVisibleSelection(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
              </th>
              <th className="px-4 py-3 font-medium" scope="col">SKU</th>
              <th className="px-4 py-3 font-medium" scope="col">Producto</th>
              <th className="px-4 py-3 font-medium" scope="col">Categoría</th>
              <th className="px-4 py-3 text-right font-medium" scope="col">Precio</th>
              <th className="px-4 py-3 text-right font-medium" scope="col">Stock</th>
              <th className="px-4 py-3 text-right font-medium" scope="col">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {products.length === 0 ? (
              <tr>
                <td className="px-4 py-12 text-center text-slate-400" colSpan={7}>
                  No se encontraron resultados con estos criterios.
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr className="hover:bg-slate-900/50" key={product.id}>
                  <td className="px-4 py-3.5">
                    <input
                      aria-label={`Seleccionar ${product.name}`}
                      checked={selectedIds.includes(product.id)}
                      className="h-4 w-4 accent-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-400"
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelectedIds((current) =>
                          checked
                            ? [...current, product.id]
                            : current.filter((id) => id !== product.id),
                        );
                      }}
                      type="checkbox"
                    />
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-200">
                    {product.sku}
                  </td>
                  <td className="px-4 py-3.5 text-slate-200">{product.name}</td>
                  <td className="px-4 py-3.5 text-slate-200">
                    {product.category ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-200">
                    {product.price}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-200">
                    {product.stock}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <button
                      className="rounded px-2 py-1 text-xs text-slate-400 underline decoration-slate-700 underline-offset-4 hover:text-rose-300 focus-visible:outline-2 focus-visible:outline-rose-400 disabled:opacity-50"
                      disabled={pending}
                      onClick={() => runIndividualDelete(product.id)}
                      type="button"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pending ? (
        <p aria-live="polite" className="text-sm text-cyan-300">
          Aplicando cambios...
        </p>
      ) : null}
    </section>
  );
}

function isBulkOperation(value: string): value is "category" | "adjust" {
  return value === "category" || value === "adjust";
}

function isAdjustmentField(value: string): value is "price" | "stock" {
  return value === "price" || value === "stock";
}

function isAdjustmentMode(value: string): value is "fixed" | "percentage" {
  return value === "fixed" || value === "percentage";
}
