import assert from "node:assert/strict";
import { test } from "vitest";

import type { Session } from "next-auth";

import { isAuthorizedProviderIdentity } from "../../lib/auth-authorization";
import {
  requireAuthorizedSession,
} from "../../lib/require-authenticated-session";

const session: Session = {
  expires: "2026-10-18T00:00:00.000Z",
  user: {
    name: "Display name is not used for authorization",
    email: "unverified@example.test",
    provider: "github",
    providerAccountId: "987654321",
  },
};

test("permits the authorized identity and denies another provider/account pair", () => {
  const environment = {
    PULSEMARKET_AUTHORIZED_ACCOUNTS: JSON.stringify([
      { provider: "github", providerAccountId: "987654321" },
    ]),
  };
  const authorized = isAuthorizedProviderIdentity(
    { provider: "github", providerAccountId: "987654321" },
    environment,
  );

  assert.equal(
    requireAuthorizedSession(
      session,
      () => authorized,
      () => {
        throw new Error("Unauthenticated.");
      },
      () => {
        throw new Error("Access denied.");
      },
    ),
    session,
  );

  assert.throws(
    () =>
      requireAuthorizedSession(
        session,
        () =>
          isAuthorizedProviderIdentity(
            { provider: "google", providerAccountId: "987654321" },
            environment,
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

test("revalidates the current allowlist before a protected operation", () => {
  let operationReached = false;
  const environment = {
    PULSEMARKET_AUTHORIZED_ACCOUNTS: JSON.stringify([
      { provider: "github", providerAccountId: "987654321" },
    ]),
  };
  const runProtectedOperation = () => {
    requireAuthorizedSession(
      session,
      (currentSession) =>
        isAuthorizedProviderIdentity(
          {
            provider: currentSession.user?.provider ?? "",
            providerAccountId:
              currentSession.user?.providerAccountId ?? "",
          },
          environment,
        ),
      () => {
        throw new Error("Unauthenticated.");
      },
      () => {
        throw new Error("Access denied.");
      },
    );
    operationReached = true;
  };

  runProtectedOperation();
  assert.equal(operationReached, true);
  operationReached = false;
  environment.PULSEMARKET_AUTHORIZED_ACCOUNTS = "[]";
  assert.throws(runProtectedOperation, { message: "Access denied." });
  assert.equal(operationReached, false);
});

test("denies a session with no stable identity even when its display data matches", () => {
  const legacySession: Session = {
    expires: session.expires,
    user: { name: session.user?.name, email: session.user?.email },
  };
  assert.throws(
    () =>
      requireAuthorizedSession(
        legacySession,
        (currentSession) =>
          Boolean(
            currentSession.user?.provider &&
              currentSession.user.providerAccountId,
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
