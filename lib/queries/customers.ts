import "server-only";

import {
  customerListInputSchema,
  type CustomerListInput,
} from "./inputs";
import { buildCustomerOrderBy, buildCustomerWhere } from "./builders";
import {
  pageResult,
  paginationArgs,
  type PageResult,
} from "./pagination";
import { prisma } from "../prisma";
import { customerListSelect } from "./selects";
import { serializeCustomer } from "./serializers";

export async function listCustomers(
  input: unknown = {},
): Promise<PageResult<ReturnType<typeof serializeCustomer>>> {
  const parsed: CustomerListInput = customerListInputSchema.parse(input);
  const where = buildCustomerWhere(parsed);
  const pagination = paginationArgs(parsed);
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: customerListSelect,
      orderBy: buildCustomerOrderBy(parsed),
      ...pagination,
    }),
    prisma.customer.count({ where }),
  ]);

  return pageResult(rows.map(serializeCustomer), total, parsed);
}
