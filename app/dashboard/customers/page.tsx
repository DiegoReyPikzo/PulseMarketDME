import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";

import { getAuthenticatedSession } from "../../../lib/auth-session";
import {
  parseListSearchParams,
  type DashboardSearchParams,
} from "../../../lib/dashboard/list-params";
import { customerListInputSchema } from "../../../lib/queries/inputs";
import { listCustomers } from "../../../lib/queries/customers";
import { DashboardShell } from "../dashboard-shell";
import {
  ListingForm,
  SearchControl,
  SelectFilter,
} from "../listing-controls";
import { ListingPagination } from "../listing-pagination";
import { WingedPiggybank } from "../../components/loading/winged-piggybank";
import { ListingTable, TableCell } from "../listing-table";

type CustomersPageProps = {
  searchParams: Promise<DashboardSearchParams>;
};

async function CustomersListing({ searchParams }: CustomersPageProps) {
  await connection();
  const session = await getAuthenticatedSession();
  const params = await searchParams;
  const parsed = parseListSearchParams(customerListInputSchema, params);

  if (!parsed.success) {
    return (
      <DashboardShell session={session} activePath="/dashboard/customers">
        <Heading />
        <InvalidParams message={parsed.message} />
        <CustomerFilters
          pageSize="20"
          search={stringValue(params.search)}
          sortBy="createdAt"
          sortOrder="desc"
        />
      </DashboardShell>
    );
  }

  const input = parsed.data;
  const result = await listCustomers(input);

  return (
    <DashboardShell session={session} activePath="/dashboard/customers">
      <Heading />
      <CustomerFilters
        pageSize={String(input.pageSize)}
        search={input.search ?? ""}
        sortBy={input.sortBy}
        sortOrder={input.sortOrder}
      />
      <ListingTable
        caption="Resultados de clientes"
        columns={[
          { label: "Nombre" },
          { label: "Correo electrónico" },
          { label: "Teléfono" },
          { label: "Creado" },
        ]}
        empty={result.items.length === 0}
      >
        {result.items.map((customer) => (
          <tr className="dashboard-listing__row" key={customer.id}>
            <TableCell>{customer.name}</TableCell>
            <TableCell>{customer.email}</TableCell>
            <TableCell>{customer.phone ?? "—"}</TableCell>
            <TableCell mono>
              {new Date(customer.createdAt).toLocaleDateString("es")}
            </TableCell>
          </tr>
        ))}
      </ListingTable>
      <ListingPagination
        page={input.page}
        pageSize={input.pageSize}
        pathname="/dashboard/customers"
        total={result.total}
        totalPages={result.totalPages}
        values={{
          search: input.search,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
        }}
      />
    </DashboardShell>
  );
}

function CustomerFilters({
  search,
  sortBy,
  sortOrder,
  pageSize,
}: {
  search: string;
  sortBy: string;
  sortOrder: string;
  pageSize: string;
}) {
  return (
    <ListingForm action="/dashboard/customers">
      <SearchControl defaultValue={search} />
      <SelectFilter
        defaultValue={sortBy}
        label="Ordenar por"
        name="sortBy"
        options={[
          { value: "createdAt", label: "Fecha de creación" },
          { value: "name", label: "Nombre" },
          { value: "email", label: "Correo electrónico" },
        ]}
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
      <SelectFilter
        defaultValue={pageSize}
        label="Elementos por página"
        name="pageSize"
        options={[
          { value: "20", label: "20" },
          { value: "50", label: "50" },
          { value: "100", label: "100" },
        ]}
      />
    </ListingForm>
  );
}

function Heading() {
  return (
    <header className="dashboard-page-heading mb-6 space-y-2">
      <p className="dashboard-page-heading__eyebrow text-xs font-semibold uppercase">
        Directorio
      </p>
      <h1 className="dashboard-page-heading__title text-3xl tracking-tight">
        Clientes
      </h1>
      <p className="dashboard-page-heading__copy text-sm">
        Busca y ordena clientes por sus datos registrados.
      </p>
    </header>
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
        href="/dashboard/customers"
      >
        Restablecer filtros
      </Link>
    </div>
  );
}

function stringValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default function CustomersPage({ searchParams }: CustomersPageProps) {
  return (
    <Suspense
      fallback={
        <WingedPiggybank layout="page" message="Preparando tus clientes..." />
      }
    >
      <CustomersListing searchParams={searchParams} />
    </Suspense>
  );
}
