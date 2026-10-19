import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Pool } from "pg";

// Deletion from the catalog UI. Confirmed individual deletion is already
// covered by product-edit.spec.ts ("reports a product deleted in another tab").
// Each test owns its own fixtures, so one test's deletions cannot affect another.
const DELETE_SUFFIXES = ["DEL-A1", "DEL-A2", "DEL-A3", "DEL-B1", "DEL-B2", "DEL-C1"] as const;
type DeleteSuffix = (typeof DELETE_SUFFIXES)[number];

type StoredProduct = {
  id: string;
  sku: string;
  name: string;
  deletedAt: string | null;
};

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): item is string => typeof item === "string")
  );
}

// The runner passes this suite's exact SKUs (shared run ID); take only the
// deletion fixtures and reject anything else.
function readDeleteFixtureSkus(): Record<DeleteSuffix, string> {
  const encoded = process.env.PULSEMARKET_E2E_PRODUCT_SKUS;
  if (!encoded) throw new Error("E2E product fixture identifiers are missing.");
  const parsed: unknown = JSON.parse(encoded);
  if (!isStringArray(parsed)) throw new Error("E2E product fixture identifiers are invalid.");
  const skus = {} as Record<DeleteSuffix, string>;
  for (const suffix of DELETE_SUFFIXES) {
    const matches = parsed.filter((sku) => new RegExp(`^PME2E-[a-f0-9]{32}-${suffix}$`).test(sku));
    if (matches.length !== 1) throw new Error("E2E product fixture identifiers are invalid.");
    skus[suffix] = matches[0];
  }
  return skus;
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

const fixtureSkus = readDeleteFixtureSkus();
const fixtureRegistryPath = readFixtureRegistryPath();
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

// Merges this spec's fixture IDs into the run's registry instead of replacing
// it, so IDs registered by the other spec of this suite are kept. Cleanup also
// finds fixtures by their exact SKUs.
async function registerFixtureId(id: string): Promise<void> {
  let registered: string[] = [];
  try {
    const parsed: unknown = JSON.parse(await readFile(fixtureRegistryPath, "utf8"));
    if (isStringArray(parsed)) registered = parsed;
  } catch (error: unknown) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  if (registered.includes(id)) return;
  await mkdir(dirname(fixtureRegistryPath), { recursive: true });
  await writeFile(fixtureRegistryPath, JSON.stringify([...registered, id]), { mode: 0o600 });
}

async function findProduct(sku: string): Promise<StoredProduct | undefined> {
  const result = await pool.query<StoredProduct>(
    `SELECT id::text, sku, name, "deletedAt"::text AS "deletedAt"
     FROM public."Product"
     WHERE sku = $1`,
    [sku],
  );
  const product = result.rows[0];
  if (product) await registerFixtureId(product.id);
  return product;
}

async function findProductById(id: string): Promise<StoredProduct> {
  const result = await pool.query<StoredProduct>(
    `SELECT id::text, sku, name, "deletedAt"::text AS "deletedAt"
     FROM public."Product"
     WHERE id = $1::uuid`,
    [id],
  );
  const product = result.rows[0];
  // A soft delete keeps the row; a missing row would mean a physical delete.
  if (!product) throw new Error("E2E product fixture row is missing.");
  return product;
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

async function openProductCatalog(page: Page): Promise<void> {
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

function fixtureName(sku: string): string {
  return `E2E delete ${sku}`;
}

// Creates the fixture through the creation form (as the other product specs do)
// and registers its ID for cleanup.
async function createFixture(page: Page, sku: string): Promise<StoredProduct> {
  if (await findProduct(sku)) throw new Error("E2E deletion fixture already exists.");
  const form = page.getByRole("region", { name: "Crear producto" });
  await form.getByLabel("SKU").fill(sku);
  await form.getByLabel("Nombre").fill(fixtureName(sku));
  await form.getByLabel("Categoría").fill("E2E");
  await form.getByLabel("Precio").fill("10.00");
  await form.getByLabel("Stock").fill("3");
  await page.getByRole("button", { name: "Crear producto", exact: true }).click();
  await expect(form.getByRole("status")).toContainText(`Producto ${sku} creado.`);
  const created = await findProduct(sku);
  if (!created || created.deletedAt !== null) {
    throw new Error("E2E deletion fixture was not created as an active product.");
  }
  return created;
}

function productRow(page: Page, sku: string): Locator {
  return page.getByRole("table").getByRole("row").filter({ hasText: sku });
}

// Lists only one case's fixtures (search by its exact SKU prefix), so the rows
// do not depend on catalog ordering, pagination or other data.
// The prefix is "PME2E-<runId>-DEL-<case letter>": shared by that case's
// fixtures only, and by no other case or run.
function casePrefix(caseSku: string): string {
  if (!/^PME2E-[a-f0-9]{32}-DEL-[ABC][1-3]$/.test(caseSku)) {
    throw new Error("E2E deletion fixture SKU is invalid.");
  }
  return caseSku.slice(0, -1);
}

function caseCatalogUrl(caseSku: string): string {
  return `/dashboard/products?search=${encodeURIComponent(casePrefix(caseSku))}`;
}

async function expectCaseFilter(page: Page, caseSku: string): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("search"))
    .toBe(casePrefix(caseSku));
}

function catalogRegion(page: Page): Locator {
  return page.getByRole("region", { name: "Gestión del catálogo" });
}

function isCatalogActionRequest(request: Request): boolean {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/dashboard/products" &&
    Boolean(request.headers()["next-action"])
  );
}

test("bulk delete soft-deletes the selected products, keeps the rest and persists after reload", async ({
  page,
}) => {
  await openProductCatalog(page);
  const first = await createFixture(page, fixtureSkus["DEL-A1"]);
  const second = await createFixture(page, fixtureSkus["DEL-A2"]);
  const kept = await createFixture(page, fixtureSkus["DEL-A3"]);
  await page.goto(caseCatalogUrl(first.sku));
  await expectCaseFilter(page, first.sku);
  for (const product of [first, second, kept]) {
    await expect(productRow(page, product.sku)).toHaveCount(1);
    await expect(productRow(page, product.sku)).toBeVisible();
  }

  await page.getByRole("checkbox", { name: `Seleccionar ${first.name}`, exact: true }).check();
  await page.getByRole("checkbox", { name: `Seleccionar ${second.name}`, exact: true }).check();
  let confirmation = "";
  page.once("dialog", (dialog) => {
    confirmation = dialog.message();
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Eliminar seleccionados" }).click();

  await expect(catalogRegion(page).getByRole("status")).toHaveText(
    "Se eliminaron 2 productos del catálogo.",
  );
  expect(confirmation).toBe("¿Eliminar los 2 productos seleccionados del catálogo?");
  await expect(productRow(page, first.sku)).toHaveCount(0);
  await expect(productRow(page, second.sku)).toHaveCount(0);
  await expect(productRow(page, kept.sku)).toHaveCount(1);

  // Persistence: a full reload renders the catalog from the database again.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Crear producto" })).toBeVisible();
  await expectCaseFilter(page, first.sku);
  await expect(productRow(page, first.sku)).toHaveCount(0);
  await expect(productRow(page, second.sku)).toHaveCount(0);
  await expect(productRow(page, kept.sku)).toHaveCount(1);

  // Soft delete: the rows still exist with deletedAt set; the third is untouched.
  expect((await findProductById(first.id)).deletedAt).not.toBeNull();
  expect((await findProductById(second.id)).deletedAt).not.toBeNull();
  expect(await findProductById(kept.id)).toEqual(kept);
});

test("cancelling a bulk delete sends no request and leaves the selected products intact", async ({
  page,
}) => {
  await openProductCatalog(page);
  const first = await createFixture(page, fixtureSkus["DEL-B1"]);
  const second = await createFixture(page, fixtureSkus["DEL-B2"]);
  await page.goto(caseCatalogUrl(first.sku));
  await expectCaseFilter(page, first.sku);
  for (const product of [first, second]) {
    await expect(productRow(page, product.sku)).toHaveCount(1);
    await expect(productRow(page, product.sku)).toBeVisible();
  }

  await page.getByRole("checkbox", { name: `Seleccionar ${first.name}`, exact: true }).check();
  await page.getByRole("checkbox", { name: `Seleccionar ${second.name}`, exact: true }).check();
  const actionRequests: Request[] = [];
  page.on("request", (request) => {
    if (isCatalogActionRequest(request)) actionRequests.push(request);
  });
  let confirmation = "";
  page.once("dialog", (dialog) => {
    confirmation = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "Eliminar seleccionados" }).click();

  await expect.poll(() => confirmation).toBe("¿Eliminar los 2 productos seleccionados del catálogo?");
  await expect(productRow(page, first.sku)).toHaveCount(1);
  await expect(productRow(page, second.sku)).toHaveCount(1);
  await expect(page.getByText("2 seleccionados", { exact: true })).toBeVisible();
  await expect(catalogRegion(page).getByText("Se eliminaron", { exact: false })).toHaveCount(0);
  expect(actionRequests).toHaveLength(0);

  await page.reload();
  await expectCaseFilter(page, first.sku);
  await expect(productRow(page, first.sku)).toHaveCount(1);
  await expect(productRow(page, second.sku)).toHaveCount(1);
  expect(await findProductById(first.id)).toEqual(first);
  expect(await findProductById(second.id)).toEqual(second);
});

test("cancelling an individual delete sends no request and leaves the product intact", async ({
  page,
}) => {
  await openProductCatalog(page);
  const product = await createFixture(page, fixtureSkus["DEL-C1"]);
  await page.goto(caseCatalogUrl(product.sku));
  await expectCaseFilter(page, product.sku);
  await expect(productRow(page, product.sku)).toHaveCount(1);
  await expect(productRow(page, product.sku)).toBeVisible();

  const actionRequests: Request[] = [];
  page.on("request", (request) => {
    if (isCatalogActionRequest(request)) actionRequests.push(request);
  });
  let confirmation = "";
  page.once("dialog", (dialog) => {
    confirmation = dialog.message();
    void dialog.dismiss();
  });
  await productRow(page, product.sku).getByRole("button", { name: "Eliminar" }).click();

  await expect.poll(() => confirmation).toBe("¿Eliminar este producto del catálogo?");
  await expect(productRow(page, product.sku)).toHaveCount(1);
  await expect(catalogRegion(page).getByText("Producto eliminado del catálogo.")).toHaveCount(0);
  expect(actionRequests).toHaveLength(0);

  await page.reload();
  await expectCaseFilter(page, product.sku);
  await expect(productRow(page, product.sku)).toHaveCount(1);
  expect(await findProductById(product.id)).toEqual(product);
});
