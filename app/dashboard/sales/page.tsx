import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

import { getAuthenticatedSession } from "../../../lib/auth-session";
import {
  parseListSearchParams,
  type DashboardSearchParams,
} from "../../../lib/dashboard/list-params";
import { saleListInputSchema } from "../../../lib/queries/inputs";
import { listSales } from "../../../lib/queries/sales";
import { DashboardShell } from "../dashboard-shell";
import {
  DateFilter,
  ListingForm,
  SearchControl,
  SelectFilter,
} from "../listing-controls";
import { ListingPagination } from "../listing-pagination";
import { ListingTable, TableCell } from "../listing-table";

type SalesPageProps = {
  searchParams: Promise<DashboardSearchParams>;
};

async function SalesListing({ searchParams }: SalesPageProps) {
  await connection();
  const session = await getAuthenticatedSession();
  const params = await searchParams;
  const parsed = parseListSearchParams(saleListInputSchema, params, [
    "from",
    "to",
  ]);

  if (!parsed.success) {
    return (
      <DashboardShell session={session} activePath="/dashboard/sales">
        <Heading />
        <InvalidParams message={parsed.message} />
        <SalesFilters params={params} />
      </DashboardShell>
    );
  }

  const input = parsed.data;
  const result = await listSales(input);

  return (
    <DashboardShell session={session} activePath="/dashboard/sales">
      <Heading />
      <SalesFilters
        params={{
          search: input.search,
          customerId: input.customerId,
          status: input.status,
          from: input.from?.slice(0, 10),
          to: input.to?.slice(0, 10),
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
          pageSize: String(input.pageSize),
        }}
      />
      <ListingTable
        caption="Resultados de ventas"
        columns={[
          { label: "Fecha" },
          { label: "Cliente" },
          { label: "Correo electrónico" },
          { label: "Estado" },
          { label: "Total", numeric: true },
        ]}
        empty={result.items.length === 0}
      >
        {result.items.map((sale) => (
          <tr className="hover:bg-slate-900/50" key={sale.id}>
            <TableCell mono>
              {new Date(sale.saleDate).toLocaleString("es")}
            </TableCell>
            <TableCell>{sale.customer.name}</TableCell>
            <TableCell>{sale.customer.email}</TableCell>
            <TableCell>{sale.status}</TableCell>
            <TableCell mono numeric>
              {sale.total}
            </TableCell>
          </tr>
        ))}
      </ListingTable>
      <ListingPagination
        page={input.page}
        pageSize={input.pageSize}
        pathname="/dashboard/sales"
        total={result.total}
        totalPages={result.totalPages}
        values={{
          search: input.search,
          customerId: input.customerId,
          status: input.status,
          from: input.from,
          to: input.to,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
        }}
      />
    </DashboardShell>
  );
}

function SalesFilters({
  params,
}: {
  params: DashboardSearchParams;
}) {
  return (
    <ListingForm action="/dashboard/sales">
      <SearchControl defaultValue={stringValue(params.search)} />
      <label className="block text-xs font-medium text-slate-400">
        Cliente (ID)
        <input
          className="mt-1 min-h-10 w-full rounded-md border border-slate-700 bg-[#0b1117] px-3 text-sm text-slate-100 outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/40"
          defaultValue={stringValue(params.customerId)}
          name="customerId"
          placeholder="UUID del cliente"
          type="text"
        />
      </label>
      <SelectFilter
        defaultValue={stringValue(params.status)}
        label="Estado"
        name="status"
        options={[
          { value: "", label: "Todos" },
          { value: "PENDING", label: "Pendiente" },
          { value: "COMPLETED", label: "Completada" },
          { value: "CANCELLED", label: "Cancelada" },
          { value: "REFUNDED", label: "Reembolsada" },
        ]}
      />
      <DateFilter
        defaultValue={dateValue(params.from)}
        label="Desde (UTC)"
        name="from"
      />
      <DateFilter
        defaultValue={dateValue(params.to)}
        label="Hasta (UTC)"
        name="to"
      />
      <SelectFilter
        defaultValue={stringValue(params.sortBy, "saleDate")}
        label="Ordenar por"
        name="sortBy"
        options={[
          { value: "saleDate", label: "Fecha de venta" },
          { value: "total", label: "Total" },
          { value: "createdAt", label: "Fecha de registro" },
        ]}
      />
      <SelectFilter
        defaultValue={stringValue(params.sortOrder, "desc")}
        label="Dirección"
        name="sortOrder"
        options={[
          { value: "desc", label: "Descendente" },
          { value: "asc", label: "Ascendente" },
        ]}
      />
      <SelectFilter
        defaultValue={stringValue(params.pageSize, "20")}
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
    <header className="mb-6 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
        Transacciones
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-100">
        Ventas
      </h1>
      <p className="text-sm text-slate-400">
        Filtra ventas y revisa el cliente y total registrados.
      </p>
    </header>
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
        href="/dashboard/sales"
      >
        Restablecer filtros
      </Link>
    </div>
  );
}

function stringValue(value: string | string[] | undefined, fallback = ""): string {
  return value === undefined || Array.isArray(value) ? fallback : value;
}

function dateValue(value: string | string[] | undefined): string {
  return stringValue(value).slice(0, 10);
}

export default function SalesPage({ searchParams }: SalesPageProps) {
  return (
    <Suspense fallback={<p className="p-8 text-slate-400">Cargando ventas...</p>}>
      <SalesListing searchParams={searchParams} />
    </Suspense>
  );
}
