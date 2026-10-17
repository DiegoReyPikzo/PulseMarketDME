"use server";

import { getAuthenticatedSession } from "../../lib/auth-session";
import { getDashboardAnalytics } from "../../lib/analytics/dashboard";
import { parseDashboardAnalyticsRange } from "../../lib/analytics/range";

export type AnalyticsRefreshResult =
  | { success: true; data: Awaited<ReturnType<typeof getDashboardAnalytics>> }
  | { success: false; message: string };

export async function refreshDashboardAnalytics(
  from: string,
  to: string,
): Promise<AnalyticsRefreshResult> {
  await getAuthenticatedSession();

  const parsed = parseDashboardAnalyticsRange({ from, to });
  if (!parsed.success) {
    return parsed;
  }

  try {
    return {
      success: true,
      data: await getDashboardAnalytics(parsed.data),
    };
  } catch (error: unknown) {
    console.error("Dashboard analytics refresh failed.", error);
    return {
      success: false,
      message: "No se pudieron actualizar las métricas. Los datos mostrados pueden estar desactualizados.",
    };
  }
}
