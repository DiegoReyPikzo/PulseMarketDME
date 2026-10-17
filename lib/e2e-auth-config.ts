import {
  connectionStringWithStrictTls,
  validateE2eConfiguration,
  type E2eConfiguration,
} from "./e2e-environment";

export const E2E_AUTH_PROVIDER_ID = "local-oauth";

const E2E_AUTH_KEYS = [
  "PULSEMARKET_E2E_RUN_ID",
  "E2E_AUTH_PROVIDER_ORIGIN",
  "E2E_AUTH_CLIENT_ID",
  "E2E_AUTH_CLIENT_SECRET",
  "PULSEMARKET_E2E_GOOGLE_DENIAL",
] as const;

export type E2eAuthConfiguration = {
  database: E2eConfiguration;
  providerOrigin: URL;
  clientId: string;
  clientSecret: string;
  runId: string;
  nextAuthUrl: URL;
  googleDenial: boolean;
};

function isLoopbackHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      !url.port
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function getE2eAuthConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): E2eAuthConfiguration | null {
  const hasE2eAuthSetting = E2E_AUTH_KEYS.some(
    (key) => environment[key] !== undefined,
  );
  if (!hasE2eAuthSetting) return null;

  if (environment.NODE_ENV === "production") {
    throw new Error("The local E2E OAuth provider is forbidden in production.");
  }

  const runId = environment.PULSEMARKET_E2E_RUN_ID;
  const clientId = environment.E2E_AUTH_CLIENT_ID;
  const clientSecret = environment.E2E_AUTH_CLIENT_SECRET;
  const providerOriginValue = environment.E2E_AUTH_PROVIDER_ORIGIN;
  const authSecret = environment.NEXTAUTH_SECRET;
  const nextAuthUrlValue = environment.NEXTAUTH_URL;
  const googleDenialValue = environment.PULSEMARKET_E2E_GOOGLE_DENIAL;
  if (
    !runId ||
    !/^[A-Za-z0-9_-]{43}$/.test(runId) ||
    !clientId ||
    clientId.length < 32 ||
    !clientSecret ||
    clientSecret.length < 43 ||
    !authSecret ||
    authSecret.length < 43 ||
    (googleDenialValue !== undefined && googleDenialValue !== "true")
  ) {
    throw new Error("The local E2E OAuth configuration is incomplete.");
  }

  const providerOrigin = providerOriginValue
    ? isLoopbackHttpUrl(providerOriginValue)
    : null;
  const nextAuthUrl = nextAuthUrlValue
    ? isLoopbackHttpUrl(nextAuthUrlValue)
    : null;
  if (!providerOrigin || !nextAuthUrl) {
    throw new Error("The local E2E OAuth services must use HTTP loopback URLs.");
  }

  let database: E2eConfiguration;
  try {
    database = validateE2eConfiguration(
      environment,
      environment,
    );
  } catch {
    throw new Error(
      "The local E2E OAuth provider requires a valid independently approved E2E database target.",
    );
  }

  if (
    environment.DATABASE_URL !==
      connectionStringWithStrictTls(database.pooled) ||
    environment.DIRECT_URL !==
      connectionStringWithStrictTls(database.direct)
  ) {
    throw new Error(
      "The local E2E OAuth provider requires isolated E2E database connections.",
    );
  }

  return {
    database,
    providerOrigin,
    clientId,
    clientSecret,
    runId,
    nextAuthUrl,
    googleDenial: googleDenialValue === "true",
  };
}
