"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import type { DashboardAnalytics } from "../../lib/analytics/dashboard";
import { formatChartPointTitle } from "../../lib/analytics/chart-title";
import { formatLastQueryTime } from "../../lib/analytics/last-query-time";
import { shouldRefreshAnalytics } from "../../lib/analytics/refresh-policy";
import { refreshDashboardAnalytics } from "./analytics-actions";

function subscribeToTimeZoneChanges(): () => void {
  return () => {};
}

function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getServerTimeZone(): null {
  return null;
}

export function DashboardAnalyticsClient({
  initialData,
}: {
  initialData: DashboardAnalytics;
}) {
  const [data, setData] = useState(initialData);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [pending, startTransition] = useTransition();
  const browserTimeZone = useSyncExternalStore(
    subscribeToTimeZoneChanges,
    getBrowserTimeZone,
    getServerTimeZone,
  );
  const requestInFlight = useRef(false);

  const refresh = useCallback(() => {
    if (
      !shouldRefreshAnalytics(document.visibilityState, requestInFlight.current)
    ) {
      return;
    }

    requestInFlight.current = true;
    setUpdating(true);
    startTransition(async () => {
      try {
        const result = await refreshDashboardAnalytics(data.from, data.to);
        if (result.success) {
          setData(result.data);
          setStaleMessage(null);
        } else {
          setStaleMessage(result.message);
        }
      } catch {
        setStaleMessage(
          "No se pudieron actualizar las métricas. Los datos mostrados pueden estar desactualizados.",
        );
      } finally {
        requestInFlight.current = false;
        setUpdating(false);
      }
    });
  }, [data.from, data.to]);

  useEffect(() => {
    const intervalId = window.setInterval(refresh, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  const isRefreshing = updating || pending;

  return (
    <section aria-label="Analítica del período" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">
            Actualización automática cada 60 segundos mientras esta pestaña esté
            visible.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Última consulta exitosa:{" "}
            <time dateTime={data.queriedAt}>
              {formatLastQueryTime(data.queriedAt, browserTimeZone).text}
            </time>
            {" · Zona horaria: "}
            {formatLastQueryTime(data.queriedAt, browserTimeZone).timeZoneLabel}
          </p>
        </div>
        <button
          className="min-h-10 rounded-md border border-slate-700 px-4 text-sm font-medium text-slate-200 hover:border-cyan-400 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:opacity-50"
          disabled={isRefreshing}
          onClick={refresh}
          type="button"
        >
          {isRefreshing ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {staleMessage ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200"
          role="alert"
        >
          {staleMessage} Se conserva la última consulta exitosa.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Importe de ventas completadas"
          value={data.completedSalesAmount}
          detail="Período seleccionado · SaleDate UTC"
        />
        <MetricCard
          label="Ventas completadas"
          value={String(data.completedSalesCount)}
          detail="Período seleccionado"
        />
        <MetricCard
          label="Ticket promedio"
          value={data.averageTicket ?? "Sin ventas"}
          detail="Ventas completadas del período"
        />
        <MetricCard
          label="Productos activos"
          value={String(data.activeProductsCount)}
          detail="Conteo actual · no depende del período"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <DailySvgChart
          title="Importe diario"
          points={data.daily.map((point) => ({
            date: point.date,
            value: point.amount,
            exactLabel: point.amount,
          }))}
        />
        <DailySvgChart
          title="Ventas completadas por día"
          points={data.daily.map((point) => ({
            date: point.date,
            value: String(point.salesCount),
            exactLabel: String(point.salesCount),
          }))}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0e151d]">
        <table className="w-full min-w-[480px] text-left text-sm">
          <caption className="px-4 py-3 text-left font-medium text-slate-200">
            Tendencia diaria exacta (UTC)
          </caption>
          <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium" scope="col">Fecha (UTC)</th>
              <th className="px-4 py-3 text-right font-medium" scope="col">
                Importe
              </th>
              <th className="px-4 py-3 text-right font-medium" scope="col">
                Ventas
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {data.daily.map((point) => (
              <tr key={point.date}>
                <td className="px-4 py-3 text-slate-300">{point.date}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                  {point.amount}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-200">
                  {point.salesCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-xl border border-slate-800 bg-[#0e151d] p-5">
      <h2 className="text-sm font-medium text-slate-400">{label}</h2>
      <p className="mt-3 break-all font-mono text-2xl font-semibold tabular-nums text-slate-100">
        {value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

type ChartPoint = {
  date: string;
  value: string;
  exactLabel: string;
};

function DailySvgChart({
  title,
  points,
}: {
  title: string;
  points: readonly ChartPoint[];
}) {
  const width = 800;
  const height = 220;
  const padding = 28;
  const drawableWidth = width - 2 * padding;
  const drawableHeight = height - 2 * padding;
  // Numeric conversion is used only to place SVG points, never for business totals.
  const plottedValues = points.map(({ value }) => Number(value));
  const maximum = Math.max(0, ...plottedValues);
  const coordinates = plottedValues.map((value, index) => {
    const x =
      points.length <= 1
        ? width / 2
        : padding + (index / (points.length - 1)) * drawableWidth;
    const y =
      height -
      padding -
      (maximum === 0 ? 0 : (value / maximum) * drawableHeight);
    return { x, y };
  });
  const path = coordinates
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
  const chartDescription =
    points.length === 0
      ? "No hay fechas en el período."
      : `${points.length} días entre ${points[0].date} y ${points[points.length - 1].date}.`;

  return (
    <figure className="min-w-0 rounded-xl border border-slate-800 bg-[#0e151d] p-4">
      <figcaption className="mb-3 font-medium text-slate-200">{title}</figcaption>
      <svg
        aria-label={`${title}. ${chartDescription}`}
        className="h-auto w-full"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{title}</title>
        <desc>{chartDescription}</desc>
        <line
          stroke="#334155"
          strokeWidth="1"
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
        />
        {coordinates.length > 1 ? (
          <path d={path} fill="none" stroke="#22d3ee" strokeWidth="3" />
        ) : null}
        {coordinates.map(({ x, y }, index) => (
          <circle
            cx={x}
            cy={y}
            fill="#22d3ee"
            key={points[index].date}
            r="4"
          >
            <title>
              {formatChartPointTitle(
                points[index].date,
                points[index].exactLabel,
              )}
            </title>
          </circle>
        ))}
        {points.length > 0 ? (
          <>
            <text fill="#94a3b8" fontSize="12" x={padding} y={height - 5}>
              {points[0].date}
            </text>
            <text
              fill="#94a3b8"
              fontSize="12"
              textAnchor="end"
              x={width - padding}
              y={height - 5}
            >
              {points[points.length - 1].date}
            </text>
          </>
        ) : null}
      </svg>
    </figure>
  );
}
