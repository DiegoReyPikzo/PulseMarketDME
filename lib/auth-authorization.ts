import "server-only";

import { isListedProviderIdentity } from "./authorized-accounts";
import { E2E_AUTH_PROVIDER_ID, getE2eAuthConfiguration } from "./e2e-auth-config";

export type AuthenticatedProviderIdentity = {
  provider: string;
  providerAccountId: string;
  e2eRunId?: string;
};

export function isAuthorizedProviderIdentity(
  identity: AuthenticatedProviderIdentity,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (identity.provider === E2E_AUTH_PROVIDER_ID) {
    if (environment.NODE_ENV === "production") return false;
    const e2e = getE2eAuthConfiguration(environment);
    return Boolean(
      e2e &&
        identity.e2eRunId === e2e.runId &&
        identity.providerAccountId === e2e.runId,
    );
  }

  return isListedProviderIdentity(
    identity.provider,
    identity.providerAccountId,
    environment.PULSEMARKET_AUTHORIZED_ACCOUNTS,
  );
}
