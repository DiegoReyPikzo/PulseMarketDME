import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const E2E_ENV_FILE = ".env.e2e.local";
const E2E_TARGET_FILE = ".env.e2e.target.local";

const CONNECTION_KEYS = ["E2E_DATABASE_URL", "E2E_DIRECT_URL"] as const;
const TARGET_KEYS = [
  "E2E_ALLOWED_DIRECT_HOST",
  "E2E_ALLOWED_POOLED_HOST",
  "E2E_ALLOWED_DATABASE",
  "E2E_ALLOWED_ROLE",
] as const;

type ConnectionKey = (typeof CONNECTION_KEYS)[number];
type TargetKey = (typeof TARGET_KEYS)[number];

export type E2eConnection = {
  url: URL;
  host: string;
  database: string;
  role: string;
};

export type E2eTarget = {
  directHost: string;
  pooledHost: string;
  database: string;
  role: string;
};

export type E2eConfiguration = {
  pooled: E2eConnection;
  direct: E2eConnection;
  target: E2eTarget;
};

export class E2eConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E2eConfigurationError";
  }
}

function requireValues<T extends readonly string[]>(
  values: Readonly<Record<string, string | undefined>>,
  keys: T,
): { [Key in T[number]]: string } {
  const missing = keys.filter((key) => !values[key]?.trim());
  if (missing.length > 0) {
    throw new E2eConfigurationError(
      `Missing required E2E configuration values: ${missing.join(", ")}.`,
    );
  }

  return Object.fromEntries(
    keys.map((key) => [key, values[key]!.trim()]),
  ) as { [Key in T[number]]: string };
}

function parseConnection(
  value: string,
  name: ConnectionKey,
): E2eConnection {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new E2eConfigurationError(`${name} is not a valid PostgreSQL URL.`);
  }

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    !url.pathname ||
    url.pathname === "/"
  ) {
    throw new E2eConfigurationError(`${name} is not a complete PostgreSQL URL.`);
  }

  let role: string;
  let database: string;
  try {
    role = decodeURIComponent(url.username);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new E2eConfigurationError(`${name} has invalid encoded components.`);
  }

  return {
    url,
    host: url.hostname.toLowerCase(),
    database,
    role,
  };
}

function validateNeonHost(host: string, key: TargetKey): void {
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/i.test(host)) {
    throw new E2eConfigurationError(
      `${key} must be a Neon PostgreSQL hostname.`,
    );
  }
}

function removePoolerLabel(host: string): string {
  return host.replace(/^([^.]+)-pooler(?=\.)/, "$1");
}

export function validateE2eConfiguration(
  connectionValues: Readonly<Record<string, string | undefined>>,
  targetValues: Readonly<Record<string, string | undefined>>,
): E2eConfiguration {
  const connections = requireValues(connectionValues, CONNECTION_KEYS);
  const allowed = requireValues(targetValues, TARGET_KEYS);
  const pooled = parseConnection(
    connections.E2E_DATABASE_URL,
    "E2E_DATABASE_URL",
  );
  const direct = parseConnection(connections.E2E_DIRECT_URL, "E2E_DIRECT_URL");
  const target: E2eTarget = {
    directHost: allowed.E2E_ALLOWED_DIRECT_HOST.toLowerCase(),
    pooledHost: allowed.E2E_ALLOWED_POOLED_HOST.toLowerCase(),
    database: allowed.E2E_ALLOWED_DATABASE,
    role: allowed.E2E_ALLOWED_ROLE,
  };

  validateNeonHost(target.directHost, "E2E_ALLOWED_DIRECT_HOST");
  validateNeonHost(target.pooledHost, "E2E_ALLOWED_POOLED_HOST");

  if (
    target.directHost.split(".")[0]?.endsWith("-pooler") ||
    !target.pooledHost.split(".")[0]?.endsWith("-pooler")
  ) {
    throw new E2eConfigurationError(
      "Approved direct and pooled hosts must use Neon direct/pooler naming.",
    );
  }
  if (
    direct.host !== target.directHost ||
    pooled.host !== target.pooledHost
  ) {
    throw new E2eConfigurationError(
      "E2E connection hosts do not match the independently approved destination.",
    );
  }
  if (removePoolerLabel(pooled.host) !== direct.host) {
    throw new E2eConfigurationError(
      "E2E pooled and direct hosts do not identify the same Neon endpoint.",
    );
  }
  if (
    pooled.database !== direct.database ||
    pooled.database !== target.database
  ) {
    throw new E2eConfigurationError(
      "E2E connection database does not match the independently approved destination.",
    );
  }
  if (pooled.role !== direct.role || pooled.role !== target.role) {
    throw new E2eConfigurationError(
      "E2E connection role does not match the independently approved destination.",
    );
  }

  return { pooled, direct, target };
}

function readConfigurationFile(rootDirectory: string, filename: string) {
  try {
    const contents = readFileSync(resolve(rootDirectory, filename), "utf8");
    return parse(contents);
  } catch {
    throw new E2eConfigurationError(
      `Required E2E configuration file is unavailable: ${filename}.`,
    );
  }
}

export function loadE2eConfiguration(
  rootDirectory = process.cwd(),
): E2eConfiguration {
  const connectionValues = readConfigurationFile(
    rootDirectory,
    E2E_ENV_FILE,
  );
  const targetValues = readConfigurationFile(rootDirectory, E2E_TARGET_FILE);
  return validateE2eConfiguration(connectionValues, targetValues);
}

export function connectionStringWithStrictTls(
  connection: E2eConnection,
): string {
  const url = new URL(connection.url);
  url.searchParams.delete("ssl");
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

export function createE2eChildEnvironment(
  configuration: E2eConfiguration,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...inheritedEnvironment,
    DATABASE_URL: connectionStringWithStrictTls(configuration.pooled),
    DIRECT_URL: connectionStringWithStrictTls(configuration.direct),
    E2E_DATABASE_URL: configuration.pooled.url.toString(),
    E2E_DIRECT_URL: configuration.direct.url.toString(),
    E2E_ALLOWED_DIRECT_HOST: configuration.target.directHost,
    E2E_ALLOWED_POOLED_HOST: configuration.target.pooledHost,
    E2E_ALLOWED_DATABASE: configuration.target.database,
    E2E_ALLOWED_ROLE: configuration.target.role,
  };

  for (const key of [
    "GITHUB_ID",
    "GITHUB_SECRET",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "E2E_AUTH_PROVIDER_ORIGIN",
    "E2E_AUTH_CLIENT_ID",
    "E2E_AUTH_CLIENT_SECRET",
    "PULSEMARKET_E2E_RUN_ID",
  ]) {
    delete childEnvironment[key];
  }

  return childEnvironment;
}
