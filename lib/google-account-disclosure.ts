import "server-only";

import { decode, encode } from "next-auth/jwt";

export const GOOGLE_ACCOUNT_DISCLOSURE_COOKIE =
  "pulsemarket-google-account-disclosure";
export const GOOGLE_ACCOUNT_DISCLOSURE_PATH = "/api/auth/google-account-id";
export const GOOGLE_ACCOUNT_DISCLOSURE_MAX_AGE_SECONDS = 120;
const GOOGLE_ACCOUNT_DISCLOSURE_SALT =
  "pulsemarket-google-account-disclosure-v1";

type OAuthAccountIdentity = {
  provider: string;
  providerAccountId?: string | null;
};

export function googleAccountDisclosureCookieOptions(
  production: boolean,
  maxAge = GOOGLE_ACCOUNT_DISCLOSURE_MAX_AGE_SECONDS,
) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "strict" as const,
    path: GOOGLE_ACCOUNT_DISCLOSURE_PATH,
    maxAge,
  };
}

export async function createGoogleAccountDisclosureToken(
  account: OAuthAccountIdentity | null | undefined,
  secret: string | undefined,
): Promise<string | null> {
  if (
    account?.provider !== "google" ||
    !account.providerAccountId ||
    account.providerAccountId.trim() !== account.providerAccountId
  ) {
    return null;
  }
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for account disclosure.");
  }

  return encode({
    token: {
      purpose: "google-account-disclosure",
      provider: "google",
      providerAccountId: account.providerAccountId,
    },
    secret,
    salt: GOOGLE_ACCOUNT_DISCLOSURE_SALT,
    maxAge: GOOGLE_ACCOUNT_DISCLOSURE_MAX_AGE_SECONDS,
  });
}

export async function consumeGoogleAccountDisclosureToken(
  token: string | undefined,
  secret: string | undefined,
  clearCookie: () => void,
): Promise<string | null> {
  clearCookie();
  if (!token || !secret) return null;

  try {
    const payload = await decode({
      token,
      secret,
      salt: GOOGLE_ACCOUNT_DISCLOSURE_SALT,
    });
    if (
      payload?.purpose !== "google-account-disclosure" ||
      payload.provider !== "google" ||
      typeof payload.providerAccountId !== "string" ||
      payload.providerAccountId.length === 0 ||
      payload.providerAccountId.length > 256 ||
      payload.providerAccountId.trim() !== payload.providerAccountId
    ) {
      return null;
    }
    return payload.providerAccountId;
  } catch {
    return null;
  }
}
