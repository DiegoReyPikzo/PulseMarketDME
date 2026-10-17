import "server-only";

import { z } from "zod";

import { pageFields } from "./pagination";

const searchField = z.string().trim().min(1).max(120).optional();

export const productListInputSchema = z
  .object({
    ...pageFields,
    search: searchField,
    category: z.string().trim().min(1).max(100).optional(),
    sortBy: z.enum(["name", "sku", "price", "createdAt"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();

export const customerListInputSchema = z
  .object({
    ...pageFields,
    search: searchField,
    sortBy: z.enum(["name", "email", "createdAt"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();

const dateField = z.iso.datetime({ offset: true });

export const saleListInputSchema = z
  .object({
    ...pageFields,
    search: searchField,
    customerId: z.uuid().optional(),
    status: z.enum(["PENDING", "COMPLETED", "CANCELLED", "REFUNDED"]).optional(),
    from: dateField.optional(),
    to: dateField.optional(),
    sortBy: z.enum(["saleDate", "total", "createdAt"]).default("saleDate"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.from && input.to && Date.parse(input.from) > Date.parse(input.to)) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must be earlier than or equal to to.",
      });
    }
  });

export type ProductListInput = z.infer<typeof productListInputSchema>;
export type CustomerListInput = z.infer<typeof customerListInputSchema>;
export type SaleListInput = z.infer<typeof saleListInputSchema>;
