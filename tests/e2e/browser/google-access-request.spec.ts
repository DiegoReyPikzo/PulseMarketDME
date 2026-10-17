import { expect, test } from "@playwright/test";

const DISCLOSURE_COOKIE = "pulsemarket-google-account-disclosure";
const DISCLOSURE_PATH = "/api/auth/google-account-id";
const SIMULATED_GOOGLE_SUBJECT = "e2e-google-denial-subject";

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) {
    await page.goto("about:blank");
  }
});

test("denied Google OAuth callback shows the identifier in the request access card and clears the browser cookie, without a session", async ({
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
  await expect(
    page.getByText(
      "Puedes consultar tu identificador durante los próximos 2 minutos.",
      { exact: false },
    ),
  ).toBeVisible();
  const requestLink = page.getByRole("link", {
    name: "Consultar mi identificador Google para solicitar acceso",
  });
  await expect(requestLink).toBeVisible();
  await requestLink.hover();
  await page.waitForLoadState("networkidle");
  expect(disclosureResponses).toEqual([]);

  const disclosureResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === DISCLOSURE_PATH,
  );
  await requestLink.click();
  const disclosureResponse = await disclosureResponsePromise;
  expect(disclosureResponse.request().method()).toBe("POST");
  expect(disclosureResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/login\/request-access$/);
  const card = page.getByRole("region", { name: "Solicitar acceso" });
  await expect(
    card.getByText(SIMULATED_GOOGLE_SUBJECT, { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Copiar identificador" }),
  ).toBeVisible();
  expect(disclosureResponses).toEqual([200]);

  await page.reload();
  await expect(card.getByRole("alert")).toContainText(
    "No pudimos recuperar tu identificador.",
  );
  await expect(card.getByText(SIMULATED_GOOGLE_SUBJECT)).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Reintentar con Google" }),
  ).toBeVisible();
  expect(disclosureResponses).toEqual([200, 404]);

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
