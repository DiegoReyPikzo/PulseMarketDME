import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CUSTOMER_MIGRATION = "20261017200000_add_customer_soft_delete";
export const CUSTOMER_CHECK = "Customer_email_normalized_check";
export const CUSTOMER_CHECK_DEFINITION =
  "CHECK (((email)::text = lower(btrim((email)::text))))";
export const CUSTOMER_DELETED_INDEX = "Customer_deletedAt_createdAt_idx";

export type LocalMigration = { name: string; checksum: string };

export type AppliedMigration = {
  name: string;
  checksum: string;
  finished: boolean;
  rolledBack: boolean;
  hasLogs: boolean;
  appliedSteps: number;
};

export type SchemaSnapshot = {
  customerCount: number;
  nonNormalizedEmails: number;
  duplicateEmailGroups: number;
  deletedCustomers: number | null;
  deletedAtColumn: { nullable: boolean; hasDefault: boolean; type: string } | null;
  deletedAtIndex: boolean;
  emailCheck: { validated: boolean; definition: string } | null;
  migrations: AppliedMigration[];
};

export type CheckResult = { ok: boolean; failures: string[]; notes: string[] };

// Prisma stores the SHA-256 of each migration file; compare raw bytes.
export function readLocalMigrations(migrationsDirectory: string): LocalMigration[] {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      checksum: createHash("sha256")
        .update(readFileSync(join(migrationsDirectory, name, "migration.sql")))
        .digest("hex"),
    }));
}

function checkAppliedHistory(
  local: readonly LocalMigration[],
  applied: readonly AppliedMigration[],
  expectedApplied: readonly string[],
  failures: string[],
  notes: string[],
): void {
  const localNames = new Set(local.map(({ name }) => name));
  for (const row of applied) {
    if (!localNames.has(row.name)) {
      failures.push(`Database has a migration not present locally: ${row.name}.`);
    }
    if (!row.finished || row.rolledBack || row.hasLogs) {
      failures.push(
        `Migration ${row.name} is not cleanly applied (finished=${row.finished}, rolledBack=${row.rolledBack}, logs=${row.hasLogs}).`,
      );
    }
    // Recorded for diagnosis only; not a success criterion.
    notes.push(`${row.name}: applied_steps_count=${row.appliedSteps}.`);
  }
  for (const name of expectedApplied) {
    const rows = applied.filter((row) => row.name === name);
    const localMigration = local.find((migration) => migration.name === name);
    if (rows.length !== 1) {
      failures.push(`Expected exactly one history row for ${name}; found ${rows.length}.`);
    } else if (localMigration && rows[0].checksum !== localMigration.checksum) {
      failures.push(`Checksum of ${name} differs between the local file and the database.`);
    }
  }
}

export function evaluateSnapshot(
  phase: "pre" | "post",
  snapshot: SchemaSnapshot,
  local: readonly LocalMigration[],
  expectedCustomerCount?: number,
): CheckResult {
  const failures: string[] = [];
  const notes: string[] = [];
  const localNames = local.map(({ name }) => name);
  if (!localNames.includes(CUSTOMER_MIGRATION)) {
    failures.push(`Local migrations do not include ${CUSTOMER_MIGRATION}.`);
  }

  if (expectedCustomerCount !== undefined && snapshot.customerCount !== expectedCustomerCount) {
    failures.push(
      `Customer count ${snapshot.customerCount} differs from the expected ${expectedCustomerCount}.`,
    );
  }
  if (snapshot.nonNormalizedEmails !== 0) {
    failures.push(`${snapshot.nonNormalizedEmails} customer emails are not normalized.`);
  }
  if (snapshot.duplicateEmailGroups !== 0) {
    failures.push(`${snapshot.duplicateEmailGroups} normalized email groups are duplicated.`);
  }

  if (phase === "pre") {
    checkAppliedHistory(
      local,
      snapshot.migrations,
      localNames.filter((name) => name !== CUSTOMER_MIGRATION),
      failures,
      notes,
    );
    if (snapshot.migrations.some(({ name }) => name === CUSTOMER_MIGRATION)) {
      failures.push(`${CUSTOMER_MIGRATION} already has a history row.`);
    }
    if (snapshot.deletedAtColumn) failures.push("Customer.deletedAt already exists.");
    if (snapshot.deletedAtIndex) failures.push(`${CUSTOMER_DELETED_INDEX} already exists.`);
    if (snapshot.emailCheck) failures.push(`${CUSTOMER_CHECK} already exists.`);
  } else {
    checkAppliedHistory(local, snapshot.migrations, localNames, failures, notes);
    const column = snapshot.deletedAtColumn;
    if (!column) {
      failures.push("Customer.deletedAt is missing.");
    } else if (
      !column.nullable ||
      column.hasDefault ||
      column.type !== "timestamp with time zone"
    ) {
      failures.push("Customer.deletedAt does not match the migration (nullable timestamptz, no default).");
    }
    if (!snapshot.deletedAtIndex) failures.push(`${CUSTOMER_DELETED_INDEX} is missing.`);
    if (!snapshot.emailCheck) {
      failures.push(`${CUSTOMER_CHECK} is missing.`);
    } else {
      if (!snapshot.emailCheck.validated) failures.push(`${CUSTOMER_CHECK} is not validated.`);
      if (snapshot.emailCheck.definition !== CUSTOMER_CHECK_DEFINITION) {
        failures.push(`${CUSTOMER_CHECK} has an unexpected definition.`);
      }
    }
    if (snapshot.deletedCustomers !== null && snapshot.deletedCustomers !== 0) {
      failures.push(
        `${snapshot.deletedCustomers} customers already have deletedAt set before the new code was deployed.`,
      );
    }
  }

  return { ok: failures.length === 0, failures, notes };
}
