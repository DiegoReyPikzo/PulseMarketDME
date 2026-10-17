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
    <section
      aria-label="Analítica del período"
      className="dashboard-analytics space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="dashboard-summary__meta text-sm">
            Actualización automática cada 60 segundos mientras esta pestaña esté
            visible.
          </p>
          <p className="dashboard-summary__subtle mt-1 text-xs">
            Última consulta exitosa:{" "}
            <time dateTime={data.queriedAt}>
              {formatLastQueryTime(data.queriedAt, browserTimeZone).text}
            </time>
            {" · Zona horaria: "}
            {formatLastQueryTime(data.queriedAt, browserTimeZone).timeZoneLabel}
          </p>
        </div>
        <button
          className="dashboard-summary__secondary-button min-h-10 rounded-md px-4 text-sm font-medium disabled:opacity-50"
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
          className="dashboard-summary__error rounded-lg p-3 text-sm"
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
          series="amount"
          points={data.daily.map((point) => ({
            date: point.date,
            value: point.amount,
            exactLabel: point.amount,
          }))}
        />
        <DailySvgChart
          title="Ventas completadas por día"
          series="count"
          points={data.daily.map((point) => ({
            date: point.date,
            value: String(point.salesCount),
            exactLabel: String(point.salesCount),
          }))}
        />
      </div>

      <div className="dashboard-summary__table-scroll overflow-x-auto rounded-xl">
        <table className="dashboard-summary__table w-full min-w-[480px] text-left text-sm">
          <caption className="dashboard-summary__table-caption px-4 py-3 text-left font-medium">
            Tendencia diaria exacta (UTC)
          </caption>
          <thead className="text-xs uppercase tracking-wide">
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
          <tbody className="divide-y">
            {data.daily.map((point) => (
              <tr key={point.date}>
                <td className="px-4 py-3">{point.date}</td>
                <td className="dashboard-summary__table-numeric px-4 py-3 text-right font-mono tabular-nums">
                  {point.amount}
                </td>
                <td className="dashboard-summary__table-numeric px-4 py-3 text-right tabular-nums">
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
    <article className="dashboard-summary__metric rounded-xl p-5">
      <h2 className="dashboard-summary__metric-label text-sm font-medium">{label}</h2>
      <p className="dashboard-summary__value mt-3 break-all font-mono text-2xl font-semibold tabular-nums">
        {value}
      </p>
      <p className="dashboard-summary__detail mt-2 text-xs">{detail}</p>
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
  series,
}: {
  title: string;
  points: readonly ChartPoint[];
  series: "amount" | "count";
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
    <figure className="dashboard-summary__chart min-w-0 rounded-xl p-4">
      <figcaption className="dashboard-summary__chart-title mb-3 font-medium">
        {title}
      </figcaption>
      <svg
        aria-label={`${title}. ${chartDescription}`}
        className="h-auto w-full"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{title}</title>
        <desc>{chartDescription}</desc>
        <line
          stroke="var(--deco-border)"
          strokeWidth="1"
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
        />
        {coordinates.length > 1 ? (
          <path
            d={path}
            fill="none"
            stroke={series === "amount" ? "var(--deco-accent)" : "var(--deco-text-muted)"}
            strokeDasharray={series === "count" ? "8 5" : undefined}
            strokeWidth="3"
          />
        ) : null}
        {coordinates.map(({ x, y }, index) => {
          const titleText = formatChartPointTitle(
            points[index].date,
            points[index].exactLabel,
          );
          const fill =
            series === "amount" ? "var(--deco-accent)" : "var(--deco-text-muted)";

          return series === "amount" ? (
            <circle cx={x} cy={y} fill={fill} key={points[index].date} r="4">
              <title>{titleText}</title>
            </circle>
          ) : (
            <rect
              fill={fill}
              height="8"
              key={points[index].date}
              width="8"
              x={x - 4}
              y={y - 4}
            >
              <title>{titleText}</title>
            </rect>
          );
        })}
        {points.length > 0 ? (
          <>
            <text
              fill="var(--deco-text-muted)"
              fontSize="12"
              x={padding}
              y={height - 5}
            >
              {points[0].date}
            </text>
            <text
              fill="var(--deco-text-muted)"
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
