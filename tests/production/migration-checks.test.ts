import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

import {
  CUSTOMER_CHECK_DEFINITION,
  CUSTOMER_MIGRATION,
  evaluateSnapshot,
  readLocalMigrations,
  type AppliedMigration,
  type LocalMigration,
  type SchemaSnapshot,
} from "../../lib/database-migration-checks";

const local: LocalMigration[] = [
  { name: "20261017053820_init", checksum: "a".repeat(64) },
  { name: "20261017073304_add_product_sort_order", checksum: "b".repeat(64) },
  { name: CUSTOMER_MIGRATION, checksum: "c".repeat(64) },
];

function applied(name: string, checksum: string, values: Partial<AppliedMigration> = {}): AppliedMigration {
  return {
    name,
    checksum,
    finished: true,
    rolledBack: false,
    hasLogs: false,
    appliedSteps: 1,
    ...values,
  };
}

function preSnapshot(values: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
  return {
    customerCount: 500,
    nonNormalizedEmails: 0,
    duplicateEmailGroups: 0,
    deletedCustomers: null,
    deletedAtColumn: null,
    deletedAtIndex: false,
    emailCheck: null,
    migrations: [applied(local[0].name, local[0].checksum), applied(local[1].name, local[1].checksum)],
    ...values,
  };
}

function postSnapshot(values: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
  return {
    ...preSnapshot(),
    deletedCustomers: 0,
    deletedAtColumn: { nullable: true, hasDefault: false, type: "timestamp with time zone" },
    deletedAtIndex: true,
    emailCheck: { validated: true, definition: CUSTOMER_CHECK_DEFINITION },
    migrations: local.map(({ name, checksum }) => applied(name, checksum)),
    ...values,
  };
}

test("the pre-migration check passes for the state reported in Neon", () => {
  const result = evaluateSnapshot("pre", preSnapshot(), local, 500);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test("the pre-migration check stops on data, history, or schema problems", () => {
  const cases: [string, SchemaSnapshot, number?][] = [
    ["non-normalized emails", preSnapshot({ nonNormalizedEmails: 1 })],
    ["duplicate groups", preSnapshot({ duplicateEmailGroups: 2 })],
    ["unexpected count", preSnapshot(), 499],
    ["customer migration already recorded", preSnapshot({ migrations: [...preSnapshot().migrations, applied(CUSTOMER_MIGRATION, "c".repeat(64), { finished: false, hasLogs: true })] })],
    ["failed earlier migration", preSnapshot({ migrations: [applied(local[0].name, local[0].checksum), applied(local[1].name, local[1].checksum, { finished: false })] })],
    ["rolled back migration", preSnapshot({ migrations: [applied(local[0].name, local[0].checksum), applied(local[1].name, local[1].checksum, { rolledBack: true })] })],
    ["checksum mismatch", preSnapshot({ migrations: [applied(local[0].name, "f".repeat(64)), applied(local[1].name, local[1].checksum)] })],
    ["unknown database migration", preSnapshot({ migrations: [...preSnapshot().migrations, applied("20990101000000_foreign", "d".repeat(64))] })],
    ["missing earlier migration", preSnapshot({ migrations: [applied(local[0].name, local[0].checksum)] })],
    ["column already present", preSnapshot({ deletedAtColumn: { nullable: true, hasDefault: false, type: "timestamp with time zone" } })],
    ["index already present", preSnapshot({ deletedAtIndex: true })],
    ["check already present", preSnapshot({ emailCheck: { validated: true, definition: CUSTOMER_CHECK_DEFINITION } })],
  ];
  for (const [label, snapshot, expected] of cases) {
    assert.equal(evaluateSnapshot("pre", snapshot, local, expected).ok, false, label);
  }
});

test("the post-migration check requires every object, a validated CHECK, and matching checksums", () => {
  assert.deepEqual(evaluateSnapshot("post", postSnapshot(), local, 500).failures, []);
  const cases: [string, SchemaSnapshot][] = [
    ["missing column", postSnapshot({ deletedAtColumn: null })],
    ["column with default", postSnapshot({ deletedAtColumn: { nullable: true, hasDefault: true, type: "timestamp with time zone" } })],
    ["non-nullable column", postSnapshot({ deletedAtColumn: { nullable: false, hasDefault: false, type: "timestamp with time zone" } })],
    ["missing index", postSnapshot({ deletedAtIndex: false })],
    ["missing check", postSnapshot({ emailCheck: null })],
    ["unvalidated check", postSnapshot({ emailCheck: { validated: false, definition: CUSTOMER_CHECK_DEFINITION } })],
    ["unexpected check definition", postSnapshot({ emailCheck: { validated: true, definition: "CHECK ((email IS NOT NULL))" } })],
    ["customer migration failed", postSnapshot({ migrations: local.map(({ name, checksum }) => applied(name, checksum, name === CUSTOMER_MIGRATION ? { finished: false, hasLogs: true } : {})) })],
    ["customer checksum differs", postSnapshot({ migrations: local.map(({ name, checksum }) => applied(name, name === CUSTOMER_MIGRATION ? "e".repeat(64) : checksum)) })],
    ["duplicate history rows", postSnapshot({ migrations: [...local.map(({ name, checksum }) => applied(name, checksum)), applied(CUSTOMER_MIGRATION, "c".repeat(64))] })],
    ["deleted customers before deploy", postSnapshot({ deletedCustomers: 3 })],
  ];
  for (const [label, snapshot] of cases) {
    assert.equal(evaluateSnapshot("post", snapshot, local).ok, false, label);
  }
});

test("applied_steps_count is reported but is not a success criterion", () => {
  const snapshot = postSnapshot({
    migrations: local.map(({ name, checksum }, index) => applied(name, checksum, { appliedSteps: index * 3 })),
  });
  const result = evaluateSnapshot("post", snapshot, local);
  assert.equal(result.ok, true);
  assert.ok(result.notes.some((note) => note.includes("applied_steps_count=6")));
});

test("local checksums are SHA-256 of the raw migration file bytes", () => {
  const migrations = readLocalMigrations(resolve("prisma/migrations"));
  assert.deepEqual(
    migrations.map(({ name }) => name),
    local.map(({ name }) => name),
  );
  const file = resolve("prisma/migrations", CUSTOMER_MIGRATION, "migration.sql");
  assert.equal(
    migrations.find(({ name }) => name === CUSTOMER_MIGRATION)?.checksum,
    createHash("sha256").update(readFileSync(file)).digest("hex"),
  );
});
