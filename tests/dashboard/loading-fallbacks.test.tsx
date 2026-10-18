import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, test } from "vitest";

import {
  CustomersFallback,
  ProductsFallback,
  SalesFallback,
  SummaryFallback,
} from "../../app/components/loading/data-fallbacks";

afterEach(() => {
  cleanup();
});

const FOCUSABLE = "a, button, input, select, textarea, [tabindex]";

function assertDecorativeSkeleton(skeleton: HTMLElement) {
  assert.equal(skeleton.getAttribute("aria-hidden"), "true");
  assert.equal(skeleton.querySelectorAll(FOCUSABLE).length, 0);
  const bones = [...skeleton.querySelectorAll<HTMLElement>(".motion-safe\\:animate-pulse")];
  assert.ok(bones.length > 0);
  // Pulsing is opt-in for users who allow motion; nothing animates unconditionally.
  assert.equal(skeleton.querySelectorAll('[class~="animate-pulse"]').length, 0);
}

function assertDashboardBackdrop(container: HTMLElement) {
  assert.ok((container.firstElementChild as HTMLElement).classList.contains("dashboard-shell"));
}

function assertAnnouncedPiggybank(message: string) {
  const status = screen.getByRole("status");
  assert.equal(status.getAttribute("aria-busy"), "true");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.ok(within(status).getByText(message));
  // The compact variant is used inside data fallbacks.
  assert.ok(status.classList.contains("deco-loader--section"));
  // The skeleton is not part of the announced region.
  assert.equal(status.querySelector("[data-skeleton]"), null);
}

for (const [name, Fallback, message, shape] of [
  ["Productos", ProductsFallback, "Preparando tu catálogo...", { creationFields: 6, filters: 5, columns: 7 }],
  ["Clientes", CustomersFallback, "Preparando tus clientes...", { creationFields: 3, filters: 4, columns: 5 }],
  ["Ventas", SalesFallback, "Preparando tus ventas...", { creationFields: 0, filters: 8, columns: 5 }],
] as const) {
  test(`${name} fallback shows the announced piggybank and a decorative listing skeleton`, () => {
    const { container } = render(<Fallback />);
    assertAnnouncedPiggybank(message);
    assertDashboardBackdrop(container);

    const skeleton = container.querySelector<HTMLElement>('[data-skeleton="listing"]');
    assert.ok(skeleton);
    assertDecorativeSkeleton(skeleton);

    const creation = skeleton.querySelector('[data-skeleton-part="creation-form"]');
    if (shape.creationFields === 0) {
      assert.equal(creation, null);
    } else {
      assert.ok(creation);
      assert.equal(creation.querySelectorAll(".space-y-2").length, shape.creationFields);
    }
    const filters = skeleton.querySelector('[data-skeleton-part="filters"]');
    assert.ok(filters);
    assert.equal(filters.querySelectorAll(".space-y-2").length, shape.filters);
    const rows = skeleton.querySelectorAll<HTMLElement>('[data-skeleton-part="row"]');
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.children.length, shape.columns);
      // Columns share the available width, so narrow screens do not overflow.
      assert.equal(row.style.gridTemplateColumns, `repeat(${shape.columns}, minmax(0, 1fr))`);
    }
  });
}

test("Resumen fallback shows the announced piggybank and a decorative summary skeleton", () => {
  const { container } = render(<SummaryFallback />);
  assertAnnouncedPiggybank("Preparando tu resumen...");
  assertDashboardBackdrop(container);

  const skeleton = container.querySelector<HTMLElement>('[data-skeleton="summary"]');
  assert.ok(skeleton);
  assertDecorativeSkeleton(skeleton);
  assert.ok(skeleton.querySelector('[data-skeleton-part="period"]'));
  assert.equal(skeleton.querySelectorAll('[data-skeleton-part="metric"]').length, 4);
  assert.equal(skeleton.querySelectorAll('[data-skeleton-part="chart"]').length, 2);
  assert.ok(skeleton.querySelector('[data-skeleton-part="table"]'));
  assert.equal(container.querySelector('[data-skeleton="listing"]'), null);
});
