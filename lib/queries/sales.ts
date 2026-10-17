import "server-only";

import { saleListInputSchema, type SaleListInput } from "./inputs";
import { buildSaleOrderBy, buildSaleWhere } from "./builders";
import {
  pageResult,
  paginationArgs,
  type PageResult,
} from "./pagination";
import { prisma } from "../prisma";
import { saleListSelect } from "./selects";
import { serializeSale } from "./serializers";

export async function listSales(
  input: unknown = {},
): Promise<PageResult<ReturnType<typeof serializeSale>>> {
  const parsed: SaleListInput = saleListInputSchema.parse(input);
  const where = buildSaleWhere(parsed);
  const pagination = paginationArgs(parsed);
  const [rows, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      select: saleListSelect,
      orderBy: buildSaleOrderBy(parsed),
      ...pagination,
    }),
    prisma.sale.count({ where }),
  ]);

  return pageResult(rows.map(serializeSale), total, parsed);
}
