import "server-only";

import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";

import { assertAuthConfiguration } from "./auth-config";
import { isAuthorizedProviderIdentity } from "./auth-authorization";
import { authOptions } from "./auth";
import { requireAuthorizedSession } from "./require-authenticated-session";

export async function getAuthenticatedSession(): Promise<Session> {
  assertAuthConfiguration();
  const session = await getServerSession(authOptions);

  return requireAuthorizedSession(
    session,
    (authenticated) =>
      Boolean(
        authenticated.user?.provider &&
          authenticated.user.providerAccountId &&
          isAuthorizedProviderIdentity({
            provider: authenticated.user.provider,
            providerAccountId: authenticated.user.providerAccountId,
            e2eRunId:
              authenticated.user.provider === "local-oauth"
                ? process.env.PULSEMARKET_E2E_RUN_ID
                : undefined,
          }),
      ),
    () => redirect("/login"),
    () => redirect("/login?error=AccessDenied"),
  );
}
