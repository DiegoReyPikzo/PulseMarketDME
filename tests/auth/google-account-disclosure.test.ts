import assert from "node:assert/strict";
import { test } from "node:test";

import { encode } from "next-auth/jwt";

import {
  consumeGoogleAccountDisclosureToken,
  createGoogleAccountDisclosureToken,
  GOOGLE_ACCOUNT_DISCLOSURE_COOKIE,
  GOOGLE_ACCOUNT_DISCLOSURE_MAX_AGE_SECONDS,
  GOOGLE_ACCOUNT_DISCLOSURE_PATH,
  googleAccountDisclosureCookieOptions,
} from "../../lib/google-account-disclosure";

const secret = "test-only-auth-secret";

test("creates a short-lived encrypted disclosure only for a Google identity", async () => {
  const token = await createGoogleAccountDisclosureToken(
    { provider: "google", providerAccountId: "stable-google-sub" },
    secret,
  );
  assert.ok(token);
  assert.equal(GOOGLE_ACCOUNT_DISCLOSURE_MAX_AGE_SECONDS, 120);

  let cleared = false;
  assert.equal(
    await consumeGoogleAccountDisclosureToken(token, secret, () => {
      cleared = true;
    }),
    "stable-google-sub",
  );
  assert.equal(cleared, true);
  assert.equal(
    await createGoogleAccountDisclosureToken(
      { provider: "github", providerAccountId: "github-id" },
      secret,
    ),
    null,
  );
  assert.equal(
    await createGoogleAccountDisclosureToken(
      { provider: "google", providerAccountId: " padded " },
      secret,
    ),
    null,
  );
});

test("rejects tampered, wrongly signed, malformed, and wrong-purpose tokens", async () => {
  const valid = await createGoogleAccountDisclosureToken(
    { provider: "google", providerAccountId: "stable-google-sub" },
    secret,
  );
  assert.ok(valid);
  const tampered =
    `${valid[0] === "A" ? "B" : "A"}${valid.slice(1)}`;

  for (const token of [
    tampered,
    await encode({
      token: {
        purpose: "google-account-disclosure",
        provider: "google",
        providerAccountId: "expired-sub",
      },
      secret,
      salt: "pulsemarket-google-account-disclosure-v1",
      maxAge: -20,
    }),
    await encode({
      token: {
        purpose: "google-account-disclosure",
        provider: "github",
        providerAccountId: "github-id",
      },
      secret,
      salt: "pulsemarket-google-account-disclosure-v1",
      maxAge: 120,
    }),
    await encode({
      token: {
        purpose: "not-google-account-disclosure",
        provider: "google",
        providerAccountId: "stable-google-sub",
      },
      secret,
      salt: "pulsemarket-google-account-disclosure-v1",
      maxAge: 120,
    }),
    "not-a-token",
  ]) {
    assert.equal(
      await consumeGoogleAccountDisclosureToken(token, secret, () => {}),
      null,
    );
  }
});

test("scopes the disclosure cookie to the disclosure endpoint path with strict, short-lived attributes", () => {
  const options = googleAccountDisclosureCookieOptions(true);
  assert.equal(GOOGLE_ACCOUNT_DISCLOSURE_COOKIE, "pulsemarket-google-account-disclosure");
  assert.equal(options.path, GOOGLE_ACCOUNT_DISCLOSURE_PATH);
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "strict");
  assert.equal(options.maxAge, 120);
  assert.equal(googleAccountDisclosureCookieOptions(false).secure, false);
});
