"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DragEvent } from "react";

import {
  bulkMutateProductsAction,
  reorderProductsAction,
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
  allowReorder,
  page,
  pageSize,
}: {
  products: readonly ProductListItem[];
  allowReorder: boolean;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const [orderedProducts, setOrderedProducts] = useState([...products]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [operation, setOperation] = useState<"category" | "adjust">("category");
  const [field, setField] = useState<"price" | "stock">("price");
  const [mode, setMode] = useState<"fixed" | "percentage">("fixed");
  const [feedback, setFeedback] = useState<ProductMutationActionState | null>(
    null,
  );
  const [draggingProductId, setDraggingProductId] = useState<string | null>(
    null,
  );
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const visibleIds = orderedProducts.map(({ id }) => id);
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

  function persistOrder(nextProducts: ProductListItem[]) {
    const previousProducts = orderedProducts;
    setOrderedProducts(nextProducts);
    setFeedback(null);

    const formData = new FormData();
    formData.set("productIds", JSON.stringify(nextProducts.map(({ id }) => id)));
    formData.set(
      "expectedProductIds",
      JSON.stringify(previousProducts.map(({ id }) => id)),
    );
    formData.set("page", String(page));
    formData.set("pageSize", String(pageSize));
    startTransition(async () => {
      try {
        const result = await reorderProductsAction(formData);
        setFeedback(result);
        if (result.status === "success") {
          router.refresh();
        } else {
          setOrderedProducts(previousProducts);
        }
      } catch {
        setOrderedProducts(previousProducts);
        setFeedback({
          status: "error",
          message: "No se pudo guardar el orden. Se restauró la posición anterior.",
        });
      }
    });
  }

  function moveProduct(sourceId: string, targetIndex: number) {
    const sourceIndex = orderedProducts.findIndex(
      (product) => product.id === sourceId,
    );
    if (
      sourceIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= orderedProducts.length ||
      sourceIndex === targetIndex ||
      pending
    ) {
      return;
    }

    const nextProducts = [...orderedProducts];
    const [moved] = nextProducts.splice(sourceIndex, 1);
    nextProducts.splice(targetIndex, 0, moved);
    persistOrder(nextProducts);
  }

  function handleDrop(event: DragEvent<HTMLTableRowElement>, targetIndex: number) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain");
    if (sourceId) moveProduct(sourceId, targetIndex);
  }

  return (
    <section
      aria-label="Gestión del catálogo"
      className="dashboard-product-catalog min-w-0 space-y-4"
    >
      {allowReorder ? (
        <p className="dashboard-listing__hint text-sm">
          Arrastra el control de una fila o usa los botones Subir y Bajar para
          guardar el orden del catálogo.
        </p>
      ) : null}
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
          className="dashboard-product-catalog__bulk flex min-w-0 flex-col gap-4 rounded-xl p-4 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <input
            name="productIds"
            type="hidden"
            value={JSON.stringify(selectedIds)}
          />
          <div className="dashboard-product-catalog__selection text-sm font-medium">
            {selectedIds.length} seleccionados
          </div>
          <label className="dashboard-listing__label text-xs font-medium">
            Acción masiva
            <select
              className="dashboard-listing__control mt-1 min-h-10 rounded-md border px-3 text-sm"
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
            <label className="dashboard-listing__label text-xs font-medium">
              Nueva categoría
              <input
                className="dashboard-listing__control mt-1 min-h-10 rounded-md border px-3 text-sm"
                maxLength={100}
                name="category"
                required
              />
            </label>
          ) : (
            <>
              <label className="dashboard-listing__label text-xs font-medium">
                Campo
                <select
                  className="dashboard-listing__control mt-1 min-h-10 rounded-md border px-3 text-sm"
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
              <label className="dashboard-listing__label text-xs font-medium">
                Tipo de ajuste
                <select
                  className="dashboard-listing__control mt-1 min-h-10 rounded-md border px-3 text-sm"
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
              <label className="dashboard-listing__label text-xs font-medium">
                {mode === "percentage" ? "Porcentaje (+/-)" : "Ajuste (+/-)"}
                <input
                  className="dashboard-listing__control mt-1 min-h-10 w-full max-w-36 rounded-md border px-3 text-right font-mono text-sm"
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
            className="dashboard-listing__apply min-h-10 rounded-md px-4 text-sm font-semibold disabled:opacity-50"
            disabled={pending || selectionExceedsLimit}
            type="submit"
          >
            Aplicar cambio
          </button>
          <button
            className="dashboard-listing__danger min-h-10 rounded-md border px-4 text-sm font-medium disabled:opacity-50"
            disabled={pending || selectionExceedsLimit}
            onClick={runBulkDelete}
            type="button"
          >
            Eliminar seleccionados
          </button>
        </form>
      ) : null}
      {selectionExceedsLimit ? (
        <p className="dashboard-listing__warning text-sm" role="status">
          El lote admite hasta 50 productos. Desmarca algunos para continuar.
        </p>
      ) : null}

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

      <div className="dashboard-product-catalog__table-scroll min-w-0 max-w-full overflow-x-auto rounded-xl">
        <table className="dashboard-product-catalog__table w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">Resultados y acciones de productos</caption>
          <thead className="text-xs uppercase tracking-wide">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  aria-label="Seleccionar todos los productos visibles"
                  checked={allVisibleSelected}
                  className="dashboard-product-catalog__checkbox h-4 w-4"
                  onChange={(event) =>
                    toggleVisibleSelection(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
              </th>
              {allowReorder ? (
                <th className="w-24 px-4 py-3 font-medium" scope="col">
                  Orden
                </th>
              ) : null}
              <th className="px-4 py-3 font-medium" scope="col">SKU</th>
              <th className="px-4 py-3 font-medium" scope="col">Producto</th>
              <th className="px-4 py-3 font-medium" scope="col">Categoría</th>
              <th className="px-4 py-3 text-right font-medium" scope="col">Precio</th>
              <th className="px-4 py-3 text-right font-medium" scope="col">Stock</th>
              <th className="px-4 py-3 text-right font-medium" scope="col">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {            orderedProducts.length === 0 ? (
              <tr>
                <td
                  className="dashboard-listing__empty px-4 py-12 text-center"
                  colSpan={allowReorder ? 8 : 7}
                >
                  No se encontraron resultados con estos criterios.
                </td>
              </tr>
            ) : (
            orderedProducts.map((product, index) => (
              <tr
                className={[
                  "dashboard-product-catalog__row",
                  selectedIds.includes(product.id)
                    ? "dashboard-product-catalog__row--selected"
                    : "",
                  draggingProductId === product.id
                    ? "dashboard-product-catalog__row--dragging"
                    : "",
                  dropTargetId === product.id
                    ? "dashboard-product-catalog__row--drop-target"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={product.id}
                onDragOver={(event) => {
                  if (
                    allowReorder &&
                    !pending &&
                    event.dataTransfer.types.includes("text/plain")
                  ) {
                    event.preventDefault();
                    setDropTargetId(product.id);
                  }
                }}
                onDrop={(event) => {
                  if (allowReorder) {
                    setDraggingProductId(null);
                    setDropTargetId(null);
                    handleDrop(event, index);
                  }
                }}
                onDragLeave={(event) => {
                  if (
                    event.currentTarget === event.target &&
                    dropTargetId === product.id
                  ) {
                    setDropTargetId(null);
                  }
                }}
              >
                <td className="px-4 py-3.5">
                    <input
                      aria-label={`Seleccionar ${product.name}`}
                      checked={selectedIds.includes(product.id)}
                      className="dashboard-product-catalog__checkbox h-4 w-4"
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
                  {allowReorder ? (
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          aria-label={`Arrastrar ${product.name}`}
                          className="dashboard-product-catalog__drag cursor-grab rounded px-2 py-1 active:cursor-grabbing disabled:opacity-50"
                          disabled={pending}
                          draggable={!pending}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", product.id);
                            setDraggingProductId(product.id);
                          }}
                          onDragEnd={() => {
                            setDraggingProductId(null);
                            setDropTargetId(null);
                          }}
                          title="Arrastrar para reordenar"
                          type="button"
                        >
                          ⋮⋮
                        </button>
                        <button
                          aria-label={`Subir ${product.name}`}
                          className="dashboard-product-catalog__move rounded px-1.5 py-1 text-xs disabled:opacity-40"
                          disabled={pending || index === 0}
                          onClick={() => moveProduct(product.id, index - 1)}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`Bajar ${product.name}`}
                          className="dashboard-product-catalog__move rounded px-1.5 py-1 text-xs disabled:opacity-40"
                          disabled={pending || index === orderedProducts.length - 1}
                          onClick={() => moveProduct(product.id, index + 1)}
                          type="button"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                  ) : null}
                  <td className="dashboard-product-catalog__cell px-4 py-3.5 font-mono text-xs">
                    {product.sku}
                  </td>
                  <td className="dashboard-product-catalog__cell px-4 py-3.5">{product.name}</td>
                  <td className="dashboard-product-catalog__cell px-4 py-3.5">
                    {product.category ?? "—"}
                  </td>
                  <td className="dashboard-product-catalog__cell dashboard-product-catalog__numeric px-4 py-3.5 text-right font-mono tabular-nums">
                    {product.price}
                  </td>
                  <td className="dashboard-product-catalog__cell dashboard-product-catalog__numeric px-4 py-3.5 text-right tabular-nums">
                    {product.stock}
                  </td>
                  <td className="dashboard-product-catalog__cell px-4 py-3.5 text-right">
                    <button
                      className="dashboard-product-catalog__delete rounded px-2 py-1 text-xs underline underline-offset-4 disabled:opacity-50"
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
        <p aria-live="polite" className="dashboard-listing__pending text-sm">
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
