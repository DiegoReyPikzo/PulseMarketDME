import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

import { getAuthenticatedSession } from "../../../lib/auth-session";
import {
  parseListSearchParams,
  searchParamValue,
  type DashboardSearchParams,
} from "../../../lib/dashboard/list-params";
import { productListInputSchema } from "../../../lib/queries/inputs";
import { listProducts } from "../../../lib/queries/products";
import { logListingTiming, now } from "../../../lib/perf-log";
import { DashboardShell } from "../dashboard-shell";
import { ProductCatalog } from "./product-catalog";
import { ProductCreationForm } from "./product-creation-form";
import {
  ListingForm,
  SearchControl,
  SelectFilter,
  TextFilter,
} from "../listing-controls";
import { ListingPagination } from "../listing-pagination";
import { ProductsFallback } from "../../components/loading/data-fallbacks";

type ProductsPageProps = {
  searchParams: Promise<DashboardSearchParams>;
};

async function ProductsListing({ searchParams }: ProductsPageProps) {
  // Temporary timing (lib/perf-log.ts); remove with that module.
  const started = now();
  await connection();
  const connectionMs = now() - started;
  const sessionStarted = now();
  const session = await getAuthenticatedSession();
  const sessionMs = now() - sessionStarted;
  const params = await searchParams;
  const parsed = parseListSearchParams(productListInputSchema, params);

  if (!parsed.success) {
    return (
      <DashboardShell session={session} activePath="/dashboard/products">
        <ProductCreationForm />
        <ListingHeading
          description="Consulta el catálogo activo con filtros y orden en la base de datos."
          title="Productos"
        />
        <InvalidParams message={parsed.message} />
        <ProductFilters
          values={{
            search: searchParamValue(params, "search"),
            category: searchParamValue(params, "category"),
            sortBy: searchParamValue(params, "sortBy", "createdAt"),
            sortOrder: searchParamValue(params, "sortOrder", "desc"),
            pageSize: searchParamValue(params, "pageSize", "20"),
          }}
        />
      </DashboardShell>
    );
  }

  const input = parsed.data;
  const listStarted = now();
  const result = await listProducts(input);
  const listMs = now() - listStarted;
  logListingTiming({
    route: "/dashboard/products",
    connectionMs,
    sessionMs,
    listMs,
    dataReadyMs: now() - started,
    page: input.page,
    pageSize: input.pageSize,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    filtered: Boolean(input.search || input.category),
    rows: result.items.length,
  });
  const allowReorder =
    !input.search &&
    !input.category &&
    input.sortBy === "sortOrder" &&
    input.sortOrder === "asc" &&
    input.pageSize <= 50;
  const pageValues = {
    search: input.search,
    category: input.category,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
  };

  return (
    <DashboardShell session={session} activePath="/dashboard/products">
      <ProductCreationForm />
      <ListingHeading
        description="Consulta el catálogo activo con filtros y orden en la base de datos."
        title="Productos"
      />
      <ProductFilters values={input} />
      {input.sortBy === "sortOrder" && !allowReorder ? (
        <p className="dashboard-listing__warning mt-3 text-sm" role="status">
          Para reordenar, quita los filtros, elige orden ascendente y usa un
          tamaño de página de hasta 50 productos.
        </p>
      ) : null}
      <ProductCatalog
        allowReorder={allowReorder}
        page={input.page}
        pageSize={input.pageSize}
        products={result.items}
      />
      <ListingPagination
        page={input.page}
        pageSize={input.pageSize}
        pathname="/dashboard/products"
        total={result.total}
        totalPages={result.totalPages}
        values={pageValues}
      />
    </DashboardShell>
  );
}

function ProductFilters({
  values,
}: {
  values: Record<string, string | number | undefined>;
}) {
  return (
    <ListingForm action="/dashboard/products">
      <SearchControl defaultValue={stringValue(values.search)} />
      <TextFilter
        defaultValue={stringValue(values.category)}
        label="Categoría exacta"
        name="category"
        placeholder="Todas las categorías"
      />
      <SortControls
        sortBy={stringValue(values.sortBy, "createdAt")}
        sortOptions={[
          ["createdAt", "Fecha de creación"],
          ["name", "Nombre"],
          ["sku", "SKU"],
          ["price", "Precio"],
          ["sortOrder", "Posición personalizada"],
        ]}
        sortOrder={stringValue(values.sortOrder, "desc")}
      />
      <PageSizeControl value={stringValue(values.pageSize, "20")} />
    </ListingForm>
  );
}

function ListingHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="dashboard-page-heading mb-6 space-y-2">
      <p className="dashboard-page-heading__eyebrow text-xs font-semibold uppercase">
        Catálogo y operaciones
      </p>
      <h1 className="dashboard-page-heading__title text-3xl tracking-tight">
        {title}
      </h1>
      <p className="dashboard-page-heading__copy text-sm">{description}</p>
    </header>
  );
}

function SortControls({
  sortBy,
  sortOrder,
  sortOptions,
}: {
  sortBy: string;
  sortOrder: string;
  sortOptions: readonly (readonly [string, string])[];
}) {
  return (
    <>
      <SelectFilter
        defaultValue={sortBy}
        label="Ordenar por"
        name="sortBy"
        options={sortOptions.map(([value, label]) => ({ value, label }))}
      />
      <SelectFilter
        defaultValue={sortOrder}
        label="Dirección"
        name="sortOrder"
        options={[
          { value: "desc", label: "Descendente" },
          { value: "asc", label: "Ascendente" },
        ]}
      />
    </>
  );
}

function PageSizeControl({ value }: { value: string }) {
  return (
    <SelectFilter
      defaultValue={value}
      label="Elementos por página"
      name="pageSize"
      options={[
        { value: "20", label: "20" },
        { value: "50", label: "50" },
        { value: "100", label: "100" },
      ]}
    />
  );
}

function InvalidParams({ message }: { message: string }) {
  return (
    <div
      className="dashboard-listing__feedback dashboard-listing__feedback--warning my-5 rounded-lg p-4 text-sm"
      role="alert"
    >
      <p className="font-medium">No se pudieron aplicar los parámetros.</p>
      <p className="mt-1">{message}</p>
      <Link
        className="mt-3 inline-block underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-cyan-400"
        href="/dashboard/products"
      >
        Restablecer filtros
      </Link>
    </div>
  );
}

function stringValue(value: string | number | undefined, fallback = ""): string {
  return value === undefined ? fallback : String(value);
}

export default function ProductsPage({ searchParams }: ProductsPageProps) {
  return (
    <Suspense
      fallback={<ProductsFallback />}
    >
      <ProductsListing searchParams={searchParams} />
    </Suspense>
  );
}
