import { Pool, type PoolClient } from "pg";

import {
  connectionStringWithStrictTls,
  loadE2eConfiguration,
  type E2eConnection,
} from "../lib/e2e-environment";

type DatabaseInspection = {
  database: string;
  role: string;
  tables: string[];
  migrationRows: number | null;
  applicationRows: Record<string, number>;
};

const APPLICATION_TABLES = ["Product", "Customer", "Sale", "SaleItem"] as const;
const APPLICATION_TABLE_NAMES: ReadonlySet<string> = new Set(APPLICATION_TABLES);

async function inspectConnection(
  connection: E2eConnection,
  label: "pooled" | "direct",
): Promise<DatabaseInspection> {
  const pool = new Pool({
    connectionString: connectionStringWithStrictTls(connection),
    ssl: { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;

    const identity = await client.query<{
      database: string;
      role: string;
    }>("SELECT current_database() AS database, current_user AS role");
    const identityRow = identity.rows[0];
    if (
      !identityRow ||
      identityRow.database !== connection.database ||
      identityRow.role !== connection.role
    ) {
      throw new Error("Database identity does not match the approved target.");
    }

    const tablesResult = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const tables = tablesResult.rows.map(({ table_name }) => table_name);
    const hasMigrationsTable = tables.includes("_prisma_migrations");
    let migrationRows: number | null = null;
    const unexpectedTables = tables.filter(
      (table) =>
        table !== "_prisma_migrations" &&
        !APPLICATION_TABLE_NAMES.has(table),
    );
    const missingExpectedTables = hasMigrationsTable
      ? APPLICATION_TABLES.filter((table) => !tables.includes(table))
      : [];

    if (unexpectedTables.length > 0 || missingExpectedTables.length > 0) {
      throw new Error(
        `E2E database has an unexpected table state (unexpected: ${
          unexpectedTables.join(", ") || "none"
        }; missing: ${missingExpectedTables.join(", ") || "none"}).`,
      );
    }

    if (hasMigrationsTable) {
      const migrations = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM public."_prisma_migrations"',
      );
      migrationRows = Number(migrations.rows[0]?.count ?? "0");
    }

    const applicationRows: Record<string, number> = {};
    for (const table of APPLICATION_TABLES) {
      if (!tables.includes(table)) continue;
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public."${table}"`,
      );
      applicationRows[table] = Number(countResult.rows[0]?.count ?? "0");
    }
    const populatedTables = Object.entries(applicationRows)
      .filter(([, count]) => count !== 0)
      .map(([table, count]) => `${table}=${count}`);
    if (populatedTables.length > 0) {
      throw new Error(
        `E2E database contains application records: ${populatedTables.join(", ")}.`,
      );
    }

    await client.query("COMMIT");
    transactionOpen = false;
    return {
      database: identityRow.database,
      role: identityRow.role,
      tables,
      migrationRows,
      applicationRows,
    };
  } catch (error: unknown) {
    if (client && transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the sanitized preflight error.
      }
    }
    if (
      error instanceof Error &&
      error.message.startsWith("E2E database ")
    ) {
      throw error;
    }
    throw new Error(`Read-only ${label} connection check failed.`);
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const configuration = loadE2eConfiguration();
  const [pooled, direct] = await Promise.all([
    inspectConnection(configuration.pooled, "pooled"),
    inspectConnection(configuration.direct, "direct"),
  ]);

  if (
    pooled.database !== direct.database ||
    pooled.role !== direct.role ||
    pooled.tables.join("\u0000") !== direct.tables.join("\u0000") ||
    pooled.migrationRows !== direct.migrationRows ||
    JSON.stringify(pooled.applicationRows) !==
      JSON.stringify(direct.applicationRows)
  ) {
    throw new Error("E2E database pooled/direct inspections do not match.");
  }

  console.log("E2E destination preflight passed (read-only).");
  console.log(`Database: ${pooled.database}; role: ${pooled.role}.`);
  console.log(`Public tables: ${pooled.tables.join(", ") || "(none)"}.`);
  console.log(
    `Prisma migration rows: ${pooled.migrationRows ?? "migration table absent"}.`,
  );
  console.log(
    `Application row counts: ${
      Object.entries(pooled.applicationRows)
        .map(([table, count]) => `${table}=${count}`)
        .join(", ") || "(application tables not migrated)"
    }.`,
  );
}

main().catch((error: unknown) => {
  if (
    error instanceof Error &&
    error.message.startsWith("Missing required E2E configuration values:")
  ) {
    console.error(error.message);
  } else if (
    error instanceof Error &&
    error.message.startsWith("Required E2E configuration file is unavailable:")
  ) {
    console.error(error.message);
  } else if (
    error instanceof Error &&
    error.message.startsWith("E2E ")
  ) {
    console.error(error.message);
  } else {
    console.error(
      "E2E read-only preflight failed. Connection details were suppressed.",
    );
  }
  process.exitCode = 1;
});
