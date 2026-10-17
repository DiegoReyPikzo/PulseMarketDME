import "server-only";

import { ZodError, type ZodType } from "zod";

export type DashboardSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type ListParamsResult<T> =
  | { success: true; data: T }
  | { success: false; message: string };

export function parseListSearchParams<T>(
  schema: ZodType<T>,
  searchParams: DashboardSearchParams,
  dateFields: readonly string[] = [],
): ListParamsResult<T> {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value !== "string") {
      return {
        success: false,
        message: `El parámetro "${key}" debe aparecer una sola vez.`,
      };
    }

    if (value !== "") {
      values[key] = value;
    }
  }

  for (const field of dateFields) {
    const value = values[field];

    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = new Date(`${value}T00:00:00.000Z`);

      if (
        !Number.isNaN(date.valueOf()) &&
        date.toISOString().slice(0, 10) === value
      ) {
        if (field.endsWith("To") || field === "to") {
          date.setUTCHours(23, 59, 59, 999);
        }
        values[field] = date.toISOString();
      }
    }
  }

  try {
    return { success: true, data: schema.parse(values) };
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return {
        success: false,
        message: error.issues
          .map((issue) => {
            const field = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
            return `${field}${issue.message}`;
          })
          .join(" "),
      };
    }

    throw error;
  }
}

export function buildListHref(
  pathname: string,
  values: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function searchParamValue(
  searchParams: DashboardSearchParams,
  key: string,
  fallback = "",
): string {
  const value = searchParams[key];
  return typeof value === "string" ? value : fallback;
}
