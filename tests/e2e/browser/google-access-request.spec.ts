import { expect, test } from "@playwright/test";

const DISCLOSURE_COOKIE = "pulsemarket-google-account-disclosure";
const DISCLOSURE_PATH = "/api/auth/google-account-id";
const SIMULATED_GOOGLE_SUBJECT = "e2e-google-denial-subject";

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) {
    await page.goto("about:blank");
  }
});

test("denied Google OAuth callback issues an identity disclosure cookie the browser clears after first view, without a session", async ({
  page,
}) => {
  const disclosureResponses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === DISCLOSURE_PATH) {
      disclosureResponses.push(response.status());
    }
  });
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: "Continuar con Google (simulado para pruebas)",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Proveedor OAuth simulado" }),
  ).toBeVisible();

  const callbackResponsePromise = page.waitForResponse((response) => {
    const callback = new URL(response.url());
    return (
      callback.pathname === "/api/auth/callback/google" &&
      callback.searchParams.has("code")
    );
  });
  await page.getByRole("button", { name: "Autorizar PulseMarket" }).click();
  const callbackResponse = await callbackResponsePromise;

  const callbackCookies = (await callbackResponse.headersArray())
    .filter(({ name }) => name.toLowerCase() === "set-cookie")
    .map(({ value }) => value);
  expect(
    callbackCookies.some((value) => value.includes(DISCLOSURE_COOKIE)),
  ).toBe(true);
  await expect(page).toHaveURL(/\/login\?error=AccessDenied$/);
  const disclosureCookie = (await page.context().cookies()).find(
    ({ name }) => name === DISCLOSURE_COOKIE,
  );
  expect(disclosureCookie).toBeDefined();
  expect(disclosureCookie?.path).toBe(DISCLOSURE_PATH);
  expect(disclosureCookie?.httpOnly).toBe(true);
  const requestLink = page.getByRole("link", {
    name: "Consultar mi identificador Google para solicitar acceso",
  });
  await expect(requestLink).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(disclosureResponses).toEqual([]);

  const disclosureResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === DISCLOSURE_PATH,
  );
  await requestLink.click();
  const disclosureResponse = await disclosureResponsePromise;
  expect(disclosureResponse.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`${DISCLOSURE_PATH}$`));
  await expect(page.locator("body")).toHaveText(SIMULATED_GOOGLE_SUBJECT);

  const afterCookieCleared = await page.goto(DISCLOSURE_PATH);
  expect(afterCookieCleared?.status()).toBe(404);
  await expect(page.locator("body")).toHaveText(
    "No hay un identificador Google disponible.",
  );

  const cookies = await page.context().cookies();
  expect(
    cookies.some(
      ({ name }) =>
        name === "next-auth.session-token" ||
        name === "__Secure-next-auth.session-token",
    ),
  ).toBe(false);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
});
