import assert from "node:assert/strict";
import { test } from "node:test";

import type { Session } from "next-auth";

import { isAuthorizedProviderIdentity } from "../../lib/auth-authorization";
import { assertAuthConfiguration } from "../../lib/auth-config";
import {
  requireAuthenticatedSession,
  requireAuthorizedSession,
} from "../../lib/require-authenticated-session";

const authenticatedSession: Session = {
  expires: "2026-10-18T00:00:00.000Z",
  user: {
    name: "GitHub User",
    email: "user@example.test",
    image: "https://avatars.example.test/user.png",
    provider: "github",
    providerAccountId: "12345",
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
    /Configuración de autenticación incompleta: NEXTAUTH_SECRET, NEXTAUTH_URL, GITHUB_ID\/GITHUB_SECRET or GOOGLE_CLIENT_ID\/GOOGLE_CLIENT_SECRET/,
  );
});

test("accepts a fully configured authentication environment", () => {
  assert.doesNotThrow(() =>
    assertAuthConfiguration({
      GITHUB_ID: "placeholder-client-id",
      GITHUB_SECRET: "placeholder-client-secret",
      NEXTAUTH_SECRET: "placeholder-session-secret",
      NEXTAUTH_URL: "http://localhost:3000",
      PULSEMARKET_AUTHORIZED_ACCOUNTS: "[]",
    }),
  );
});

test("allows an account only when its exact provider identity is listed", () => {
  const environment = {
    PULSEMARKET_AUTHORIZED_ACCOUNTS: JSON.stringify([
      { provider: "github", providerAccountId: "12345" },
    ]),
  };
  assert.equal(
    isAuthorizedProviderIdentity(
      { provider: "github", providerAccountId: "12345" },
      environment,
    ),
    true,
  );
  assert.equal(
    isAuthorizedProviderIdentity(
      { provider: "github", providerAccountId: "another-id" },
      environment,
    ),
    false,
  );
});

test("denies absent, empty, and malformed authorization lists", () => {
  const identity = { provider: "github", providerAccountId: "12345" };
  assert.equal(isAuthorizedProviderIdentity(identity, {}), false);
  assert.equal(
    isAuthorizedProviderIdentity(identity, {
      PULSEMARKET_AUTHORIZED_ACCOUNTS: "[]",
    }),
    false,
  );
  assert.equal(
    isAuthorizedProviderIdentity(identity, {
      PULSEMARKET_AUTHORIZED_ACCOUNTS: "{malformed",
    }),
    false,
  );
});

test("denies legacy sessions without provider identity", () => {
  const legacySession: Session = {
    expires: authenticatedSession.expires,
    user: { name: "Old session" },
  };
  assert.throws(
    () =>
      requireAuthorizedSession(
        legacySession,
        (session) =>
          Boolean(
            session.user?.provider && session.user.providerAccountId,
          ),
        () => {
          throw new Error("Unauthenticated.");
        },
        () => {
          throw new Error("Access denied.");
        },
      ),
    { message: "Access denied." },
  );
});

test("revokes an existing identity when it is removed from the live list", () => {
  const environment = {
    PULSEMARKET_AUTHORIZED_ACCOUNTS: JSON.stringify([
      { provider: "github", providerAccountId: "12345" },
    ]),
  };
  const identity = {
    provider: "github",
    providerAccountId: "12345",
  };
  assert.equal(isAuthorizedProviderIdentity(identity, environment), true);
  environment.PULSEMARKET_AUTHORIZED_ACCOUNTS = "[]";
  assert.equal(isAuthorizedProviderIdentity(identity, environment), false);
});

test("refuses the simulated provider in production", () => {
  assert.equal(
    isAuthorizedProviderIdentity(
      {
        provider: "local-oauth",
        providerAccountId: "r".repeat(43),
        e2eRunId: "r".repeat(43),
      },
      {
        NODE_ENV: "production",
        PULSEMARKET_E2E_RUN_ID: "r".repeat(43),
      },
    ),
    false,
  );
});
