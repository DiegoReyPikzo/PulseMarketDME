import { resolve } from "node:path";

import { Client } from "pg";

import {
  CUSTOMER_CHECK,
  CUSTOMER_DELETED_INDEX,
  evaluateSnapshot,
  readLocalMigrations,
  type SchemaSnapshot,
} from "../lib/database-migration-checks";

// Read-only verification of the customer migration. Run it only through
// `npm run prod:db -- verify-*` (production) or `npm run e2e:with-env --
// node --import tsx scripts/database-migration-verify.ts --target=e2e ...`.
// It prints aggregates and catalog metadata only: no emails, names, phones,
// or connection strings.

type Options = {
  target: "production" | "e2e";
  phase: "pre" | "post";
  expectedCustomers?: number;
};

function parseOptions(argv: readonly string[]): Options {
  let target: Options["target"] | undefined;
  let phase: Options["phase"] | undefined;
  let expectedCustomers: number | undefined;
  for (const argument of argv) {
    const [key, value] = argument.split("=", 2);
    if (key === "--target" && (value === "production" || value === "e2e")) {
      target = value;
    } else if (key === "--phase" && (value === "pre" || value === "post")) {
      phase = value;
    } else if (key === "--expect-customers" && /^\d{1,9}$/.test(value ?? "")) {
      expectedCustomers = Number(value);
    } else {
      throw new Error(`Unsupported argument: ${key}.`);
    }
  }
  if (!target || !phase) {
    throw new Error("Usage: --target=production|e2e --phase=pre|post [--expect-customers=N].");
  }
  return { target, phase, expectedCustomers };
}

function expectedIdentity(target: Options["target"]) {
  const environment = process.env;
  if (target === "production") {
    if (
      environment.PULSEMARKET_DB_TARGET_KIND !== "production" ||
      !environment.PULSEMARKET_DB_TARGET_DATABASE ||
      !environment.PULSEMARKET_DB_TARGET_ROLE ||
      !environment.PULSEMARKET_DB_TARGET_ENDPOINT
    ) {
      throw new Error("Production verification must run through the production wrapper.");
    }
    return {
      database: environment.PULSEMARKET_DB_TARGET_DATABASE,
      role: environment.PULSEMARKET_DB_TARGET_ROLE,
      endpoint: environment.PULSEMARKET_DB_TARGET_ENDPOINT,
    };
  }
  if (
    environment.PULSEMARKET_DB_TARGET_KIND ||
    !environment.E2E_ALLOWED_DATABASE ||
    !environment.E2E_ALLOWED_ROLE
  ) {
    throw new Error("E2E verification must run through the validated E2E wrapper.");
  }
  return {
    database: environment.E2E_ALLOWED_DATABASE,
    role: environment.E2E_ALLOWED_ROLE,
    endpoint: "e2e",
  };
}

async function readSnapshot(client: Client): Promise<SchemaSnapshot> {
  const counts = (
    await client.query<{
      total: number;
      non_normalized: number;
      duplicate_groups: number;
    }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE email <> lower(btrim(email)))::int AS non_normalized,
        (SELECT COUNT(*)::int FROM (
           SELECT lower(btrim(email)) FROM public."Customer"
           GROUP BY lower(btrim(email)) HAVING COUNT(*) > 1
         ) AS groups) AS duplicate_groups
      FROM public."Customer"`)
  ).rows[0];

  const column = (
    await client.query<{ is_nullable: string; column_default: string | null; data_type: string }>(`
      SELECT is_nullable, column_default, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Customer' AND column_name = 'deletedAt'`)
  ).rows[0];

  const deletedCustomers = column
    ? (
        await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM public."Customer" WHERE "deletedAt" IS NOT NULL`,
        )
      ).rows[0].count
    : null;

  const index = await client.query(
    `SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'Customer' AND indexname = $1`,
    [CUSTOMER_DELETED_INDEX],
  );

  const check = (
    await client.query<{ convalidated: boolean; definition: string }>(
      `SELECT convalidated, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public."Customer"'::regclass AND conname = $1 AND contype = 'c'`,
      [CUSTOMER_CHECK],
    )
  ).rows[0];

  const migrations = (
    await client.query<{
      migration_name: string;
      checksum: string;
      finished: boolean;
      rolled_back: boolean;
      has_logs: boolean;
      applied_steps_count: number;
    }>(`
      SELECT migration_name, checksum,
             finished_at IS NOT NULL AS finished,
             rolled_back_at IS NOT NULL AS rolled_back,
             logs IS NOT NULL AS has_logs,
             applied_steps_count
      FROM public."_prisma_migrations"
      ORDER BY started_at, migration_name`)
  ).rows;

  return {
    customerCount: counts.total,
    nonNormalizedEmails: counts.non_normalized,
    duplicateEmailGroups: counts.duplicate_groups,
    deletedCustomers,
    deletedAtColumn: column
      ? {
          nullable: column.is_nullable === "YES",
          hasDefault: column.column_default !== null,
          type: column.data_type,
        }
      : null,
    deletedAtIndex: index.rowCount === 1,
    emailCheck: check
      ? { validated: check.convalidated, definition: check.definition }
      : null,
    migrations: migrations.map((row) => ({
      name: row.migration_name,
      checksum: row.checksum,
      finished: row.finished,
      rolledBack: row.rolled_back,
      hasLogs: row.has_logs,
      appliedSteps: row.applied_steps_count,
    })),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const identity = expectedIdentity(options.target);
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) throw new Error("DIRECT_URL is not provided by the wrapper.");

  const local = readLocalMigrations(resolve("prisma/migrations"));
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  let snapshot: SchemaSnapshot;
  try {
    await client.query("BEGIN READ ONLY");
    const actual = (
      await client.query<{ database: string; role: string }>(
        "SELECT current_database() AS database, current_user AS role",
      )
    ).rows[0];
    if (actual.database !== identity.database || actual.role !== identity.role) {
      throw new Error("Connected database identity does not match the verified target.");
    }
    snapshot = await readSnapshot(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  const result = evaluateSnapshot(options.phase, snapshot, local, options.expectedCustomers);
  console.log(`Target: ${options.target} (endpoint ${identity.endpoint}), read-only.`);
  console.log(
    `Customer rows: ${snapshot.customerCount}; non-normalized emails: ${snapshot.nonNormalizedEmails}; duplicate normalized groups: ${snapshot.duplicateEmailGroups}; rows with deletedAt: ${snapshot.deletedCustomers ?? "column absent"}.`,
  );
  console.log(
    `deletedAt column: ${snapshot.deletedAtColumn ? JSON.stringify(snapshot.deletedAtColumn) : "absent"}; ${CUSTOMER_DELETED_INDEX}: ${snapshot.deletedAtIndex ? "present" : "absent"}; ${CUSTOMER_CHECK}: ${snapshot.emailCheck ? JSON.stringify(snapshot.emailCheck) : "absent"}.`,
  );
  for (const migration of local) {
    const rows = snapshot.migrations.filter(({ name }) => name === migration.name);
    console.log(
      `Migration ${migration.name}: local sha256 ${migration.checksum}; database ${
        rows.length === 0
          ? "not applied"
          : rows
              .map(
                (row) =>
                  `checksum ${row.checksum === migration.checksum ? "matches" : "DIFFERS"}, finished=${row.finished}, rolledBack=${row.rolledBack}, logs=${row.hasLogs}`,
              )
              .join(" | ")
      }.`,
    );
  }
  for (const note of result.notes) console.log(`Note: ${note}`);
  for (const failure of result.failures) console.log(`FAIL: ${failure}`);
  console.log(`VERIFY_${options.phase.toUpperCase()}_OK=${result.ok}`);
  if (!result.ok) process.exitCode = 2;
}

main().catch((error: unknown) => {
  // Never echo driver errors verbatim: they can include connection details.
  console.error(
    error instanceof Error && /^(Unsupported argument|Usage|Production verification|E2E verification|DIRECT_URL|Connected database)/.test(error.message)
      ? error.message
      : "Verification failed. Connection details were suppressed.",
  );
  process.exitCode = 1;
});
