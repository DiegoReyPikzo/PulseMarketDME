import { connection } from "next/server";
import { Suspense } from "react";

import { getDashboardAnalytics } from "../../lib/analytics/dashboard";
import { parseDashboardAnalyticsRange } from "../../lib/analytics/range";
import { getAuthenticatedSession } from "../../lib/auth-session";
import type { DashboardSearchParams } from "../../lib/dashboard/list-params";
import { DashboardShell } from "./dashboard-shell";
import { DashboardAnalyticsClient } from "./analytics-client";

type DashboardPageProps = {
  searchParams: Promise<DashboardSearchParams>;
};

async function DashboardSummary({ searchParams }: DashboardPageProps) {
  await connection();
  const session = await getAuthenticatedSession();
  const params = await searchParams;
  const parsed = parseDashboardAnalyticsRange(params);

  if (!parsed.success) {
    const defaults = parseDashboardAnalyticsRange(undefined);
    if (!defaults.success) {
      throw new Error("No se pudieron calcular las fechas predeterminadas.");
    }

    return (
      <DashboardShell session={session} activePath="/dashboard">
        <SummaryHeading />
        <DateRangeForm from={defaults.data.from} to={defaults.data.to} />
        <p
          className="mt-4 rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-sm text-amber-200"
          role="alert"
        >
          Período inválido: {parsed.message}
        </p>
      </DashboardShell>
    );
  }

  const analytics = await getDashboardAnalytics(parsed.data);

  return (
    <DashboardShell session={session} activePath="/dashboard">
      <SummaryHeading />
      <DateRangeForm from={parsed.data.from} to={parsed.data.to} />
      <div className="my-6 border-t border-slate-800" />
      <DashboardAnalyticsClient initialData={analytics} />
      <p className="mt-6 text-xs leading-5 text-slate-500">
        Solo las ventas con estado COMPLETED cuentan en las métricas del
        período. Las ventas REFUNDED se excluyen por completo; este resumen no
        constituye contabilidad de movimientos de reembolso. Los productos
        activos son un conteo actual independiente del período. No se asigna
        moneda a los importes.
      </p>
    </DashboardShell>
  );
}

function SummaryHeading() {
  return (
    <header className="mb-6 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
        Analítica
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-100">
        Resumen
      </h1>
      <p className="text-sm text-slate-400">
        Ventas completadas y estado actual del catálogo.
      </p>
    </header>
  );
}

function DateRangeForm({ from, to }: { from: string; to: string }) {
  return (
    <form
      action="/dashboard"
      className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-[#0e151d] p-4 sm:flex-row sm:items-end"
      method="get"
    >
      <label className="block text-xs font-medium text-slate-400">
        Desde (UTC)
        <input
          className="mt-1 min-h-10 w-full rounded-md border border-slate-700 bg-[#0b1117] px-3 text-sm text-slate-100 outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/40"
          defaultValue={from}
          name="from"
          required
          type="date"
        />
      </label>
      <label className="block text-xs font-medium text-slate-400">
        Hasta (UTC, inclusive)
        <input
          className="mt-1 min-h-10 w-full rounded-md border border-slate-700 bg-[#0b1117] px-3 text-sm text-slate-100 outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/40"
          defaultValue={to}
          name="to"
          required
          type="date"
        />
      </label>
      <button
        className="min-h-10 rounded-md bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        type="submit"
      >
        Aplicar período
      </button>
    </form>
  );
}

export default function DashboardPage({ searchParams }: DashboardPageProps) {
  return (
    <Suspense fallback={<p className="p-8 text-slate-400">Cargando resumen...</p>}>
      <DashboardSummary searchParams={searchParams} />
    </Suspense>
  );
}
