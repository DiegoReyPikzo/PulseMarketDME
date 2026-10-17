import Link from "next/link";

import { buildListHref } from "../../lib/dashboard/list-params";

export function ListingPagination({
  pathname,
  values,
  page,
  pageSize,
  total,
  totalPages,
}: {
  pathname: string;
  values: Record<string, string | number | undefined>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}) {
  const previousHref = buildListHref(pathname, {
    ...values,
    page: page - 1,
    pageSize,
  });
  const nextHref = buildListHref(pathname, {
    ...values,
    page: page + 1,
    pageSize,
  });

  return (
    <nav
      aria-label="Paginación"
      className="flex flex-wrap items-center justify-between gap-4 text-sm"
    >
      <p aria-live="polite" className="text-slate-400">
        Página <span className="font-medium text-slate-100">{page}</span>
        {totalPages > 0 ? ` de ${totalPages}` : ""} ·{" "}
        <span className="font-medium text-slate-100">{total}</span> coincidencias
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            className="rounded-md border border-slate-700 px-3 py-2 text-slate-200 hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-400"
            href={previousHref}
            rel="prev"
          >
            Anterior
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="cursor-not-allowed rounded-md border border-slate-800 px-3 py-2 text-slate-600"
          >
            Anterior
          </span>
        )}
        {page < totalPages ? (
          <Link
            className="rounded-md border border-slate-700 px-3 py-2 text-slate-200 hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-400"
            href={nextHref}
            rel="next"
          >
            Siguiente
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="cursor-not-allowed rounded-md border border-slate-800 px-3 py-2 text-slate-600"
          >
            Siguiente
          </span>
        )}
      </div>
    </nav>
  );
}
