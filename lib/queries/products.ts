import "server-only";

import {
  productListInputSchema,
  type ProductListInput,
} from "./inputs";
import { buildProductOrderBy, buildProductWhere } from "./builders";
import {
  pageResult,
  paginationArgs,
  type PageResult,
} from "./pagination";
import { prisma } from "../prisma";
import { productListSelect } from "./selects";
import { serializeProduct } from "./serializers";

export async function listProducts(
  input: unknown = {},
): Promise<PageResult<ReturnType<typeof serializeProduct>>> {
  const parsed: ProductListInput = productListInputSchema.parse(input);
  const where = buildProductWhere(parsed);
  const pagination = paginationArgs(parsed);
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: productListSelect,
      orderBy: buildProductOrderBy(parsed),
      ...pagination,
    }),
    prisma.product.count({ where }),
  ]);

  return pageResult(rows.map(serializeProduct), total, parsed);
}
