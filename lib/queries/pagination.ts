import "server-only";

import { z } from "zod";

export const pageFields = {
  page: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(
      Math.floor(Number.MAX_SAFE_INTEGER / 100),
      "page is too large for safe offset pagination.",
    )
    .default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export type PageInput = {
  page: number;
  pageSize: number;
};

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function paginationArgs({ page, pageSize }: PageInput) {
  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function pageResult<T>(
  items: T[],
  total: number,
  { page, pageSize }: PageInput,
): PageResult<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
