import { expect, request as playwrightRequest, test } from "@playwright/test";
import type { Locator, Page, Request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { encode } from "next-auth/jwt";
import { Pool } from "pg";

type CustomerFixtureEmails = {
  first: string;
  second: string;
  deleted: string;
  renamed: string;
};

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): item is string => typeof item === "string")
  );
}

function readFixtureEmails(): CustomerFixtureEmails {
  const encoded = process.env.PULSEMARKET_E2E_CUSTOMER_EMAILS;
  if (!encoded) throw new Error("E2E customer fixture identifiers are missing.");
  const parsed: unknown = JSON.parse(encoded);
  if (!isStringArray(parsed) || parsed.length !== 4) {
    throw new Error("E2E customer fixture identifiers are invalid.");
  }
  const suffixes = ["a", "b", "c", "r"];
  if (
    !parsed.every((email, index) =>
      new RegExp(`^pme2e-[a-f0-9]{32}-cust-${suffixes[index]}@example\\.test$`).test(email),
    )
  ) {
    throw new Error("E2E customer fixture identifiers are invalid.");
  }
  const [first, second, deleted, renamed] = parsed;
  return { first, second, deleted, renamed };
}

function createRegistryPath(): string {
  const configuredPath = process.env.PULSEMARKET_E2E_CUSTOMER_REGISTRY;
  if (!configuredPath) throw new Error("E2E customer registry is not configured.");
  const registryPath = resolve(configuredPath);
  const relativePath = relative(resolve(".playwright-e2e"), registryPath);
  if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
    throw new Error("E2E customer registry path is invalid.");
  }
  return registryPath;
}

const emails = readFixtureEmails();
const registryPath = createRegistryPath();
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
const registeredIds = new Set<string>();

type StoredCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  deletedAt: string | null;
  createdAt: string;
  seedKey: string | null;
};

const CUSTOMER_COLUMNS = `id::text, name, email, phone, "deletedAt"::text,
  "createdAt"::text, "seedKey"`;

async function register(id: string): Promise<void> {
  registeredIds.add(id);
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify([...registeredIds]), { mode: 0o600 });
}

async function findCustomer(email: string): Promise<StoredCustomer | undefined> {
  const result = await pool.query<StoredCustomer>(
    `SELECT ${CUSTOMER_COLUMNS} FROM public."Customer" WHERE email = $1`,
    [email],
  );
  const customer = result.rows[0];
  if (customer) await register(customer.id);
  return customer;
}

async function findCustomerById(id: string): Promise<StoredCustomer> {
  const result = await pool.query<StoredCustomer>(
    `SELECT ${CUSTOMER_COLUMNS} FROM public."Customer" WHERE id = $1`,
    [id],
  );
  const customer = result.rows[0];
  if (!customer) throw new Error("E2E customer fixture disappeared.");
  return customer;
}

async function countByEmailInsensitive(email: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM public."Customer" WHERE lower(email) = lower($1)`,
    [email],
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

async function openDirectory(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continuar con OAuth simulado" }).click();
  await expect(
    page.getByRole("heading", { name: "Proveedor OAuth simulado" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Autorizar PulseMarket" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/dashboard/customers");
  await expect(page.getByRole("heading", { name: "Crear cliente" })).toBeVisible();
}

function creationForm(page: Page): Locator {
  return page.getByRole("region", { name: "Crear cliente" });
}

async function fillCreation(page: Page, name: string, email: string, phone = "") {
  const form = creationForm(page);
  await form.getByLabel("Nombre").fill(name);
  await form.getByLabel("Correo electrónico").fill(email);
  await form.getByLabel("Teléfono (opcional)").fill(phone);
  await page.getByRole("button", { name: "Crear cliente", exact: true }).click();
}

async function ensureCustomer(
  page: Page,
  email: string,
  name: string,
): Promise<StoredCustomer> {
  const existing = await findCustomer(email);
  if (existing) return existing;
  await fillCreation(page, name, email);
  await expect(creationForm(page).getByRole("status")).toContainText(
    `Cliente ${name} creado.`,
  );
  const created = await findCustomer(email);
  if (!created) throw new Error("E2E customer fixture was not created.");
  return created;
}

function directory(page: Page): Locator {
  return page.getByRole("region", { name: "Gestión de clientes" });
}

function customerRow(page: Page, email: string): Locator {
  return page.getByRole("table").getByRole("row").filter({ hasText: email });
}

function editDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Editar cliente" });
}

async function openEditor(page: Page, name: string): Promise<Locator> {
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
  const dialog = editDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Nombre")).toBeFocused();
  return dialog;
}

function isUpdateActionRequest(request: Request): boolean {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/dashboard/customers" &&
    Boolean(request.headers()["next-action"]) &&
    (request.postData() ?? "").includes("original.email")
  );
}

test("creates a normalized customer and rejects invalid and duplicate input without writing", async ({
  page,
}) => {
  await openDirectory(page);

  await fillCreation(page, "  E2E Cliente A  ", `  ${emails.first.toUpperCase()}  `, " +52 (55) 0000-0000 ");
  await expect(creationForm(page).getByRole("status")).toContainText(
    "Cliente E2E Cliente A creado.",
  );
  const first = await findCustomer(emails.first);
  expect(first).toMatchObject({
    name: "E2E Cliente A",
    email: emails.first,
    phone: "+52 (55) 0000-0000",
    deletedAt: null,
  });
  await expect(customerRow(page, emails.first)).toBeVisible();

  await fillCreation(page, "E2E Cliente inválido", "no-es-un-correo", "abc");
  const form = creationForm(page);
  await expect(form.getByRole("alert")).toContainText("Revisa los campos indicados.");
  await expect(form.getByLabel("Correo electrónico")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByLabel("Teléfono (opcional)")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByLabel("Nombre")).toHaveValue("E2E Cliente inválido");

  await fillCreation(page, "E2E Cliente duplicado", emails.first.replace("cust", "CUST"));
  await expect(form.getByRole("alert")).toContainText("ya está en uso");
  await expect(form.getByLabel("Correo electrónico")).toHaveAttribute("aria-invalid", "true");
  expect(await countByEmailInsensitive(emails.first)).toBe(1);

  await ensureCustomer(page, emails.second, "E2E Cliente B");
});

test("edits only changed fields through the dialog and frees the previous email", async ({
  page,
}) => {
  await openDirectory(page);
  const before = await findCustomer(emails.first);
  if (!before) throw new Error("Customer fixture is missing.");

  let dialog = await openEditor(page, before.name);
  await dialog.getByLabel("Nombre").fill("E2E Cliente editado");
  await dialog.getByLabel("Teléfono (opcional)").fill("");
  await dialog.getByLabel("Teléfono (opcional)").press("Enter");
  await expect(directory(page).getByRole("status")).toHaveText(
    "Cliente E2E Cliente editado actualizado.",
  );
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Editar E2E Cliente editado", exact: true }),
  ).toBeFocused();

  const edited = await findCustomerById(before.id);
  expect(edited).toEqual({
    ...before,
    name: "E2E Cliente editado",
    phone: null,
  });

  dialog = await openEditor(page, "E2E Cliente editado");
  await dialog.getByLabel("Correo electrónico").fill(emails.renamed.toUpperCase());
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(directory(page).getByRole("status")).toHaveText(
    "Cliente E2E Cliente editado actualizado.",
  );
  await expect(customerRow(page, emails.renamed)).toBeVisible();
  expect((await findCustomerById(before.id)).email).toBe(emails.renamed);
  await findCustomer(emails.renamed);

  // The previous email is free again once no customer holds it.
  const reused = await ensureCustomer(page, emails.first, "E2E Cliente reutiliza correo");
  expect(reused.id).not.toBe(before.id);
});

test("rejects invalid and duplicate edits in place and confirms discarding changes", async ({
  page,
}) => {
  await openDirectory(page);
  const target = await findCustomer(emails.renamed);
  const owner = await findCustomer(emails.second);
  if (!target || !owner) throw new Error("Customer fixtures are missing.");

  const dialog = await openEditor(page, target.name);
  await dialog.getByLabel("Correo electrónico").fill("sin-arroba");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Revisa los campos indicados.");
  await expect(dialog.getByLabel("Correo electrónico")).toHaveAttribute("aria-invalid", "true");

  await dialog.getByLabel("Correo electrónico").fill(owner.email.toUpperCase());
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByRole("alert")).toContainText("ya está en uso");
  expect(await findCustomerById(target.id)).toEqual(target);

  page.once("dialog", (confirmation) => {
    expect(confirmation.message()).toBe("¿Descartar los cambios sin guardar?");
    void confirmation.dismiss();
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  page.once("dialog", (confirmation) => void confirmation.accept());
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  expect(await findCustomerById(target.id)).toEqual(target);
});

test("blocks Escape and duplicate submission while a save is in flight", async ({ page }) => {
  await openDirectory(page);
  const target = await findCustomer(emails.renamed);
  if (!target) throw new Error("Customer fixture is missing.");

  const dialog = await openEditor(page, target.name);
  let releaseSave: () => void = () => {};
  const saveReleased = new Promise<void>((resolveRelease) => {
    releaseSave = resolveRelease;
  });
  let heldRequests = 0;
  await page.route("**/dashboard/customers**", async (route) => {
    if (!isUpdateActionRequest(route.request())) return route.fallback();
    heldRequests += 1;
    await saveReleased;
    await route.continue();
  });

  await dialog.getByLabel("Teléfono (opcional)").fill("555 0101");
  await dialog.getByLabel("Teléfono (opcional)").press("Enter");
  await expect(dialog.getByText("Guardando cambios...")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Guardando..." })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Guardando..." }).click({ force: true });
  expect(heldRequests).toBe(1);

  releaseSave();
  await expect(dialog).toBeHidden();
  expect(heldRequests).toBe(1);
  expect((await findCustomerById(target.id)).phone).toBe("555 0101");
  await page.unrouteAll({ behavior: "wait" });
});

for (const [label, viewport] of [
  ["mobile", { width: 375, height: 667 }],
  ["desktop", { width: 1280, height: 720 }],
] as const) {
  test(`keeps Cancel before Save in DOM, keyboard, and layout with visible errors (${label})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openDirectory(page);
    const target = await findCustomer(emails.renamed);
    if (!target) throw new Error("Customer fixture is missing.");

    const dialog = await openEditor(page, target.name);
    await dialog.getByLabel("Correo electrónico").fill("x");
    await dialog.getByLabel("Teléfono (opcional)").fill("abc");
    await dialog.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();

    const save = dialog.getByRole("button", { name: "Guardar cambios" });
    const cancel = dialog.getByRole("button", { name: "Cancelar" });
    await dialog.getByLabel("Nombre").focus();
    const reached: string[] = [];
    for (let step = 0; step < 12 && reached.length < 2; step += 1) {
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
    expect(reached).toEqual(["cancel", "save"]);

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
    expect(await findCustomerById(target.id)).toEqual(target);
  });
}

test("soft-deletes a customer, keeps the confirmation and the sale, reserves the email, and marks the sale", async ({
  page,
}) => {
  await openDirectory(page);
  const victim = await ensureCustomer(page, emails.deleted, "E2E Cliente con venta");
  const sale = await pool.query<{ id: string }>(
    `INSERT INTO public."Sale" (id, "customerId", status, "saleDate", total, "updatedAt")
     VALUES (gen_random_uuid(), $1::uuid, 'COMPLETED'::"SaleStatus", now(), 1.00, now())
     RETURNING id::text`,
    [victim.id],
  );
  const saleId = sale.rows[0]?.id;
  if (!saleId) throw new Error("Sale fixture was not created.");
  const saleBefore = await pool.query(
    `SELECT id::text, "customerId"::text, status::text, total::text, "saleDate"::text
     FROM public."Sale" WHERE id = $1::uuid`,
    [saleId],
  );

  await page.goto("/dashboard/customers");
  page.once("dialog", (confirmation) => {
    expect(confirmation.message()).toContain("Sus ventas se conservan en el historial.");
    void confirmation.accept();
  });
  await customerRow(page, emails.deleted)
    .getByRole("button", { name: `Eliminar ${victim.name}` })
    .click();

  // Mutation persisted, refreshed directory no longer lists the customer,
  // and the confirmation is still visible afterwards.
  await expect(customerRow(page, emails.deleted)).toHaveCount(0);
  await expect
    .poll(async () => (await findCustomerById(victim.id)).deletedAt)
    .not.toBeNull();
  await expect(directory(page).getByText("Aplicando cambios...")).toBeHidden();
  await expect(directory(page).getByRole("status")).toHaveText(
    "Cliente eliminado del directorio. Sus ventas se conservan en el historial.",
  );

  const saleAfter = await pool.query(
    `SELECT id::text, "customerId"::text, status::text, total::text, "saleDate"::text
     FROM public."Sale" WHERE id = $1::uuid`,
    [saleId],
  );
  expect(saleAfter.rows).toEqual(saleBefore.rows);

  await fillCreation(page, "E2E Cliente reusa eliminado", emails.deleted.toUpperCase());
  await expect(creationForm(page).getByRole("alert")).toContainText("ya está en uso");
  expect(await countByEmailInsensitive(emails.deleted)).toBe(1);

  await page.goto(`/dashboard/sales?customerId=${victim.id}`);
  const saleRow = page.getByRole("table").getByRole("row").filter({ hasText: emails.deleted });
  await expect(saleRow).toHaveCount(1);
  await expect(saleRow).toContainText("E2E Cliente con venta");
  await expect(saleRow).toContainText("Cliente eliminado");
});

test("reports a customer deleted in another tab and does not write", async ({
  page,
  context,
}) => {
  await openDirectory(page);
  const victim = await findCustomer(emails.second);
  if (!victim) throw new Error("Customer fixture is missing.");
  const dialog = await openEditor(page, victim.name);

  const otherTab = await context.newPage();
  await otherTab.goto("/dashboard/customers");
  otherTab.once("dialog", (confirmation) => void confirmation.accept());
  await customerRow(otherTab, victim.email)
    .getByRole("button", { name: `Eliminar ${victim.name}` })
    .click();
  await expect(customerRow(otherTab, victim.email)).toHaveCount(0);
  await expect
    .poll(async () => (await findCustomerById(victim.id)).deletedAt)
    .not.toBeNull();
  await otherTab.close();

  await dialog.getByLabel("Nombre").fill("No debe guardarse");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "El cliente fue eliminado del directorio y no se puede modificar.",
  );
  await expect(dialog.getByLabel("Nombre")).toBeDisabled();
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toBeHidden();
  expect((await findCustomerById(victim.id)).name).toBe(victim.name);
});

test("keeps IDs unique and accessible references scoped while both forms show errors", async ({
  page,
}) => {
  await openDirectory(page);
  const target = await findCustomer(emails.renamed);
  if (!target) throw new Error("Customer fixture is missing.");

  await fillCreation(page, "E2E inválido", "x", "abc");
  await expect(creationForm(page).getByRole("alert")).toBeVisible();
  const dialog = await openEditor(page, target.name);
  await dialog.getByLabel("Correo electrónico").fill("x");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();

  const report = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    const creation = document.querySelector(
      'section[aria-labelledby="customer-creation-heading"]',
    );
    const edit = document.querySelector("dialog[open]");
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
      duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
      creation: describe(creation),
      edit: describe(edit),
    };
  });

  expect(report.duplicates).toEqual([]);
  expect(report.creation).toHaveLength(3);
  expect(report.edit).toHaveLength(3);
  for (const field of [...report.creation, ...report.edit]) {
    expect(field.labelInside, String(field.name)).toBe(true);
    expect(field.referencesInside, String(field.name)).toBe(true);
  }
  expect(report.creation.find(({ name }) => name === "email")).toMatchObject({
    invalid: "true",
    describedBy: ["customer-email-error"],
  });
  expect(report.edit.find(({ name }) => name === "email")).toMatchObject({
    invalid: "true",
    describedBy: ["customer-edit-email-error"],
  });

  page.once("dialog", (confirmation) => void confirmation.accept());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("rejects replayed update requests over HTTP without an authorized session", async ({
  page,
  baseURL,
}) => {
  const secret = process.env.PULSEMARKET_E2E_DISCLOSURE_TEST_SECRET;
  if (!secret || !baseURL) throw new Error("E2E HTTP replay setup is missing.");
  await openDirectory(page);
  const target = await findCustomer(emails.renamed);
  if (!target) throw new Error("Customer fixture is missing.");

  let captured: { url: string; headers: Record<string, string>; body: Buffer } | null =
    null;
  await page.route("**/dashboard/customers**", async (route) => {
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
  await dialog.getByLabel("Teléfono (opcional)").fill("555 0199");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(() => captured !== null).toBe(true);
  await page.unrouteAll({ behavior: "wait" });
  const replay = captured as unknown as {
    url: string;
    headers: Record<string, string>;
    body: Buffer;
  };
  const headers = {
    "content-type": replay.headers["content-type"],
    "next-action": replay.headers["next-action"],
    "next-router-state-tree": replay.headers["next-router-state-tree"] ?? "",
    accept: "text/x-component",
    origin: new URL(baseURL).origin,
  };
  const unchanged = await findCustomerById(target.id);

  const anonymous = await playwrightRequest.newContext({ baseURL });
  try {
    const response = await anonymous.post(replay.url, {
      headers,
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
      headers,
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
  expect(await findCustomerById(target.id)).toEqual(unchanged);

  // Positive control: the same request with the authorized session is valid.
  const authorized = await page.request.post(replay.url, {
    headers,
    data: replay.body,
    maxRedirects: 0,
  });
  expect(authorized.status()).toBe(200);
  expect((await findCustomerById(target.id)).phone).toBe("555 0199");
});
