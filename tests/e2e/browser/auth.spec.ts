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

test("redirects an unauthenticated dashboard request to login", async ({
  page,
}) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(
    page.getByRole("button", { name: "Continuar con OAuth simulado" }),
  ).toBeVisible();
});

test("denies an unapproved Google session and accepts no browser-supplied identity", async ({
  page,
}) => {
  const secret = process.env.PULSEMARKET_E2E_DISCLOSURE_TEST_SECRET;
  if (!secret) throw new Error("Missing E2E disclosure test secret.");
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
    page.getByRole("link", {
      name: "Consultar mi identificador Google para solicitar acceso",
    }),
  ).toBeVisible();

  const directRequest = await page.goto(
    `${GOOGLE_ACCOUNT_DISCLOSURE_PATH}?providerAccountId=someone-else`,
  );
  expect(directRequest?.status()).toBe(404);
  await expect(page.locator("body")).toHaveText(
    "No hay un identificador Google disponible.",
  );
});

test("discloses only the encrypted cookie identity once without creating a session", async ({
  page,
}) => {
  const secret = process.env.PULSEMARKET_E2E_DISCLOSURE_TEST_SECRET;
  if (!secret) throw new Error("Missing E2E disclosure test secret.");
  const providerAccountId = "e2e-google-account-subject";
  const token = await encode({
    token: {
      purpose: "google-account-disclosure",
      provider: "google",
      providerAccountId,
    },
    secret,
    salt: "pulsemarket-google-account-disclosure-v1",
    maxAge: 120,
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

  const disclosureResponse = await page.goto(GOOGLE_ACCOUNT_DISCLOSURE_PATH);
  expect(disclosureResponse?.status()).toBe(200);
  await expect(page.locator("body")).toHaveText(providerAccountId);
  await expect(page).toHaveURL(
    new RegExp(`${GOOGLE_ACCOUNT_DISCLOSURE_PATH}$`),
  );

  const replayResponse = await page.goto(GOOGLE_ACCOUNT_DISCLOSURE_PATH);
  expect(replayResponse?.status()).toBe(404);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
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
