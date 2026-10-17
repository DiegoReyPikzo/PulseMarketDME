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
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0e151d]">
      <table className="w-full min-w-[680px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
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
        <tbody className="divide-y divide-slate-800">
          {empty ? (
            <tr>
              <td
                className="px-4 py-12 text-center text-slate-400"
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
      className={`px-4 py-3.5 text-slate-200 ${numeric ? "text-right tabular-nums" : ""} ${mono ? "font-mono text-xs" : ""}`}
    >
      {children}
    </td>
  );
}
