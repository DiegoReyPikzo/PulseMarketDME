import type { SeedDataset } from "../prisma/seed-data";
import {
  runSeedTransaction,
  type SeedStore,
  type SeedSummary,
  type TableFingerprint,
} from "../prisma/seed";

// Explicit, operator-only path for loading the v2 sample data into
// Production (`npm run prod:db -- seed-v2 ...`). The sample-data seed
// (`prisma db seed`, lib/seed-target.ts) keeps refusing Production; this path
// adds its own checks and then runs the same, unchanged runSeedTransaction.
// See docs/production-seed-v2.md.

export type SeedTable = keyof SeedDataset;

const TABLES: readonly SeedTable[] = ["products", "customers", "sales", "saleItems"];

// Command-line names of the baseline arguments, one per table.
const BASELINE_FLAGS: Record<SeedTable, string> = {
  products: "--expect-products",
  customers: "--expect-customers",
  sales: "--expect-sales",
  saleItems: "--expect-sale-items",
};

export type ProductionSeedArguments = {
  // Checked against the verified production endpoint.
  confirmEndpoint: string;
  // Declared by the operator. The tool cannot see Neon branches, so it only
  // checks the format and prints it; it does not prove the backup exists.
  backupBranch: string;
  // Count and digest of the rows outside the v2 sample data, per table, as
  // read by the operator's read-only check. Compared inside the transaction
  // before anything is written.
  baseline: Record<SeedTable, TableFingerprint>;
};

export class ProductionSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionSeedError";
  }
}

export const PRODUCTION_SEED_USAGE =
  "seed-v2 requires exactly --confirm-endpoint=<verified endpoint ID> --backup-branch=<Neon branch name> " +
  "--expect-products=<count>:<md5> --expect-customers=<count>:<md5> --expect-sales=<count>:<md5> " +
  "--expect-sale-items=<count>:<md5>, each once.";

const BACKUP_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,99}$/;
const BASELINE_VALUE = /^(\d{1,9}):([0-9a-f]{32})$/;

export function parseProductionSeedArguments(argv: readonly string[]): ProductionSeedArguments {
  const values = new Map<string, string>();
  for (const argument of argv) {
    const separator = argument.indexOf("=");
    if (separator <= 0) throw new ProductionSeedError(PRODUCTION_SEED_USAGE);
    const key = argument.slice(0, separator);
    const value = argument.slice(separator + 1);
    const known =
      key === "--confirm-endpoint" ||
      key === "--backup-branch" ||
      (Object.values(BASELINE_FLAGS) as string[]).includes(key);
    if (!known || values.has(key) || value === "") {
      throw new ProductionSeedError(PRODUCTION_SEED_USAGE);
    }
    values.set(key, value);
  }

  const confirmEndpoint = values.get("--confirm-endpoint");
  const backupBranch = values.get("--backup-branch");
  if (!confirmEndpoint || !backupBranch || values.size !== 2 + TABLES.length) {
    throw new ProductionSeedError(PRODUCTION_SEED_USAGE);
  }
  if (!BACKUP_BRANCH.test(backupBranch)) {
    throw new ProductionSeedError("--backup-branch must be a Neon branch name (3-100 letters, digits, . _ / -).");
  }

  const baseline = {} as Record<SeedTable, TableFingerprint>;
  for (const table of TABLES) {
    const match = BASELINE_VALUE.exec(values.get(BASELINE_FLAGS[table]) ?? "");
    if (!match) {
      throw new ProductionSeedError(
        `${BASELINE_FLAGS[table]} must be <count>:<md5 digest> from the read-only check.`,
      );
    }
    baseline[table] = { count: Number(match[1]), digest: match[2] };
  }
  return { confirmEndpoint, backupBranch, baseline };
}

export type ProductionSeedIdentity = {
  database: string;
  role: string;
  endpoint: string;
};

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

// The identity the child must find, as set by createProductionChildEnvironment.
// The script only runs inside the production wrapper, never in automation or
// next to E2E settings, and its DATABASE_URL must be the verified endpoint.
export function expectedProductionSeedIdentity(
  environment: Readonly<Record<string, string | undefined>>,
): ProductionSeedIdentity {
  const automated = ["CI", "VERCEL", "VERCEL_ENV", "GITHUB_ACTIONS"].filter((key) =>
    hasValue(environment[key]),
  );
  if (automated.length > 0) {
    throw new ProductionSeedError(
      `The production seed runs only from an operator workstation (found ${automated.join(", ")}).`,
    );
  }
  const e2eVariables = Object.keys(environment).filter(
    (key) =>
      (key.toUpperCase().startsWith("E2E_") || key.toUpperCase().startsWith("PULSEMARKET_E2E_")) &&
      hasValue(environment[key]),
  );
  if (e2eVariables.length > 0) {
    throw new ProductionSeedError("The production seed does not run with E2E environment variables set.");
  }
  const database = environment.PULSEMARKET_DB_TARGET_DATABASE?.trim();
  const role = environment.PULSEMARKET_DB_TARGET_ROLE?.trim();
  const endpoint = environment.PULSEMARKET_DB_TARGET_ENDPOINT?.trim().toLowerCase();
  if (environment.PULSEMARKET_DB_TARGET_KIND !== "production" || !database || !role || !endpoint) {
    throw new ProductionSeedError("The production seed must run through the production wrapper.");
  }

  let host: string;
  try {
    host = new URL(environment.DATABASE_URL ?? "").hostname.toLowerCase();
  } catch {
    throw new ProductionSeedError("DATABASE_URL is not provided by the production wrapper.");
  }
  const hostEndpoint = host.split(".")[0]?.replace(/-pooler$/, "");
  if (!host || hostEndpoint !== endpoint) {
    throw new ProductionSeedError("DATABASE_URL does not point to the verified production endpoint.");
  }
  return { database, role, endpoint };
}

export function assertConfirmedEndpoint(
  args: ProductionSeedArguments,
  identity: ProductionSeedIdentity,
): void {
  if (args.confirmEndpoint.toLowerCase() !== identity.endpoint) {
    throw new ProductionSeedError(
      "--confirm-endpoint does not match the verified production endpoint. Nothing was written.",
    );
  }
}

export type ProductionSeedChecks = {
  // Resolves to the connected database and role, read in the transaction.
  readIdentity(): Promise<{ database: string; role: string }>;
  identity: ProductionSeedIdentity;
  baseline: Record<SeedTable, TableFingerprint>;
};

// Runs inside the caller's serializable transaction. Before handing over to
// runSeedTransaction it checks, in the same snapshot, that the connection is
// the verified database and role and that the rows outside the v2 sample data
// still match the operator's read-only baseline. Any thrown error rolls the
// transaction back; nothing here catches errors.
export async function runProductionSeed(
  store: SeedStore,
  dataset: SeedDataset,
  checks: ProductionSeedChecks,
  run: (store: SeedStore, dataset: SeedDataset) => Promise<SeedSummary> = runSeedTransaction,
): Promise<SeedSummary> {
  const actual = await checks.readIdentity();
  if (actual.database !== checks.identity.database || actual.role !== checks.identity.role) {
    throw new ProductionSeedError(
      "Connected database identity does not match the verified production target. Nothing was written.",
    );
  }
  for (const table of TABLES) {
    const current = await store.fingerprintOtherRows(table);
    const expected = checks.baseline[table];
    if (current.count !== expected.count || current.digest !== expected.digest) {
      throw new ProductionSeedError(
        `${table}: rows outside the v2 sample data no longer match the baseline (${current.count} now, ${expected.count} expected). Nothing was written.`,
      );
    }
  }
  return run(store, dataset);
}
