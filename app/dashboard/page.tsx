import { connection } from "next/server";
import { Suspense } from "react";

import { getDashboardAnalytics } from "../../lib/analytics/dashboard";
import { parseDashboardAnalyticsRange } from "../../lib/analytics/range";
import { getAuthenticatedSession } from "../../lib/auth-session";
import type { DashboardSearchParams } from "../../lib/dashboard/list-params";
import { DashboardShell } from "./dashboard-shell";
import { SummaryFallback } from "../components/loading/data-fallbacks";
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
          className="dashboard-summary__error mt-4 rounded-lg p-4 text-sm"
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
      <div className="dashboard-summary__rule my-6 border-t" />
      <div className="dashboard-summary__analytics">
        <DashboardAnalyticsClient initialData={analytics} />
      </div>
      <p className="dashboard-summary__subtle mt-6 text-xs leading-5">
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
    <header className="dashboard-summary__intro mb-6 space-y-2">
    <p className="dashboard-summary__eyebrow text-xs font-semibold uppercase">
        Analítica
      </p>
    <h1 className="dashboard-summary__title text-3xl tracking-tight">
        Resumen
      </h1>
    <p className="dashboard-summary__copy text-sm">
        Ventas completadas y estado actual del catálogo.
      </p>
    </header>
  );
}

function DateRangeForm({ from, to }: { from: string; to: string }) {
  return (
    <form
      action="/dashboard"
      className="dashboard-summary__filters flex flex-col gap-4 rounded-xl p-4 sm:flex-row sm:items-end"
      method="get"
    >
      <label className="block text-xs font-medium text-slate-400">
        Desde (UTC)
        <input
          className="mt-1 min-h-10 w-full rounded-md border px-3 text-sm"
          defaultValue={from}
          name="from"
          required
          type="date"
        />
      </label>
      <label className="block text-xs font-medium text-slate-400">
        Hasta (UTC, inclusive)
        <input
          className="mt-1 min-h-10 w-full rounded-md border px-3 text-sm"
          defaultValue={to}
          name="to"
          required
          type="date"
        />
      </label>
      <button
        className="dashboard-summary__button min-h-10 rounded-md px-4 text-sm font-semibold"
        type="submit"
      >
        Aplicar período
      </button>
    </form>
  );
}

export default function DashboardPage({ searchParams }: DashboardPageProps) {
  return (
    <Suspense
      fallback={<SummaryFallback />}
    >
      <DashboardSummary searchParams={searchParams} />
    </Suspense>
  );
}
