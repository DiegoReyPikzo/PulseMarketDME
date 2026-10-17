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
import { DashboardShell } from "../dashboard-shell";
import { ProductCatalogTable } from "./product-catalog-table";
import { ProductCreationForm } from "./product-creation-form";
import {
  ListingForm,
  SearchControl,
  SelectFilter,
  TextFilter,
} from "../listing-controls";
import { ListingPagination } from "../listing-pagination";

type ProductsPageProps = {
  searchParams: Promise<DashboardSearchParams>;
};

async function ProductsListing({ searchParams }: ProductsPageProps) {
  await connection();
  const session = await getAuthenticatedSession();
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
  const result = await listProducts(input);
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
        <p className="mt-3 text-sm text-amber-300" role="status">
          Para reordenar, quita los filtros, elige orden ascendente y usa un
          tamaño de página de hasta 50 productos.
        </p>
      ) : null}
      <ProductCatalogTable
        allowReorder={allowReorder}
        key={result.items.map(({ id }) => id).join("|")}
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
    <header className="mb-6 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
        Catálogo y operaciones
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-100">
        {title}
      </h1>
      <p className="text-sm text-slate-400">{description}</p>
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
      className="my-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200"
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
    <Suspense fallback={<p className="p-8 text-slate-400">Cargando productos...</p>}>
      <ProductsListing searchParams={searchParams} />
    </Suspense>
  );
}
