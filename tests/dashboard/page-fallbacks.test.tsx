import assert from "node:assert/strict";
import { isValidElement, Suspense, type ReactElement } from "react";
import { test, vi } from "vitest";

// The pages are imported, never rendered: only the Suspense element they return
// is inspected. "server-only" is neutralized so their server modules can load
// in this client test environment, and Prisma is replaced so importing them
// cannot open a database connection.
vi.mock("server-only", () => ({}));
vi.mock("../../lib/prisma", () => ({ prisma: {} }));

import {
  CustomersFallback,
  ProductsFallback,
  SalesFallback,
  SummaryFallback,
} from "../../app/components/loading/data-fallbacks";
import CustomersPage from "../../app/dashboard/customers/page";
import DashboardPage from "../../app/dashboard/page";
import ProductsPage from "../../app/dashboard/products/page";
import SalesPage from "../../app/dashboard/sales/page";

// The pages return their Suspense boundary synchronously; the data component
// inside it is never rendered by these tests.
const searchParams = new Promise<never>(() => {});

for (const [name, element, Fallback] of [
  ["Resumen", DashboardPage({ searchParams }), SummaryFallback],
  ["Productos", ProductsPage({ searchParams }), ProductsFallback],
  ["Clientes", CustomersPage({ searchParams }), CustomersFallback],
  ["Ventas", SalesPage({ searchParams }), SalesFallback],
] as const) {
  test(`${name} page uses its data fallback in the Suspense boundary`, () => {
    assert.ok(isValidElement(element));
    const boundary = element as ReactElement<{ fallback: unknown; children: unknown }>;
    assert.equal(boundary.type, Suspense);
    // No key forces a remount: the boundary keeps React's default behavior.
    assert.equal(boundary.key, null);
    const fallback = boundary.props.fallback;
    assert.ok(isValidElement(fallback));
    assert.equal(fallback.type, Fallback);
  });
}
