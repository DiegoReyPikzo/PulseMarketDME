import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Pool } from "pg";

type ProductFixtureSkus = {
  zeroPrice: string;
  duplicate: string;
  invalid: string;
};

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): item is string => typeof item === "string")
  );
}

function readFixtureSkus(): ProductFixtureSkus {
  const encoded = process.env.PULSEMARKET_E2E_PRODUCT_SKUS;
  if (!encoded) throw new Error("E2E product fixture identifiers are missing.");
  const parsed: unknown = JSON.parse(encoded);
  if (!isStringArray(parsed) || parsed.length !== 9) {
    throw new Error("E2E product fixture identifiers are invalid.");
  }
  // The suite also carries product-delete.spec.ts fixtures; take this spec's
  // own SKUs by suffix (each must appear exactly once).
  const bySuffix = (suffix: string) => {
    const matches = parsed.filter((sku) => sku.endsWith(`-${suffix}`));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const zeroPrice = bySuffix("ZERO");
  const duplicate = bySuffix("DUP");
  const invalid = bySuffix("INVALID");
  if (
    !zeroPrice ||
    !duplicate ||
    !invalid ||
    ![zeroPrice, duplicate, invalid].every((sku) =>
      /^PME2E-[a-f0-9]{32}-(?:ZERO|DUP|INVALID)$/.test(sku),
    )
  ) {
    throw new Error("E2E product fixture identifiers are invalid.");
  }
  return { zeroPrice, duplicate, invalid };
}

function createFixtureRegistryPath(): string {
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
const fixtureRegistryPath = createFixtureRegistryPath();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("E2E database connection is unavailable.");
const expectedDatabase = process.env.E2E_ALLOWED_DATABASE;
const expectedRole = process.env.E2E_ALLOWED_ROLE;
if (!expectedDatabase || !expectedRole) {
  throw new Error("E2E database target is not validated.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 10_000,
});
const registeredProductIds = new Set<string>();

async function findFixtureProduct(sku: string) {
  const result = await pool.query<{
    id: string;
    sku: string;
    name: string;
    price: string;
  }>(
    `SELECT id::text, sku, name, price::text
     FROM public."Product"
     WHERE sku = $1`,
    [sku],
  );
  const product = result.rows[0];
  if (product) {
    registeredProductIds.add(product.id);
    await mkdir(dirname(fixtureRegistryPath), { recursive: true });
    await writeFile(
      fixtureRegistryPath,
      JSON.stringify([...registeredProductIds]),
      { mode: 0o600 },
    );
  }
  return product;
}

async function countProductsBySku(sku: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM public."Product"
     WHERE sku = $1`,
    [sku],
  );
  return Number(result.rows[0]?.count ?? "0");
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
  await page.getByRole("link", { name: "Productos" }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/products/);
  await expect(
    page.getByRole("heading", { name: "Crear producto" }),
  ).toBeVisible();
}

async function fillProductForm(
  page: import("@playwright/test").Page,
  sku: string,
  price: string,
): Promise<void> {
  const form = page.getByRole("region", { name: "Crear producto" });
  await form.getByLabel("SKU").fill(sku);
  await form.getByLabel("Nombre").fill(`E2E ${sku}`);
  await form.getByLabel("Categoría").fill("E2E");
  await form.getByLabel("Precio").fill(price);
  await form.getByLabel("Stock").fill("0");
}

async function submitProductForm(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.getByRole("button", { name: "Crear producto", exact: true }).click();
}

test("creates a zero-price product and verifies catalog and database persistence", async ({
  page,
}) => {
  await openProductCatalog(page);
  await fillProductForm(page, fixtureSkus.zeroPrice, "0.00");
  await submitProductForm(page);

  await expect(page.getByRole("status")).toContainText(
    `Producto ${fixtureSkus.zeroPrice} creado.`,
  );
  const productRow = page
    .getByRole("table")
    .getByRole("row")
    .filter({ hasText: fixtureSkus.zeroPrice });
  await expect(productRow).toBeVisible();
  await expect(productRow).toContainText("0.00");

  const storedProduct = await findFixtureProduct(fixtureSkus.zeroPrice);
  expect(storedProduct).not.toBeNull();
  expect(storedProduct?.price).toBe("0.00");

  await page.reload();
  await expect(
    page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: fixtureSkus.zeroPrice }),
  ).toBeVisible();
  expect(await findFixtureProduct(fixtureSkus.zeroPrice)).not.toBeNull();
});

test("rejects a duplicate SKU accessibly, retains input values, and creates no duplicate", async ({
  page,
}) => {
  await openProductCatalog(page);
  await fillProductForm(page, fixtureSkus.duplicate, "12.34");
  await submitProductForm(page);
  await expect(page.getByRole("status")).toContainText(
    `Producto ${fixtureSkus.duplicate} creado.`,
  );
  const original = await findFixtureProduct(fixtureSkus.duplicate);
  expect(original).not.toBeNull();

  await fillProductForm(page, fixtureSkus.duplicate, "56.78");
  await submitProductForm(page);
  await expect(
    page.getByRole("region", { name: "Crear producto" }).getByRole("alert"),
  ).toHaveText(
    "Ese SKU ya está en uso y no se puede reutilizar.",
  );
  const form = page.getByRole("region", { name: "Crear producto" });
  await expect(form.getByLabel("SKU")).toHaveValue(fixtureSkus.duplicate);
  await expect(form.getByLabel("Nombre")).toHaveValue(
    `E2E ${fixtureSkus.duplicate}`,
  );
  await expect(form.getByLabel("Categoría")).toHaveValue("E2E");
  await expect(form.getByLabel("Precio")).toHaveValue("56.78");
  await expect(form.getByLabel("Stock")).toHaveValue("0");

  const matches = await pool.query<{ id: string }>(
    `SELECT id::text
     FROM public."Product"
     WHERE sku = $1`,
    [fixtureSkus.duplicate],
  );
  for (const product of matches.rows) registeredProductIds.add(product.id);
  expect(matches.rows).toHaveLength(1);
  expect(matches.rows[0]?.id).toBe(original?.id);
});

test("rejects excess price decimals and creates no product", async ({ page }) => {
  await openProductCatalog(page);
  await fillProductForm(page, fixtureSkus.invalid, "1.001");
  await submitProductForm(page);

  const form = page.getByRole("region", { name: "Crear producto" });
  await expect(form.getByRole("alert")).toHaveText(
    "Revisa los campos indicados.",
  );
  await expect(form.getByLabel("Precio")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page.getByText(
      "Ingresa un precio no negativo con hasta dos decimales y dentro del límite permitido.",
    ),
  ).toBeVisible();
  expect(await countProductsBySku(fixtureSkus.invalid)).toBe(0);
});
