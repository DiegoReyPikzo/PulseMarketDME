"use client";

import Link from "next/link";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6 sm:p-10"
      role="alert"
    >
      <h1 className="text-xl font-semibold text-slate-100">
        No se pudieron cargar los datos
      </h1>
      <p className="text-sm text-slate-400">
        Ocurrió un problema al consultar la información. Puedes volver a
        intentarlo o regresar a los productos.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-md bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-300"
          onClick={reset}
          type="button"
        >
          Reintentar
        </button>
        <Link
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-400"
          href="/dashboard/products"
        >
          Ir a productos
        </Link>
      </div>
    </main>
  );
}
