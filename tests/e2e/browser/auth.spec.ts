import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";

const GOOGLE_ACCOUNT_DISCLOSURE_COOKIE =
  "pulsemarket-google-account-disclosure";
const GOOGLE_ACCOUNT_DISCLOSURE_PATH = "/api/auth/google-account-id";

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) {
    await page.goto("about:blank");
  }
});

async function authorizeWithLocalProvider(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.getByRole("button", { name: "Continuar con OAuth simulado" }).click();
  await expect(
    page.getByRole("heading", { name: "Proveedor OAuth simulado" }),
  ).toBeVisible();
}

test("shows the PulseMarket landing page to a visitor and links to login", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "PulseMarket" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "PulseMarket" })
      .getByText("Panel de gestión", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Iniciar sesión" }),
  ).toHaveAttribute("href", "/login");
  await expect(page.getByText("Deploy Now")).toHaveCount(0);
  await expect(page.getByText("Documentation")).toHaveCount(0);

  await page.getByRole("link", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "Continuar con OAuth simulado" }),
  ).toBeVisible();
});

test("redirects an unauthenticated dashboard request to login", async ({
  page,
}) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(
    page.getByRole("button", { name: "Continuar con OAuth simulado" }),
  ).toBeVisible();
});

const REQUEST_ACCESS_PATH = "/login/request-access";
const UNAVAILABLE_MESSAGE = "No pudimos recuperar tu identificador.";

function requestAccessCard(page: import("@playwright/test").Page) {
  return page.getByRole("region", { name: "Solicitar acceso" });
}

async function addDisclosureCookie(
  page: import("@playwright/test").Page,
  providerAccountId: string,
  maxAge: number,
): Promise<string> {
  const secret = process.env.PULSEMARKET_E2E_DISCLOSURE_TEST_SECRET;
  if (!secret) throw new Error("Missing E2E disclosure test secret.");
  const token = await encode({
    token: {
      purpose: "google-account-disclosure",
      provider: "google",
      providerAccountId,
    },
    secret,
    salt: "pulsemarket-google-account-disclosure-v1",
    maxAge,
  });
  await page.context().addCookies([
    {
      name: GOOGLE_ACCOUNT_DISCLOSURE_COOKIE,
      value: token,
      domain: "127.0.0.1",
      path: GOOGLE_ACCOUNT_DISCLOSURE_PATH,
      httpOnly: true,
      secure: false,
      sameSite: "Strict",
    },
  ]);
  return token;
}

async function disclosureCookieValue(
  page: import("@playwright/test").Page,
): Promise<string | undefined> {
  return (await page.context().cookies()).find(
    ({ name }) => name === GOOGLE_ACCOUNT_DISCLOSURE_COOKIE,
  )?.value;
}

test("denies an unapproved Google session and accepts no browser-supplied identity", async ({
  page,
  baseURL,
}) => {
  const secret = process.env.PULSEMARKET_E2E_DISCLOSURE_TEST_SECRET;
  if (!secret) throw new Error("Missing E2E disclosure test secret.");
  const appOrigin = new URL(baseURL!).origin;
  const sessionToken = await encode({
    token: {
      sub: "unapproved-google-user",
      provider: "google",
      providerAccountId: "unapproved-google-user",
    },
    secret,
  });
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?error=AccessDenied$/);
  await expect(
    page.getByText(
      "Puedes consultar tu identificador durante los próximos 2 minutos.",
      { exact: false },
    ),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: "Consultar mi identificador Google para solicitar acceso",
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`${REQUEST_ACCESS_PATH}$`));
  await expect(
    page.getByRole("heading", { name: "Solicitar acceso" }),
  ).toBeVisible();
  await expect(requestAccessCard(page).getByRole("alert")).toContainText(UNAVAILABLE_MESSAGE);
  await expect(
    page.getByRole("button", { name: "Reintentar con Google" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Volver al inicio de sesión" }),
  ).toHaveAttribute("href", "/login");

  const getRequest = await page.request.get(GOOGLE_ACCOUNT_DISCLOSURE_PATH);
  expect(getRequest.status()).toBe(405);
  const browserSuppliedIdentity = await page.request.post(
    `${GOOGLE_ACCOUNT_DISCLOSURE_PATH}?providerAccountId=someone-else`,
    {
      headers: { Origin: appOrigin },
      data: { providerAccountId: "someone-else" },
    },
  );
  expect(browserSuppliedIdentity.status()).toBe(404);
  expect(await browserSuppliedIdentity.json()).toEqual({
    error: "unavailable",
  });
});

test("rejects cross-origin and Origin-less disclosure requests without clearing the cookie", async ({
  page,
  baseURL,
}) => {
  const appOrigin = new URL(baseURL!).origin;
  const token = await addDisclosureCookie(
    page,
    "e2e-google-account-subject",
    120,
  );

  const rejectedHeaders: Record<string, string>[] = [
    { Origin: "https://attacker.example" },
    { Origin: "null" },
    { Origin: appOrigin, "Sec-Fetch-Site": "cross-site" },
    {},
  ];
  for (const headers of rejectedHeaders) {
    const response = await page.request.post(GOOGLE_ACCOUNT_DISCLOSURE_PATH, {
      headers,
    });
    expect(response.status(), JSON.stringify(headers)).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(
      response
        .headersArray()
        .some(({ name }) => name.toLowerCase() === "set-cookie"),
    ).toBe(false);
    expect(await disclosureCookieValue(page)).toBe(token);
  }
});

test("shows the cookie identity in the request access card without creating a session", async ({
  page,
  baseURL,
}) => {
  const providerAccountId = "e2e-google-account-subject";
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(baseURL!).origin,
    });
  await addDisclosureCookie(page, providerAccountId, 120);
  const disclosureRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === GOOGLE_ACCOUNT_DISCLOSURE_PATH) {
      disclosureRequests.push(request.method());
    }
  });

  await page.goto(REQUEST_ACCESS_PATH);
  await expect(page.getByText(providerAccountId, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${REQUEST_ACCESS_PATH}$`));
  expect(disclosureRequests).toEqual(["POST"]);
  expect(await disclosureCookieValue(page)).toBeUndefined();

  await page.getByRole("button", { name: "Copiar identificador" }).click();
  await expect(requestAccessCard(page).getByRole("status")).toHaveText("Identificador copiado.");
  expect(
    await page.evaluate(() => navigator.clipboard.readText()),
  ).toBe(providerAccountId);
  const storedValues = await page.evaluate(() =>
    JSON.stringify([
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ]),
  );
  expect(storedValues).not.toContain(providerAccountId);

  await page.reload();
  await expect(requestAccessCard(page).getByRole("alert")).toContainText(UNAVAILABLE_MESSAGE);
  await expect(page.getByText(providerAccountId)).toHaveCount(0);

  const cookies = await page.context().cookies();
  expect(
    cookies.some(({ name }) => name === "next-auth.session-token"),
  ).toBe(false);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
});

test("shows the unavailable state for an expired disclosure credential", async ({
  page,
}) => {
  const providerAccountId = "e2e-expired-google-account-subject";
  // Signed correctly but expired 60s ago, beyond the 15s decode tolerance.
  await addDisclosureCookie(page, providerAccountId, -60);

  await page.goto(REQUEST_ACCESS_PATH);
  await expect(requestAccessCard(page).getByRole("alert")).toContainText(UNAVAILABLE_MESSAGE);
  await expect(requestAccessCard(page).getByRole("alert")).not.toContainText(
    "No pudimos completar la consulta.",
  );
  await expect(page.getByText(providerAccountId)).toHaveCount(0);
  expect(await disclosureCookieValue(page)).toBeUndefined();
});

test("separates network, 403, and server failures from the unavailable credential state without retrying", async ({
  page,
}) => {
  const scenarios: {
    name: string;
    handle: (route: import("@playwright/test").Route) => Promise<void>;
  }[] = [
    { name: "network", handle: (route) => route.abort("failed") },
    {
      name: "403",
      handle: (route) =>
        route.fulfill({ status: 403, json: { error: "forbidden" } }),
    },
    {
      name: "500",
      handle: (route) => route.fulfill({ status: 500, body: "" }),
    },
    {
      name: "502",
      handle: (route) => route.fulfill({ status: 502, body: "Bad gateway" }),
    },
    {
      name: "malformed 200",
      handle: (route) => route.fulfill({ status: 200, json: { unexpected: 1 } }),
    },
  ];

  for (const scenario of scenarios) {
    let posts = 0;
    await page.route(`**${GOOGLE_ACCOUNT_DISCLOSURE_PATH}`, async (route) => {
      if (route.request().method() === "POST") posts += 1;
      await scenario.handle(route);
    });

    await page.goto(REQUEST_ACCESS_PATH);
    const alert = requestAccessCard(page).getByRole("alert");
    await expect(alert, scenario.name).toContainText(
      "No pudimos completar la consulta.",
    );
    await expect(alert).toContainText(
      "Vuelve al inicio de sesión e inténtalo de nuevo.",
    );
    await expect(alert).not.toContainText(UNAVAILABLE_MESSAGE);
    await expect(alert).not.toContainText("caducado");
    await page.waitForLoadState("networkidle");
    expect(posts, scenario.name).toBe(1);
    await expect(
      page.getByRole("link", { name: "Volver al inicio de sesión" }),
    ).toHaveAttribute("href", "/login");

    await page.unrouteAll({ behavior: "wait" });
  }
});

test("renders a generic login error without reflecting arbitrary provider text", async ({
  page,
}) => {
  await page.goto("/login?error=token-secret-provider-detail");

  const error = page.getByText(
    "No se pudo completar el inicio de sesión. Inténtalo de nuevo.",
    { exact: true },
  );
  await expect(error).toHaveAttribute("role", "alert");
  await expect(page.getByText("token-secret-provider-detail")).toHaveCount(0);
});

test("completes local OAuth through NextAuth and opens the protected product list", async ({
  page,
}) => {
  await page.goto("/login");
  await authorizeWithLocalProvider(page);
  await page.getByRole("button", { name: "Autorizar PulseMarket" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("banner").getByText("E2E Test User"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Productos" }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/products/);
  await expect(
    page.getByRole("heading", { name: "Crear producto" }),
  ).toBeVisible();
});

test("shows a generic accessible error after provider denial and creates no session", async ({
  page,
}) => {
  await page.goto("/login");
  await authorizeWithLocalProvider(page);
  await page.getByRole("button", { name: "Denegar acceso" }).click();

  const error = page.getByText(
    "No se pudo completar el inicio de sesión. Inténtalo de nuevo.",
    { exact: true },
  );
  await expect(error).toHaveAttribute("role", "alert");
  await expect(error).toHaveText(
    "No se pudo completar el inicio de sesión. Inténtalo de nuevo.",
  );
  await expect(page).not.toHaveURL(/access_denied|secret|token/i);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
});

test("sign out prevents dashboard access after reload", async ({ page }) => {
  await page.goto("/login");
  await authorizeWithLocalProvider(page);
  await page.getByRole("button", { name: "Autorizar PulseMarket" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await page.reload();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
});
