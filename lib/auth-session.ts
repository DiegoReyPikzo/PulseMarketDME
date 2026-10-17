import "server-only";

import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";

import { assertAuthConfiguration } from "./auth-config";
import { authOptions } from "./auth";
import { requireAuthenticatedSession } from "./require-authenticated-session";

export async function getAuthenticatedSession(): Promise<Session> {
  assertAuthConfiguration();
  const session = await getServerSession(authOptions);

  return requireAuthenticatedSession(session, () => redirect("/login"));
}
