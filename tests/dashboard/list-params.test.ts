import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildListHref,
  parseListSearchParams,
} from "../../lib/dashboard/list-params";
import {
  customerListInputSchema,
  productListInputSchema,
  saleListInputSchema,
} from "../../lib/queries/inputs";

test("parses omitted parameters using query defaults", () => {
  assert.deepEqual(
    parseListSearchParams(productListInputSchema, {}),
    {
      success: true,
      data: {
        page: 1,
        pageSize: 20,
        sortBy: "createdAt",
        sortOrder: "desc",
      },
    },
  );
});

test("accepts URL strings and converts page controls to numbers", () => {
  const result = parseListSearchParams(customerListInputSchema, {
    page: "3",
    pageSize: "50",
    search: "Ana",
    sortBy: "email",
    sortOrder: "asc",
  });

  assert.deepEqual(result, {
    success: true,
    data: {
      page: 3,
      pageSize: 50,
      search: "Ana",
      sortBy: "email",
      sortOrder: "asc",
    },
  });
});

test("rejects repeated URL parameters clearly", () => {
  const result = parseListSearchParams(productListInputSchema, {
    search: ["one", "two"],
  });

  assert.deepEqual(result, {
    success: false,
    message: 'El parámetro "search" debe aparecer una sola vez.',
  });
});

test("rejects unknown URL keys instead of silently accepting them", () => {
  const result = parseListSearchParams(productListInputSchema, {
    deletedAt: "true",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.message, /Unrecognized key/);
  }
});

test("rejects invalid page values without throwing a server error", () => {
  const result = parseListSearchParams(customerListInputSchema, {
    page: "0",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.message, /page/);
  }
});

test("rejects sort fields not allowed by the query schema", () => {
  const result = parseListSearchParams(productListInputSchema, {
    sortBy: "deletedAt",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.message, /sortBy/);
  }
});

test("rejects invalid explicit enum values in URL controls", () => {
  const result = parseListSearchParams(saleListInputSchema, {
    search: "",
    customerId: "",
    status: "UNKNOWN",
    from: "",
    to: "",
    pageSize: "20",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.message, /status/);
  }
});

test("normalizes empty optional inputs but still rejects invalid explicit enums", () => {
  const result = parseListSearchParams(saleListInputSchema, {
    search: "",
    customerId: "",
    status: "",
    from: "",
    to: "",
    pageSize: "20",
  });

  assert.deepEqual(result, {
    success: true,
    data: {
      page: 1,
      pageSize: 20,
      sortBy: "saleDate",
      sortOrder: "desc",
    },
  });
});

test("converts date-only sales filters to inclusive UTC ISO bounds", () => {
  const result = parseListSearchParams(
    saleListInputSchema,
    { from: "2026-06-01", to: "2026-06-30" },
    ["from", "to"],
  );

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.from, "2026-06-01T00:00:00.000Z");
    assert.equal(result.data.to, "2026-06-30T23:59:59.999Z");
  }
});

test("rejects reversed date-only ranges", () => {
  const result = parseListSearchParams(
    saleListInputSchema,
    { from: "2026-07-02", to: "2026-07-01" },
    ["from", "to"],
  );

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.message, /from/);
  }
});

test("rejects impossible calendar dates from date controls", () => {
  const result = parseListSearchParams(
    saleListInputSchema,
    { from: "2026-02-30" },
    ["from", "to"],
  );

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.message, /from/);
  }
});

test("builds list links while preserving filters and replacing the page", () => {
  assert.equal(
    buildListHref("/dashboard/sales", {
      search: "ana & luz",
      status: "COMPLETED",
      from: "2026-01-01T00:00:00.000Z",
      pageSize: 50,
      page: 2,
    }),
    "/dashboard/sales?search=ana+%26+luz&status=COMPLETED&from=2026-01-01T00%3A00%3A00.000Z&pageSize=50&page=2",
  );
});

test("omits blank filters when constructing query URLs", () => {
  assert.equal(
    buildListHref("/dashboard/products", {
      search: "",
      category: undefined,
      pageSize: 20,
      page: 1,
    }),
    "/dashboard/products?pageSize=20&page=1",
  );
});
