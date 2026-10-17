import { expect, request as playwrightRequest, test } from "@playwright/test";
import type { Locator, Page, Request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { encode } from "next-auth/jwt";
import { Pool } from "pg";

type EditFixtureSkus = {
  target: string;
  duplicateOwner: string;
  deletedElsewhere: string;
  renamed: string;
};

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): item is string => typeof item === "string")
  );
}

function readFixtureSkus(): EditFixtureSkus {
  const encoded = process.env.PULSEMARKET_E2E_PRODUCT_SKUS;
  if (!encoded) throw new Error("E2E product fixture identifiers are missing.");
  const parsed: unknown = JSON.parse(encoded);
  if (!isStringArray(parsed) || parsed.length !== 4) {
    throw new Error("E2E product fixture identifiers are invalid.");
  }
  const [target, duplicateOwner, deletedElsewhere, renamed] = parsed;
  const expectedSuffixes = ["EDIT-A", "EDIT-B", "EDIT-C", "EDIT-R"];
  if (
    !parsed.every((sku, index) =>
      new RegExp(`^PME2E-[a-f0-9]{32}-${expectedSuffixes[index]}$`).test(sku),
    )
  ) {
    throw new Error("E2E product fixture identifiers are invalid.");
  }
  return { target, duplicateOwner, deletedElsewhere, renamed };
}

function createFixtureRegistryPath(): string {
  const configuredPath = process.env.PULSEMARKET_E2E_PRODUCT_REGISTRY;
  if (!configuredPath) {
    throw new Error("E2E product fixture registry is not configured.");
  }
  const registryPath = resolve(configuredPath);
  const relativePath = relative(resolve(".playwright-e2e"), registryPath);
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

type StoredProduct = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  price: string;
  stock: number;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  seedKey: string | null;
};

async function findProduct(sku: string): Promise<StoredProduct | undefined> {
  const result = await pool.query<StoredProduct>(
    `SELECT id::text, sku, name, description, category, price::text,
            stock, "sortOrder", "deletedAt"::text, "createdAt"::text,
            "seedKey"
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

async function findProductById(id: string): Promise<StoredProduct> {
  const result = await pool.query<StoredProduct>(
    `SELECT id::text, sku, name, description, category, price::text,
            stock, "sortOrder", "deletedAt"::text, "createdAt"::text,
            "seedKey"
     FROM public."Product"
     WHERE id = $1`,
    [id],
  );
  const product = result.rows[0];
  if (!product) throw new Error("E2E product fixture disappeared.");
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
  await page.goto("/dashboard/products");
  await expect(
    page.getByRole("heading", { name: "Crear producto" }),
  ).toBeVisible();
}

// Creates fixtures through the shared-field creation form, which doubles as
// a regression check that creation still works after the field extraction.
async function ensureProduct(
  page: Page,
  sku: string,
  name: string,
): Promise<StoredProduct> {
  const existing = await findProduct(sku);
  if (existing) return existing;
  const form = page.getByRole("region", { name: "Crear producto" });
  await form.getByLabel("SKU").fill(sku);
  await form.getByLabel("Nombre").fill(name);
  await form.getByLabel("Categoría").fill("E2E");
  await form.getByLabel("Precio").fill("10.00");
  await form.getByLabel("Stock").fill("3");
  await page.getByRole("button", { name: "Crear producto", exact: true }).click();
  await expect(form.getByRole("status")).toContainText(`Producto ${sku} creado.`);
  const created = await findProduct(sku);
  if (!created) throw new Error("E2E product fixture was not created.");
  return created;
}

function productRow(page: Page, sku: string): Locator {
  return page.getByRole("table").getByRole("row").filter({ hasText: sku });
}

function editDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Editar producto" });
}

async function openEditor(page: Page, name: string): Promise<Locator> {
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
  const dialog = editDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("SKU")).toBeFocused();
  return dialog;
}

function isUpdateActionRequest(request: Request): boolean {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/dashboard/products" &&
    Boolean(request.headers()["next-action"]) &&
    (request.postData() ?? "").includes("original.sku")
  );
}

function catalogFeedback(page: Page): Locator {
  return page
    .getByRole("region", { name: "Gestión del catálogo" })
    .getByRole("status");
}

test("edits a product through the dialog, writes only changed fields, and frees the previous SKU", async ({
  page,
}) => {
  await openProductCatalog(page);
  const before = await ensureProduct(page, fixtureSkus.target, "E2E edit target");
  await ensureProduct(page, fixtureSkus.duplicateOwner, "E2E duplicate owner");
  await page.goto("/dashboard/products");

  const updateRequests: string[] = [];
  page.on("request", (request) => {
    if (isUpdateActionRequest(request)) updateRequests.push(request.url());
  });

  let dialog = await openEditor(page, "E2E edit target");
  await expect(dialog.getByLabel("Precio")).toHaveValue("10.00");
  await dialog.getByLabel("Nombre").fill("E2E edited name");
  await dialog.getByLabel("Precio").fill("12.5");
  await dialog.getByLabel("Precio").press("Enter");

  await expect(catalogFeedback(page)).toHaveText(
    `Producto ${fixtureSkus.target} actualizado.`,
  );
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Editar E2E edited name", exact: true }),
  ).toBeFocused();
  await expect(productRow(page, fixtureSkus.target)).toContainText("12.50");
  expect(updateRequests).toHaveLength(1);

  const edited = await findProductById(before.id);
  expect(edited.name).toBe("E2E edited name");
  expect(edited.price).toBe("12.50");
  expect({
    stock: edited.stock,
    category: edited.category,
    description: edited.description,
    sortOrder: edited.sortOrder,
    deletedAt: edited.deletedAt,
    createdAt: edited.createdAt,
    seedKey: edited.seedKey,
  }).toEqual({
    stock: before.stock,
    category: before.category,
    description: before.description,
    sortOrder: before.sortOrder,
    deletedAt: before.deletedAt,
    createdAt: before.createdAt,
    seedKey: before.seedKey,
  });

  dialog = await openEditor(page, "E2E edited name");
  await dialog.getByLabel("SKU").fill(fixtureSkus.renamed);
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(catalogFeedback(page)).toHaveText(
    `Producto ${fixtureSkus.renamed} actualizado.`,
  );
  await expect(productRow(page, fixtureSkus.renamed)).toBeVisible();
  expect((await findProductById(before.id)).sku).toBe(fixtureSkus.renamed);
  await findProduct(fixtureSkus.renamed);

  // The previous SKU is free again and can be used by a new product.
  const reused = await ensureProduct(page, fixtureSkus.target, "E2E reused SKU");
  expect(reused.id).not.toBe(before.id);
});

test("rejects invalid values and a duplicate SKU in place without writing, and confirms discarding changes", async ({
  page,
}) => {
  await openProductCatalog(page);
  const target = await findProduct(fixtureSkus.renamed);
  const owner = await findProduct(fixtureSkus.duplicateOwner);
  if (!target || !owner) throw new Error("Edit fixtures are missing.");

  const dialog = await openEditor(page, target.name);
  await dialog.getByLabel("Precio").fill("12.345");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Revisa los campos indicados.");
  await expect(dialog.getByLabel("Precio")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByLabel("Precio")).toHaveValue("12.345");

  await dialog.getByLabel("Precio").fill("13.00");
  await dialog.getByLabel("SKU").fill(owner.sku);
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Ese SKU ya está en uso");
  await expect(dialog.getByLabel("SKU")).toHaveAttribute("aria-invalid", "true");
  expect(await findProductById(target.id)).toEqual(target);

  // Escape with unsaved changes asks first; dismissing keeps the dialog open.
  page.once("dialog", (confirmation) => {
    expect(confirmation.message()).toBe("¿Descartar los cambios sin guardar?");
    void confirmation.dismiss();
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  page.once("dialog", (confirmation) => void confirmation.accept());
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  expect(await findProductById(target.id)).toEqual(target);

  // Without changes, Escape closes immediately.
  const reopened = await openEditor(page, target.name);
  await page.keyboard.press("Escape");
  await expect(reopened).toBeHidden();
});

test("blocks Escape and duplicate submission while a save is in flight", async ({
  page,
}) => {
  await openProductCatalog(page);
  const target = await findProduct(fixtureSkus.renamed);
  if (!target) throw new Error("Edit fixture is missing.");

  const dialog = await openEditor(page, target.name);
  let releaseSave: () => void = () => {};
  const saveReleased = new Promise<void>((resolveRelease) => {
    releaseSave = resolveRelease;
  });
  let heldRequests = 0;
  await page.route("**/dashboard/products**", async (route) => {
    if (!isUpdateActionRequest(route.request())) return route.fallback();
    heldRequests += 1;
    await saveReleased;
    await route.continue();
  });

  await dialog.getByLabel("Stock").fill("9");
  await dialog.getByLabel("Stock").press("Enter");
  await expect(dialog.getByText("Guardando cambios...")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Guardando..." })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await expect(dialog.getByLabel("Stock")).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Guardando..." }).click({ force: true });
  expect(heldRequests).toBe(1);

  releaseSave();
  await expect(dialog).toBeHidden();
  await expect(catalogFeedback(page)).toHaveText(
    `Producto ${fixtureSkus.renamed} actualizado.`,
  );
  expect(heldRequests).toBe(1);
  expect((await findProductById(target.id)).stock).toBe(9);
  await page.unrouteAll({ behavior: "wait" });
});

test("reports a product deleted in another tab and does not write", async ({
  page,
  context,
}) => {
  await openProductCatalog(page);
  const victim = await ensureProduct(
    page,
    fixtureSkus.deletedElsewhere,
    "E2E deleted elsewhere",
  );
  await page.goto("/dashboard/products");
  const dialog = await openEditor(page, victim.name);

  const otherTab = await context.newPage();
  await otherTab.goto("/dashboard/products");
  otherTab.once("dialog", (confirmation) => void confirmation.accept());
  await productRow(otherTab, victim.sku)
    .getByRole("button", { name: "Eliminar" })
    .click();
  // The mutation persists and the refreshed table (remounted because its IDs
  // changed) no longer lists the product; the confirmation must survive that.
  await expect(productRow(otherTab, victim.sku)).toHaveCount(0);
  await expect
    .poll(async () => (await findProductById(victim.id)).deletedAt)
    .not.toBeNull();
  const otherCatalog = otherTab.getByRole("region", {
    name: "Gestión del catálogo",
  });
  await expect(otherCatalog.getByText("Aplicando cambios...")).toBeHidden();
  await expect(otherCatalog.getByRole("status")).toHaveText(
    "Producto eliminado del catálogo.",
  );
  await otherTab.close();

  await dialog.getByLabel("Nombre").fill("Should not persist");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "El producto fue eliminado del catálogo y no se puede editar.",
  );
  await expect(dialog.getByLabel("Nombre")).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toBeHidden();

  const stored = await findProductById(victim.id);
  expect(stored.name).toBe(victim.name);
  expect(stored.deletedAt).not.toBeNull();
});

test("rejects replayed update requests over HTTP without an authorized session", async ({
  page,
  baseURL,
}) => {
  const secret = process.env.PULSEMARKET_E2E_DISCLOSURE_TEST_SECRET;
  if (!secret || !baseURL) throw new Error("E2E HTTP replay setup is missing.");
  await openProductCatalog(page);
  const target = await findProduct(fixtureSkus.renamed);
  if (!target) throw new Error("Edit fixture is missing.");

  // Capture one real update request without letting it reach the server.
  let captured: { url: string; headers: Record<string, string>; body: Buffer } | null =
    null;
  await page.route("**/dashboard/products**", async (route) => {
    const request = route.request();
    if (!isUpdateActionRequest(request)) return route.fallback();
    captured = {
      url: request.url(),
      headers: request.headers(),
      body: request.postDataBuffer() ?? Buffer.alloc(0),
    };
    await route.abort();
  });
  const dialog = await openEditor(page, target.name);
  await dialog.getByLabel("Stock").fill("42");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(() => captured !== null).toBe(true);
  await page.unrouteAll({ behavior: "wait" });
  const replay = captured as unknown as {
    url: string;
    headers: Record<string, string>;
    body: Buffer;
  };
  const replayHeaders = {
    "content-type": replay.headers["content-type"],
    "next-action": replay.headers["next-action"],
    "next-router-state-tree": replay.headers["next-router-state-tree"] ?? "",
    accept: "text/x-component",
    origin: new URL(baseURL).origin,
  };
  const unchanged = await findProductById(target.id);

  const anonymous = await playwrightRequest.newContext({ baseURL });
  try {
    const response = await anonymous.post(replay.url, {
      headers: replayHeaders,
      data: replay.body,
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(new URL(response.headers().location, baseURL).pathname).toBe("/login");
  } finally {
    await anonymous.dispose();
  }

  const unapprovedToken = await encode({
    token: {
      sub: "unapproved-google-user",
      provider: "google",
      providerAccountId: "unapproved-google-user",
    },
    secret,
  });
  const unapproved = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `next-auth.session-token=${unapprovedToken}` },
  });
  try {
    const response = await unapproved.post(replay.url, {
      headers: replayHeaders,
      data: replay.body,
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    const location = new URL(response.headers().location, baseURL);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("AccessDenied");
  } finally {
    await unapproved.dispose();
  }
  expect(await findProductById(target.id)).toEqual(unchanged);

  // Positive control: the same replay with the authorized session is valid,
  // so the rejections above come from the missing authorization.
  const authorized = await page.request.post(replay.url, {
    headers: replayHeaders,
    data: replay.body,
    maxRedirects: 0,
  });
  expect(authorized.status()).toBe(200);
  expect((await findProductById(target.id)).stock).toBe(42);
});

function editFixturePrefix(): string {
  return fixtureSkus.target.replace(/EDIT-A$/, "EDIT-");
}

async function cellTexts(row: Locator): Promise<string[]> {
  return (await row.getByRole("cell").allInnerTexts()).map((text) => text.trim());
}

test("shows bulk price, stock, and category changes without a manual reload, and reordering still works", async ({
  page,
}) => {
  await openProductCatalog(page);
  const first = await findProduct(fixtureSkus.renamed);
  const second = await findProduct(fixtureSkus.duplicateOwner);
  if (!first || !second) throw new Error("Edit fixtures are missing.");
  await page.goto(
    `/dashboard/products?search=${encodeURIComponent(editFixturePrefix())}`,
  );

  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  const catalog = page.getByRole("region", { name: "Gestión del catálogo" });

  async function selectFixtures() {
    await page.getByRole("checkbox", { name: `Seleccionar ${first?.name}` }).check();
    await page.getByRole("checkbox", { name: `Seleccionar ${second?.name}` }).check();
  }

  async function applyBulk() {
    page.once("dialog", (confirmation) => void confirmation.accept());
    await catalog.getByRole("button", { name: "Aplicar cambio" }).click();
    await expect(catalog.getByRole("status")).toHaveText(
      "Se actualizaron 2 productos.",
    );
    // The success message renders before the follow-up refresh settles; wait
    // for the pending indicator to clear, as a user would, before continuing.
    await expect(catalog.getByText("Aplicando cambios...")).toBeHidden();
  }

  await selectFixtures();
  await catalog.getByLabel("Nueva categoría").fill("E2E masiva");
  await applyBulk();
  for (const sku of [first.sku, second.sku]) {
    await expect(productRow(page, sku)).toContainText("E2E masiva");
  }

  await selectFixtures();
  await catalog.getByLabel("Acción masiva").selectOption("adjust");
  await catalog.getByLabel("Campo").selectOption("price");
  await catalog.getByLabel("Tipo de ajuste").selectOption("fixed");
  await catalog.getByLabel("Ajuste (+/-)").fill("1.5");
  await applyBulk();

  await selectFixtures();
  await catalog.getByLabel("Acción masiva").selectOption("adjust");
  await catalog.getByLabel("Campo").selectOption("stock");
  await catalog.getByLabel("Tipo de ajuste").selectOption("percentage");
  await catalog.getByLabel("Porcentaje (+/-)").fill("100");
  await applyBulk();

  for (const before of [first, second]) {
    const stored = await findProductById(before.id);
    const expectedPrice = (Number(before.price) + 1.5).toFixed(2);
    expect(stored.category).toBe("E2E masiva");
    expect(stored.price).toBe(expectedPrice);
    expect(stored.stock).toBe(before.stock * 2);
    const cells = await cellTexts(productRow(page, before.sku));
    expect(cells).toContain("E2E masiva");
    expect(cells).toContain(expectedPrice);
    expect(cells).toContain(String(before.stock * 2));
  }
  expect(loads).toBe(0);

  // Reordering on the unfiltered custom-position view still persists and
  // updates the table without a reload.
  await page.goto("/dashboard/products?sortBy=sortOrder&sortOrder=asc");
  loads = 0;
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.nth(2).getByRole("button", { name: /^Bajar / })).toBeVisible();
  const firstName = (await cellTexts(rows.nth(1)))[3];
  const secondName = (await cellTexts(rows.nth(2)))[3];
  await page.getByRole("button", { name: `Bajar ${firstName}`, exact: true }).click();
  // The order persists, the refreshed table (remounted because its ID order
  // changed) shows it, and the confirmation survives that remount.
  await expect
    .poll(async () => {
      const persisted = await pool.query<{ name: string }>(
        `SELECT name FROM public."Product"
         WHERE "deletedAt" IS NULL
         ORDER BY "sortOrder" ASC, id ASC
         LIMIT 2`,
      );
      return persisted.rows.map(({ name }) => name);
    })
    .toEqual([secondName, firstName]);
  await expect(catalog.getByText("Aplicando cambios...")).toBeHidden();
  await expect.poll(async () => (await cellTexts(rows.nth(1)))[3]).toBe(secondName);
  expect((await cellTexts(rows.nth(2)))[3]).toBe(firstName);
  await expect(catalog.getByRole("status")).toHaveText("Nuevo orden guardado.");
  expect(loads).toBe(0);
});

test("keeps IDs unique and accessible references scoped while creation and edit forms are both mounted with errors", async ({
  page,
}) => {
  await openProductCatalog(page);
  const target = await findProduct(fixtureSkus.renamed);
  if (!target) throw new Error("Edit fixture is missing.");

  const creation = page.getByRole("region", { name: "Crear producto" });
  await creation.getByLabel("SKU").fill(fixtureSkus.deletedElsewhere);
  await creation.getByLabel("Nombre").fill("E2E invalid creation");
  await creation.getByLabel("Categoría").fill("E2E");
  await creation.getByLabel("Precio").fill("1.234");
  await page.getByRole("button", { name: "Crear producto", exact: true }).click();
  await expect(creation.getByRole("alert")).toContainText("Revisa los campos indicados.");

  const dialog = await openEditor(page, target.name);
  await dialog.getByLabel("Precio").fill("1.234");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Revisa los campos indicados.");

  const report = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    const creationSection = document.querySelector(
      'section[aria-labelledby="product-creation-heading"]',
    );
    const dialogElement = document.querySelector("dialog[open]");
    function describe(container: Element | null) {
      return [...(container?.querySelectorAll("input[name]") ?? [])].map((input) => {
        const describedBy = (input.getAttribute("aria-describedby") ?? "")
          .split(" ")
          .filter(Boolean);
        const label = input.closest("label");
        return {
          name: input.getAttribute("name"),
          invalid: input.getAttribute("aria-invalid"),
          labelInside: Boolean(label && container?.contains(label)),
          referencesInside: describedBy.every((id) => {
            const referenced = document.getElementById(id);
            return Boolean(referenced && container?.contains(referenced));
          }),
          describedBy,
        };
      });
    }
    return {
      duplicates,
      creation: describe(creationSection),
      edit: describe(dialogElement),
    };
  });

  expect(report.duplicates).toEqual([]);
  expect(report.creation).toHaveLength(6);
  expect(report.edit).toHaveLength(6);
  for (const field of [...report.creation, ...report.edit]) {
    expect(field.labelInside, String(field.name)).toBe(true);
    expect(field.referencesInside, String(field.name)).toBe(true);
  }
  const creationPrice = report.creation.find(({ name }) => name === "price");
  const editPrice = report.edit.find(({ name }) => name === "price");
  expect(creationPrice).toMatchObject({ invalid: "true", describedBy: ["price-error"] });
  expect(editPrice).toMatchObject({ invalid: "true", describedBy: ["edit-price-error"] });
  for (const field of report.edit.filter(({ name }) => name !== "price")) {
    expect(field.invalid, String(field.name)).toBe("false");
  }
  expect(await findProduct(fixtureSkus.deletedElsewhere)).toMatchObject({
    name: "E2E deleted elsewhere",
  });

  page.once("dialog", (confirmation) => void confirmation.accept());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

for (const [label, viewport] of [
  ["mobile", { width: 375, height: 667 }],
  ["desktop", { width: 1280, height: 720 }],
] as const) {
  test(`keeps Save and Cancel reachable by scrolling and keyboard with visible errors (${label})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openProductCatalog(page);
    const target = await findProduct(fixtureSkus.renamed);
    if (!target) throw new Error("Edit fixture is missing.");

    const dialog = await openEditor(page, target.name);
    await dialog.getByLabel("Precio").fill("1.234");
    await dialog.getByLabel("Stock").fill("-1");
    await dialog.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();

    const save = dialog.getByRole("button", { name: "Guardar cambios" });
    const cancel = dialog.getByRole("button", { name: "Cancelar" });
    const panel = dialog.locator(".dashboard-product-edit__panel");

    // Scrolling: reset the panel to the top, then scroll each control into view.
    await panel.evaluate((element) => element.scrollTo({ top: 0 }));
    for (const control of [save, cancel]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }

    // Keyboard: Tab from the first field reaches both controls, each scrolled
    // into view when focused.
    await panel.evaluate((element) => element.scrollTo({ top: 0 }));
    await dialog.getByLabel("SKU").focus();
    const reached: string[] = [];
    for (let step = 0; step < 15 && reached.length < 2; step += 1) {
      await page.keyboard.press("Tab");
      for (const [name, control] of [
        ["save", save],
        ["cancel", cancel],
      ] as const) {
        if (
          !reached.includes(name) &&
          (await control.evaluate((element) => element === document.activeElement))
        ) {
          await expect(control).toBeInViewport();
          reached.push(name);
        }
      }
    }
    // Tab order follows the DOM: Cancel, then Save.
    expect(reached).toEqual(["cancel", "save"]);

    // Visual order matches: Cancel above Save on mobile, left of Save on desktop.
    const cancelBox = await cancel.boundingBox();
    const saveBox = await save.boundingBox();
    if (!cancelBox || !saveBox) throw new Error("Dialog buttons are not laid out.");
    if (label === "mobile") {
      expect(cancelBox.y + cancelBox.height).toBeLessThanOrEqual(saveBox.y);
    } else {
      expect(Math.abs(cancelBox.y - saveBox.y)).toBeLessThan(1);
      expect(cancelBox.x + cancelBox.width).toBeLessThanOrEqual(saveBox.x);
    }

    page.once("dialog", (confirmation) => void confirmation.accept());
    await cancel.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect(await findProductById(target.id)).toEqual(target);
  });
}
