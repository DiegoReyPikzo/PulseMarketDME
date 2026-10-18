import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";

import { PRODUCTION_TARGET_FILE } from "./production-environment";

// Guard for the v2 sample-data seed. It runs before any database client is
// created and only accepts an explicitly confirmed Neon host that is neither
// the approved Production endpoint nor the isolated E2E endpoint used by CI.
// Errors name keys and files only, never connection strings or credentials.

// The same operator-only, Git-ignored target files the Production (`prod:db`)
// and E2E (`e2e:with-env`) tooling read. They hold host names, not secrets.
export const E2E_TARGET_FILE = ".env.e2e.target.local";
export { PRODUCTION_TARGET_FILE };

// Must equal the host of DATABASE_URL, so the operator types the target on
// purpose instead of inheriting whatever `.env` provides.
export const SEED_TARGET_HOST_KEY = "PULSEMARKET_SEED_TARGET_HOST";

const ALLOWED_QUERY_PARAMETERS = new Set([
  "sslmode",
  "channel_binding",
  "connect_timeout",
]);

const NEON_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/;

export class SeedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedTargetError";
  }
}

export type SeedTarget = {
  // Returned for the database client only; never print it.
  connectionString: string;
  host: string;
  endpointId: string;
};

type Values = Readonly<Record<string, string | undefined>>;

// Neon pooled hosts add `-pooler` to the endpoint label; both forms reach
// the same endpoint and database.
function endpointHost(host: string): string {
  return host.replace(/^([^.]+)-pooler(?=\.)/, "$1");
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function protectedEndpoints(
  values: Values | undefined,
  directKey: string,
  pooledKey: string,
  source: string,
): string[] {
  const direct = values?.[directKey]?.trim().toLowerCase();
  const pooled = values?.[pooledKey]?.trim().toLowerCase();
  if (!direct || !pooled) {
    throw new SeedTargetError(
      `Cannot rule out the ${source} database: ${directKey} and ${pooledKey} are required in ${
        source === "Production" ? PRODUCTION_TARGET_FILE : E2E_TARGET_FILE
      }.`,
    );
  }
  if (!NEON_HOST.test(direct) || !NEON_HOST.test(pooled)) {
    throw new SeedTargetError(
      `Cannot rule out the ${source} database: ${directKey} and ${pooledKey} must be Neon host names.`,
    );
  }
  return [endpointHost(direct), endpointHost(pooled)];
}

function parseDatabaseUrl(value: string | undefined): URL {
  if (!value?.trim()) {
    throw new SeedTargetError("DATABASE_URL must be set.");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SeedTargetError("DATABASE_URL is not a valid PostgreSQL URL.");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    !url.pathname ||
    url.pathname === "/" ||
    (url.port !== "" && url.port !== "5432")
  ) {
    throw new SeedTargetError("DATABASE_URL is not a complete PostgreSQL URL.");
  }
  // Parameters such as `host`, `hostaddr` or `options` could redirect the
  // connection after the host check.
  const unexpected = [...url.searchParams.keys()].filter(
    (key) => !ALLOWED_QUERY_PARAMETERS.has(key),
  );
  if (unexpected.length > 0) {
    throw new SeedTargetError(
      `DATABASE_URL has unsupported query parameters: ${[...new Set(unexpected)].join(", ")}.`,
    );
  }
  return url;
}

export function validateSeedTarget({
  environment,
  productionTarget,
  e2eTarget,
}: {
  environment: Values;
  productionTarget: Values | undefined;
  e2eTarget: Values | undefined;
}): SeedTarget {
  if (hasValue(environment.CI) || hasValue(environment.GITHUB_ACTIONS)) {
    throw new SeedTargetError("The sample-data seed does not run in CI.");
  }
  if (hasValue(environment.PULSEMARKET_DB_TARGET_KIND)) {
    throw new SeedTargetError(
      "The sample-data seed does not run inside the production database wrapper.",
    );
  }
  const e2eVariables = Object.keys(environment).filter(
    (key) =>
      (key.toUpperCase().startsWith("E2E_") ||
        key.toUpperCase().startsWith("PULSEMARKET_E2E_")) &&
      hasValue(environment[key]),
  );
  if (e2eVariables.length > 0) {
    throw new SeedTargetError(
      "The sample-data seed does not run with E2E environment variables set.",
    );
  }

  const production = protectedEndpoints(
    productionTarget,
    "PROD_ALLOWED_DIRECT_HOST",
    "PROD_ALLOWED_POOLED_HOST",
    "Production",
  );
  const e2e = protectedEndpoints(
    e2eTarget,
    "E2E_ALLOWED_DIRECT_HOST",
    "E2E_ALLOWED_POOLED_HOST",
    "E2E",
  );

  const url = parseDatabaseUrl(environment.DATABASE_URL);
  const host = url.hostname.toLowerCase();
  if (!NEON_HOST.test(host)) {
    throw new SeedTargetError("DATABASE_URL must point to a Neon host.");
  }
  const confirmedHost = environment[SEED_TARGET_HOST_KEY]?.trim().toLowerCase();
  if (!confirmedHost) {
    throw new SeedTargetError(`${SEED_TARGET_HOST_KEY} must be set to the DATABASE_URL host.`);
  }
  if (confirmedHost !== host) {
    throw new SeedTargetError(`${SEED_TARGET_HOST_KEY} does not match the DATABASE_URL host.`);
  }

  const endpoint = endpointHost(host);
  if (production.includes(endpoint)) {
    throw new SeedTargetError("DATABASE_URL points to the Production endpoint.");
  }
  if (e2e.includes(endpoint)) {
    throw new SeedTargetError("DATABASE_URL points to the E2E endpoint.");
  }

  return {
    connectionString: environment.DATABASE_URL!.trim(),
    host,
    endpointId: endpoint.split(".")[0] ?? "",
  };
}

function readTargetFile(rootDirectory: string, filename: string): Values | undefined {
  let contents: string;
  try {
    contents = readFileSync(resolve(rootDirectory, filename), "utf8");
  } catch {
    return undefined;
  }
  return parse(contents);
}

export function loadSeedTarget(
  rootDirectory = process.cwd(),
  environment: Values = process.env,
): SeedTarget {
  return validateSeedTarget({
    environment,
    productionTarget: readTargetFile(rootDirectory, PRODUCTION_TARGET_FILE),
    e2eTarget: readTargetFile(rootDirectory, E2E_TARGET_FILE),
  });
}
