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
      className="dashboard-listing__pagination flex flex-wrap items-center justify-between gap-4 text-sm"
    >
      <p aria-live="polite" className="dashboard-listing__pagination-copy">
        Página <span className="font-medium">{page}</span>
        {totalPages > 0 ? ` de ${totalPages}` : ""} ·{" "}
        <span className="font-medium">{total}</span> coincidencias
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            className="dashboard-listing__page-link rounded-md border px-3 py-2"
            href={previousHref}
            rel="prev"
          >
            Anterior
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="dashboard-listing__page-link dashboard-listing__page-link--disabled cursor-not-allowed rounded-md border px-3 py-2"
          >
            Anterior
          </span>
        )}
        {page < totalPages ? (
          <Link
            className="dashboard-listing__page-link rounded-md border px-3 py-2"
            href={nextHref}
            rel="next"
          >
            Siguiente
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="dashboard-listing__page-link dashboard-listing__page-link--disabled cursor-not-allowed rounded-md border px-3 py-2"
          >
            Siguiente
          </span>
        )}
      </div>
    </nav>
  );
}
