import { readFileSync } from "node:fs";
import { devNull } from "node:os";
import { resolve } from "node:path";

import { parse } from "dotenv";

// Operator-only configuration for production schema work. Both files are
// ignored by Git (`.env*`). Error messages name keys only, never values.
export const PRODUCTION_ENV_FILE = ".env.production.local";
export const PRODUCTION_TARGET_FILE = ".env.production.target.local";
const E2E_TARGET_FILE = ".env.e2e.target.local";

const CONNECTION_KEYS = ["PROD_DATABASE_URL", "PROD_DIRECT_URL"] as const;
const TARGET_KEYS = [
  "PROD_ALLOWED_DIRECT_HOST",
  "PROD_ALLOWED_POOLED_HOST",
  "PROD_ALLOWED_DATABASE",
  "PROD_ALLOWED_ROLE",
] as const;

// Query parameters a Neon connection string may carry. Anything else (for
// example `host`, `hostaddr`, `port`, `options`) could redirect or alter the
// connection after host validation, so it is rejected.
const ALLOWED_QUERY_PARAMETERS = new Set([
  "sslmode",
  "channel_binding",
  "connect_timeout",
]);

type ConnectionKey = (typeof CONNECTION_KEYS)[number];
type TargetKey = (typeof TARGET_KEYS)[number];

export type ProductionConnection = {
  url: URL;
  host: string;
  database: string;
  role: string;
};

export type ProductionTarget = {
  directHost: string;
  pooledHost: string;
  database: string;
  role: string;
};

export type ProductionConfiguration = {
  pooled: ProductionConnection;
  direct: ProductionConnection;
  target: ProductionTarget;
  endpointId: string;
};

export class ProductionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionConfigurationError";
  }
}

function requireValues<T extends readonly string[]>(
  values: Readonly<Record<string, string | undefined>>,
  keys: T,
): { [Key in T[number]]: string } {
  const missing = keys.filter((key) => !values[key]?.trim());
  if (missing.length > 0) {
    throw new ProductionConfigurationError(
      `Missing required production configuration values: ${missing.join(", ")}.`,
    );
  }
  return Object.fromEntries(
    keys.map((key) => [key, values[key]!.trim()]),
  ) as { [Key in T[number]]: string };
}

function parseConnection(value: string, name: ConnectionKey): ProductionConnection {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProductionConfigurationError(`${name} is not a valid PostgreSQL URL.`);
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
    throw new ProductionConfigurationError(`${name} is not a complete PostgreSQL URL.`);
  }
  const unexpected = [...url.searchParams.keys()].filter(
    (key) => !ALLOWED_QUERY_PARAMETERS.has(key),
  );
  if (unexpected.length > 0) {
    throw new ProductionConfigurationError(
      `${name} has unsupported query parameters: ${[...new Set(unexpected)].join(", ")}.`,
    );
  }
  let role: string;
  let database: string;
  try {
    role = decodeURIComponent(url.username);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new ProductionConfigurationError(`${name} has invalid encoded components.`);
  }
  return { url, host: url.hostname.toLowerCase(), database, role };
}

function validateNeonHost(host: string, key: TargetKey): void {
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/i.test(host)) {
    throw new ProductionConfigurationError(`${key} must be a Neon PostgreSQL hostname.`);
  }
}

function removePoolerLabel(host: string): string {
  return host.replace(/^([^.]+)-pooler(?=\.)/, "$1");
}

export function validateProductionConfiguration(
  connectionValues: Readonly<Record<string, string | undefined>>,
  targetValues: Readonly<Record<string, string | undefined>>,
  e2eTargetValues?: Readonly<Record<string, string | undefined>>,
): ProductionConfiguration {
  const connections = requireValues(connectionValues, CONNECTION_KEYS);
  const allowed = requireValues(targetValues, TARGET_KEYS);
  const pooled = parseConnection(connections.PROD_DATABASE_URL, "PROD_DATABASE_URL");
  const direct = parseConnection(connections.PROD_DIRECT_URL, "PROD_DIRECT_URL");
  const target: ProductionTarget = {
    directHost: allowed.PROD_ALLOWED_DIRECT_HOST.toLowerCase(),
    pooledHost: allowed.PROD_ALLOWED_POOLED_HOST.toLowerCase(),
    database: allowed.PROD_ALLOWED_DATABASE,
    role: allowed.PROD_ALLOWED_ROLE,
  };

  validateNeonHost(target.directHost, "PROD_ALLOWED_DIRECT_HOST");
  validateNeonHost(target.pooledHost, "PROD_ALLOWED_POOLED_HOST");
  if (
    target.directHost.split(".")[0]?.endsWith("-pooler") ||
    !target.pooledHost.split(".")[0]?.endsWith("-pooler")
  ) {
    throw new ProductionConfigurationError(
      "Approved production direct and pooled hosts must use Neon direct/pooler naming.",
    );
  }
  if (removePoolerLabel(target.pooledHost) !== target.directHost) {
    throw new ProductionConfigurationError(
      "Approved production pooled and direct hosts do not identify the same Neon endpoint.",
    );
  }
  if (direct.host !== target.directHost || pooled.host !== target.pooledHost) {
    throw new ProductionConfigurationError(
      "Production connection hosts do not match the approved production target.",
    );
  }
  if (pooled.database !== target.database || direct.database !== target.database) {
    throw new ProductionConfigurationError(
      "Production connection database does not match the approved production target.",
    );
  }
  if (pooled.role !== target.role || direct.role !== target.role) {
    throw new ProductionConfigurationError(
      "Production connection role does not match the approved production target.",
    );
  }

  // The E2E target is a separate Neon endpoint; sharing a host means one of
  // the two configurations is wrong.
  if (e2eTargetValues) {
    const e2eHosts = [
      e2eTargetValues.E2E_ALLOWED_DIRECT_HOST,
      e2eTargetValues.E2E_ALLOWED_POOLED_HOST,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => removePoolerLabel(value.trim().toLowerCase()));
    if (e2eHosts.includes(target.directHost)) {
      throw new ProductionConfigurationError(
        "The approved production target uses the same Neon endpoint as the E2E target.",
      );
    }
  }

  return {
    pooled,
    direct,
    target,
    endpointId: target.directHost.split(".")[0] ?? "",
  };
}

function readConfigurationFile(
  rootDirectory: string,
  filename: string,
  optional = false,
): Record<string, string> | undefined {
  let contents: string;
  try {
    contents = readFileSync(resolve(rootDirectory, filename), "utf8");
  } catch {
    if (optional) return undefined;
    throw new ProductionConfigurationError(
      `Required production configuration file is unavailable: ${filename}.`,
    );
  }
  return parse(contents);
}

export function loadProductionConfiguration(
  rootDirectory = process.cwd(),
): ProductionConfiguration {
  return validateProductionConfiguration(
    readConfigurationFile(rootDirectory, PRODUCTION_ENV_FILE)!,
    readConfigurationFile(rootDirectory, PRODUCTION_TARGET_FILE)!,
    readConfigurationFile(rootDirectory, E2E_TARGET_FILE, true),
  );
}

export function connectionStringWithStrictTls(connection: ProductionConnection): string {
  const url = new URL(connection.url);
  url.searchParams.delete("ssl");
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

// Variables removed from the child environment: database connections from
// `.env`, E2E and production settings, dotenv options (an inherited
// DOTENV_OVERRIDE could let `.env` replace the verified values), and libpq
// PG* defaults that node-postgres would otherwise apply.
function isControlledVariable(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    upper === "DATABASE_URL" ||
    upper === "DIRECT_URL" ||
    upper === "SHADOW_DATABASE_URL" ||
    upper.startsWith("E2E_") ||
    upper.startsWith("PULSEMARKET_E2E_") ||
    upper.startsWith("PULSEMARKET_DB_TARGET_") ||
    upper.startsWith("PROD_") ||
    upper.startsWith("DOTENV_") ||
    /^PG[A-Z]+$/.test(upper)
  );
}

export function createProductionChildEnvironment(
  configuration: ProductionConfiguration,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const childEnvironment: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(inheritedEnvironment)) {
    if (!isControlledVariable(key)) childEnvironment[key] = value;
  }
  return {
    ...(childEnvironment as NodeJS.ProcessEnv),
    DATABASE_URL: connectionStringWithStrictTls(configuration.pooled),
    DIRECT_URL: connectionStringWithStrictTls(configuration.direct),
    // prisma.config.ts imports dotenv/config; pointing it at an empty file
    // means `.env` is never loaded in the child.
    DOTENV_PATH: devNull,
    DOTENV_QUIET: "true",
    PULSEMARKET_DB_TARGET_KIND: "production",
    PULSEMARKET_DB_TARGET_DATABASE: configuration.target.database,
    PULSEMARKET_DB_TARGET_ROLE: configuration.target.role,
    PULSEMARKET_DB_TARGET_ENDPOINT: configuration.endpointId,
  };
}

// Replaces every known secret (full URLs and passwords) in text that may be
// shown to the operator.
export function redactSecrets(
  text: string,
  configuration: ProductionConfiguration | undefined,
): string {
  if (!configuration) return text;
  let redacted = text;
  for (const connection of [configuration.pooled, configuration.direct]) {
    let decodedPassword = "";
    try {
      decodedPassword = decodeURIComponent(connection.url.password);
    } catch {
      decodedPassword = "";
    }
    const secrets = [
      connection.url.toString(),
      connectionStringWithStrictTls(connection),
      connection.url.password,
      decodedPassword,
    ].filter((secret) => secret.length > 0);
    for (const secret of secrets) redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}
