import { expect, test } from "@playwright/test";

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
