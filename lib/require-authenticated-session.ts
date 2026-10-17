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

export function requireAuthorizedSession(
  session: Session | null,
  isAuthorized: (session: Session) => boolean,
  unauthenticated: () => never,
  unauthorized: () => never,
): Session {
  if (!session) return unauthenticated();
  if (!isAuthorized(session)) return unauthorized();
  return session;
}
