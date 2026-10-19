import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

// Dedicated client and pool for the dashboard aggregate query only. The shared
// client in lib/prisma.ts keeps its configuration; no other route uses this one.
//
// These limits bound how long this client waits. They are not the old
// $transaction maxWait/timeout under another name and they do not make the
// query faster:
// - connectionTimeoutMillis: waiting for a pooled connection or opening a new
//   one. pg-pool removes the request from its queue, or destroys the socket of
//   a connection still being opened, and rejects the call.
// - query_timeout: how long the pg client waits for a query result. It rejects
//   the call in JavaScript and does not send a cancel request, so PostgreSQL
//   may keep running the statement after the error.
// No server-side statement_timeout is set.
//
// Cost: a second pg-pool per process. Other pool options keep pg-pool 3.14.0
// defaults (max 10, idleTimeoutMillis 10000), so up to 10 more connections per
// instance and an idle connection closes after 10 s.
export const ANALYTICS_CONNECTION_TIMEOUT_MS = 2_000;
export const ANALYTICS_QUERY_TIMEOUT_MS = 5_000;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set.");
}

const globalForAnalyticsPrisma = globalThis as typeof globalThis & {
  analyticsPrisma?: PrismaClient;
};

const adapter = new PrismaPg({
  connectionString,
  connectionTimeoutMillis: ANALYTICS_CONNECTION_TIMEOUT_MS,
  query_timeout: ANALYTICS_QUERY_TIMEOUT_MS,
});

export const analyticsPrisma =
  globalForAnalyticsPrisma.analyticsPrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForAnalyticsPrisma.analyticsPrisma = analyticsPrisma;
}
