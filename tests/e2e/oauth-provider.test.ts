import assert from "node:assert/strict";
import { afterAll, test } from "vitest";

import { startE2eOAuthProvider } from "../../scripts/e2e-oauth-provider";

const callbackUrl = "http://127.0.0.1:4317/api/auth/callback/local-oauth";
const clientId = "local-client-id";
const clientSecret = "local-test-secret";
const simulatorPromise = startE2eOAuthProvider({
  callbackUrl,
  clientId,
  clientSecret,
  subject: "test-run-subject",
});

afterAll(async () => {
  const simulator = await simulatorPromise;
  await simulator.close();
});

test("serves an approval page and completes a one-time OAuth code exchange", async () => {
  const simulator = await simulatorPromise;
  const authorizationUrl = new URL("/authorize", simulator.origin);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    state: "state-value-with-enough-length",
    scope: "profile email",
  }).toString();

  const authorization = await fetch(authorizationUrl);
  assert.equal(authorization.status, 200);
  assert.match(await authorization.text(), /Autorizar PulseMarket/);

  const decision = await fetch(`${simulator.origin}/decision`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      clientId,
      redirectUri: callbackUrl,
      state: "state-value-with-enough-length",
      decision: "approve",
    }),
    redirect: "manual",
  });
  assert.equal(decision.status, 302);
  const callback = new URL(decision.headers.get("location")!);
  assert.equal(callback.origin, new URL(callbackUrl).origin);
  assert.equal(callback.pathname, new URL(callbackUrl).pathname);
  assert.equal(callback.searchParams.get("state"), "state-value-with-enough-length");

  const code = callback.searchParams.get("code");
  assert.ok(code);
  const token = await fetch(`${simulator.origin}/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
    }),
  });
  assert.equal(token.status, 200);
  const tokenSet = (await token.json()) as { access_token: string };
  assert.ok(tokenSet.access_token);

  const profile = await fetch(`${simulator.origin}/userinfo`, {
    headers: { authorization: `Bearer ${tokenSet.access_token}` },
  });
  assert.equal(profile.status, 200);
  assert.deepEqual(await profile.json(), {
    sub: "test-run-subject",
    name: "E2E Test User",
    email: "e2e-user@example.test",
  });
});

test("returns an OAuth access-denied callback without issuing a code", async () => {
  const simulator = await simulatorPromise;
  const response = await fetch(`${simulator.origin}/decision`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      clientId,
      redirectUri: callbackUrl,
      state: "state-value-with-enough-length",
      decision: "deny",
    }),
    redirect: "manual",
  });

  assert.equal(response.status, 302);
  const callback = new URL(response.headers.get("location")!);
  assert.equal(callback.searchParams.get("error"), "access_denied");
  assert.equal(callback.searchParams.get("state"), "state-value-with-enough-length");
  assert.equal(callback.searchParams.has("code"), false);
});
