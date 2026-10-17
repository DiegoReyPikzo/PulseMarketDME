import type { ReactNode } from "react";

export type TableColumn = {
  label: string;
  numeric?: boolean;
};

export function ListingTable({
  caption,
  columns,
  children,
  empty,
}: {
  caption: string;
  columns: readonly TableColumn[];
  children: ReactNode;
  empty: boolean;
}) {
  return (
    <div className="dashboard-listing__table-scroll min-w-0 max-w-full overflow-x-auto rounded-xl">
      <table className="dashboard-listing__table w-full min-w-[680px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs uppercase tracking-wide">
          <tr>
            {columns.map((column) => (
              <th
                className={`px-4 py-3 font-medium ${column.numeric ? "text-right tabular-nums" : ""}`}
                key={column.label}
                scope="col"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {empty ? (
            <tr>
              <td
                className="dashboard-listing__empty px-4 py-12 text-center"
                colSpan={columns.length}
              >
                No se encontraron resultados con estos criterios.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function TableCell({
  children,
  numeric = false,
  mono = false,
}: {
  children: ReactNode;
  numeric?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`dashboard-listing__cell px-4 py-3.5 ${numeric ? "text-right tabular-nums" : ""} ${mono ? "font-mono text-xs" : ""}`}
    >
      {children}
    </td>
  );
}
