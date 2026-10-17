import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Pool } from "pg";

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): item is string => typeof item === "string")
  );
}

function readFixtureSkus(): [string, string, string] {
  const encoded = process.env.PULSEMARKET_E2E_PRODUCT_SKUS;
  if (!encoded) throw new Error("E2E product fixture identifiers are missing.");
  const parsed: unknown = JSON.parse(encoded);
  if (
    !isStringArray(parsed) ||
    parsed.length !== 3 ||
    !parsed.every((sku) =>
      /^PME2E-[a-f0-9]{32}-DRAG-[123]$/.test(sku),
    )
  ) {
    throw new Error("E2E product fixture identifiers are invalid.");
  }
  return [parsed[0], parsed[1], parsed[2]];
}

function readFixtureRegistryPath(): string {
  const configuredPath = process.env.PULSEMARKET_E2E_PRODUCT_REGISTRY;
  if (!configuredPath) {
    throw new Error("E2E product fixture registry is not configured.");
  }
  const registryPath = resolve(configuredPath);
  const outputDirectory = resolve(".playwright-e2e");
  const relativePath = relative(outputDirectory, registryPath);
  if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
    throw new Error("E2E product fixture registry path is invalid.");
  }
  return registryPath;
}

const fixtureSkus = readFixtureSkus();
const fixtureRegistryPath = readFixtureRegistryPath();
const databaseUrl = process.env.DATABASE_URL;
const expectedDatabase = process.env.E2E_ALLOWED_DATABASE;
const expectedRole = process.env.E2E_ALLOWED_ROLE;
if (!databaseUrl || !expectedDatabase || !expectedRole) {
  throw new Error("E2E database target is not validated.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 10_000,
});
const registeredProductIds = new Set<string>();

async function registerFixtureProduct(sku: string): Promise<string> {
  const product = await pool.query<{ id: string }>(
    `SELECT id::text
     FROM public."Product"
     WHERE sku = $1`,
    [sku],
  );
  const id = product.rows[0]?.id;
  if (!id) throw new Error("Created E2E product was not found in PostgreSQL.");
  registeredProductIds.add(id);
  await mkdir(dirname(fixtureRegistryPath), { recursive: true });
  await writeFile(
    fixtureRegistryPath,
    JSON.stringify([...registeredProductIds]),
    { mode: 0o600 },
  );
  return id;
}

async function readVisibleProductOrder(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  const rows = await page
    .getByRole("table")
    .locator("tbody tr")
    .allTextContents();
  return rows
    .map((text) => fixtureSkus.find((sku) => text.includes(sku)))
    .filter((sku): sku is string => sku !== undefined);
}

async function readPersistedProductOrder(): Promise<
  Array<{ sku: string; sortOrder: number }>
> {
  const result = await pool.query<{ sku: string; sortOrder: number }>(
    `SELECT sku, "sortOrder"
     FROM public."Product"
     WHERE sku = ANY($1::text[])
     ORDER BY "sortOrder" ASC, id ASC`,
    [fixtureSkus],
  );
  return result.rows;
}

async function openProductCatalog(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Continuar con OAuth simulado" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Proveedor OAuth simulado" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Autorizar PulseMarket" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function createFixtureProducts(
  page: import("@playwright/test").Page,
): Promise<void> {
  for (const [index, sku] of fixtureSkus.entries()) {
    await page.goto("/dashboard/products");
    const form = page.getByRole("region", { name: "Crear producto" });
    await form.getByLabel("SKU").fill(sku);
    await form.getByLabel("Nombre").fill(`E2E reorder ${index + 1}`);
    await form.getByLabel("Categoría").fill("E2E");
    await form.getByLabel("Precio").fill("1.00");
    await form.getByLabel("Stock").fill("0");
    await form
      .getByRole("button", { name: "Crear producto", exact: true })
      .click();
    await expect(form.getByRole("status")).toContainText(
      `Producto ${sku} creado.`,
    );
    await registerFixtureProduct(sku);
  }
}

test.beforeAll(async () => {
  const identity = await pool.query<{ database: string; role: string }>(
    "SELECT current_database() AS database, current_user AS role",
  );
  if (
    identity.rows[0]?.database !== expectedDatabase ||
    identity.rows[0]?.role !== expectedRole
  ) {
    throw new Error("E2E browser test connected to an unexpected database.");
  }
});

test.afterAll(async () => {
  await pool.end();
});

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await page.goto("about:blank");
});

test("persists a real HTML5 drag-and-drop product reorder", async ({ page }) => {
  await openProductCatalog(page);
  await createFixtureProducts(page);

  const catalogUrl =
    "/dashboard/products?sortBy=sortOrder&sortOrder=asc&pageSize=20";
  await page.goto(catalogUrl);
  await expect(
    page.getByRole("table").getByRole("row").filter({ hasText: fixtureSkus[0] }),
  ).toBeVisible();

  const initialOrder = await readVisibleProductOrder(page);
  expect(initialOrder).toEqual(fixtureSkus);

  const source = page.getByRole("button", {
    name: `Arrastrar E2E reorder 1`,
  });
  const targetRow = page
    .getByRole("table")
    .getByRole("row")
    .filter({ hasText: fixtureSkus[2] });
  await source.dragTo(targetRow);

  const expectedOrder = [fixtureSkus[1], fixtureSkus[2], fixtureSkus[0]];
  await expect
    .poll(async () =>
      (await readPersistedProductOrder()).map(({ sku }) => sku),
    )
    .toEqual(expectedOrder);
  await expect.poll(() => readVisibleProductOrder(page)).toEqual(expectedOrder);

  await page.reload();
  await expect.poll(() => readVisibleProductOrder(page)).toEqual(expectedOrder);

  const persisted = await readPersistedProductOrder();
  expect(persisted.map(({ sku }) => sku)).toEqual(expectedOrder);
  const persistedPositions = persisted.map(({ sortOrder }) => sortOrder);
  expect(new Set(persistedPositions).size).toBe(3);
  expect([...persistedPositions].sort((left, right) => left - right)).toEqual(
    persistedPositions,
  );
  console.log(
    `E2E drag order: ${JSON.stringify({
      initialOrder,
      orderAfterDrag: expectedOrder,
      orderAfterReload: await readVisibleProductOrder(page),
      persistedPositions: persisted.map(({ sku, sortOrder }) => ({
        sku,
        sortOrder,
      })),
    })}`,
  );
});
