import "server-only";

import type { Session } from "next-auth";

export function requireAuthenticatedSession(
  session: Session | null,
  unauthenticated: () => never,
): Session {
  if (!session) {
    return unauthenticated();
  }

  return session;
}
