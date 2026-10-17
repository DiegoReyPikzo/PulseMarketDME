"use client";

import { useState } from "react";

import type { ProductMutationActionState } from "./actions";
import {
  ProductCatalogTable,
  type ProductListItem,
} from "./product-catalog-table";

// The table is keyed by the visible product IDs so its local order and
// selection resynchronize after deletes and reorders. Feedback lives here,
// outside that keyed subtree, so a refresh-triggered remount does not erase
// the confirmation; it stays until the next operation replaces it.
export function ProductCatalog({
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
  const [feedback, setFeedback] = useState<ProductMutationActionState | null>(
    null,
  );

  return (
    <section
      aria-label="Gestión del catálogo"
      className="dashboard-product-catalog min-w-0 space-y-4"
    >
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
      <ProductCatalogTable
        allowReorder={allowReorder}
        key={products.map(({ id }) => id).join("|")}
        onFeedback={setFeedback}
        page={page}
        pageSize={pageSize}
        products={products}
      />
    </section>
  );
}
