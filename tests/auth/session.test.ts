import assert from "node:assert/strict";
import { test } from "node:test";

import type { Session } from "next-auth";

import { assertAuthConfiguration } from "../../lib/auth-config";
import { requireAuthenticatedSession } from "../../lib/require-authenticated-session";

const authenticatedSession: Session = {
  expires: "2026-10-18T00:00:00.000Z",
  user: {
    name: "GitHub User",
    email: "user@example.test",
    image: "https://avatars.example.test/user.png",
  },
};

test("returns the verified session for an authenticated request", () => {
  const session = requireAuthenticatedSession(authenticatedSession, () => {
    throw new Error("Unexpected unauthenticated redirect.");
  });

  assert.equal(session, authenticatedSession);
});

test("invokes the redirect path when the session is absent", () => {
  assert.throws(
    () =>
      requireAuthenticatedSession(null, () => {
        throw new Error("Redirected to /login.");
      }),
    { message: "Redirected to /login." },
  );
});

test("requires the documented OAuth and session environment variables", () => {
  assert.throws(
    () => assertAuthConfiguration({}),
    {
      message:
        "Missing required authentication environment variables: GITHUB_ID, GITHUB_SECRET, NEXTAUTH_SECRET, NEXTAUTH_URL.",
    },
  );
});

test("accepts a fully configured authentication environment", () => {
  assert.doesNotThrow(() =>
    assertAuthConfiguration({
      GITHUB_ID: "placeholder-client-id",
      GITHUB_SECRET: "placeholder-client-secret",
      NEXTAUTH_SECRET: "placeholder-session-secret",
      NEXTAUTH_URL: "http://localhost:3000",
    }),
  );
});
