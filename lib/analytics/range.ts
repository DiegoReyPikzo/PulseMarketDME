import { z } from "zod";

const millisecondsPerDay = 86_400_000;

const dateRangeSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .strict()
  .superRefine((range, context) => {
    const fromTime = Date.parse(`${range.from}T00:00:00.000Z`);
    const toTime = Date.parse(`${range.to}T00:00:00.000Z`);

    if (fromTime > toTime) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "La fecha inicial debe ser anterior o igual a la fecha final.",
      });
      return;
    }

    const inclusiveDays = (toTime - fromTime) / millisecondsPerDay + 1;
    if (inclusiveDays > 366) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "El período no puede superar 366 días.",
      });
    }
  });

export type DashboardAnalyticsRange = z.infer<typeof dateRangeSchema>;

export type DailyAnalyticsPoint = {
  date: string;
  amount: string;
  salesCount: number;
};

type DailyAggregateRow = {
  day: string;
  amount: string;
  salesCount: number;
};

export type AnalyticsRangeResult =
  | { success: true; data: DashboardAnalyticsRange }
  | { success: false; message: string };

export function parseDashboardAnalyticsRange(
  input: unknown,
  now = new Date(),
): AnalyticsRangeResult {
  const today = now.toISOString().slice(0, 10);
  const defaults = {
    from: new Date(Date.parse(`${today}T00:00:00.000Z`) - 29 * millisecondsPerDay)
      .toISOString()
      .slice(0, 10),
    to: today,
  };

  if (input !== undefined && !isRecord(input)) {
    return {
      success: false,
      message: "Los parámetros del período deben ser fechas válidas.",
    };
  }
  const supplied = input === undefined ? {} : input;

  const parsed = dateRangeSchema.safeParse({
    ...supplied,
    from: supplied.from ?? defaults.from,
    to: supplied.to ?? defaults.to,
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues.map((issue) => issue.message).join(" "),
    };
  }

  return { success: true, data: parsed.data };
}

export function getUtcRangeBounds(range: DashboardAnalyticsRange): {
  startInclusive: Date;
  endExclusive: Date;
} {
  return {
    startInclusive: new Date(`${range.from}T00:00:00.000Z`),
    endExclusive: new Date(
      Date.parse(`${range.to}T00:00:00.000Z`) + millisecondsPerDay,
    ),
  };
}

export function createDailySeries(
  range: DashboardAnalyticsRange,
  rows: readonly DailyAggregateRow[],
): DailyAnalyticsPoint[] {
  const byDate = new Map(rows.map((row) => [row.day, row]));
  const points: DailyAnalyticsPoint[] = [];
  const firstDay = Date.parse(`${range.from}T00:00:00.000Z`);
  const lastDay = Date.parse(`${range.to}T00:00:00.000Z`);

  for (
    let dayTime = firstDay;
    dayTime <= lastDay;
    dayTime += millisecondsPerDay
  ) {
    const date = new Date(dayTime).toISOString().slice(0, 10);
    const row = byDate.get(date);
    points.push({
      date,
      amount: row?.amount ?? "0.00",
      salesCount: row?.salesCount ?? 0,
    });
  }

  return points;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
