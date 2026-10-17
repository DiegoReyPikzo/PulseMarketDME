import "server-only";

import { cookies } from "next/headers";
import type { NextAuthOptions } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";
import { z } from "zod";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";

import { getLoginProviderConfiguration } from "./auth-provider-config";
import { isAuthorizedProviderIdentity } from "./auth-authorization";
import { E2E_AUTH_PROVIDER_ID, getE2eAuthConfiguration } from "./e2e-auth-config";
import {
  createGoogleAccountDisclosureToken,
  GOOGLE_ACCOUNT_DISCLOSURE_COOKIE,
  googleAccountDisclosureCookieOptions,
} from "./google-account-disclosure";

const localOAuthProfileSchema = z.object({
  sub: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
});

type LocalOAuthProfile = z.infer<typeof localOAuthProfileSchema>;

function createLocalOAuthProvider(
  configuration: NonNullable<ReturnType<typeof getE2eAuthConfiguration>>,
  providerId = E2E_AUTH_PROVIDER_ID,
): OAuthConfig<LocalOAuthProfile> {
  const origin = configuration.providerOrigin;
  return {
    id: providerId,
    name: providerId === "google" ? "Google (E2E simulator)" : "Local OAuth simulator",
    type: "oauth",
    authorization: {
      url: new URL("/authorize", origin).toString(),
      params: { scope: "profile email" },
    },
    token: new URL("/token", origin).toString(),
    userinfo: new URL("/userinfo", origin).toString(),
    clientId: configuration.clientId,
    clientSecret: configuration.clientSecret,
    checks: ["state"],
    client: { token_endpoint_auth_method: "client_secret_basic" },
    profile(profile) {
      const parsed = localOAuthProfileSchema.safeParse(profile);
      if (!parsed.success) {
        throw new Error("The local OAuth provider returned an invalid profile.");
      }
      return {
        id: parsed.data.sub,
        name: parsed.data.name,
        email: parsed.data.email,
        image: null,
      };
    },
  };
}

const e2eAuthConfiguration = getE2eAuthConfiguration(process.env);
const loginProviders = getLoginProviderConfiguration(process.env).providers;

export const authOptions = {
  providers: e2eAuthConfiguration
    ? [
        createLocalOAuthProvider(e2eAuthConfiguration),
        ...(e2eAuthConfiguration.googleDenial
          ? [createLocalOAuthProvider(e2eAuthConfiguration, "google")]
          : []),
      ]
    : loginProviders.flatMap((provider) => {
        if (provider.id === "github") {
          return [
            GitHubProvider({
              clientId: process.env.GITHUB_ID!,
              clientSecret: process.env.GITHUB_SECRET!,
              allowDangerousEmailAccountLinking: false,
            }),
          ];
        }
        if (provider.id === "google") {
          return [
            GoogleProvider({
              clientId: process.env.GOOGLE_CLIENT_ID!,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
              allowDangerousEmailAccountLinking: false,
            }),
          ];
        }
        return [];
      }),
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ account }) {
      const authorized = Boolean(
        account?.providerAccountId &&
          isAuthorizedProviderIdentity({
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            e2eRunId:
              account.provider === E2E_AUTH_PROVIDER_ID
                ? e2eAuthConfiguration?.runId
                : undefined,
          }),
      );
      if (account) {
        const cookieStore = await cookies();
        const token =
          !authorized && account.provider === "google"
            ? await createGoogleAccountDisclosureToken(
                account,
                process.env.NEXTAUTH_SECRET,
              )
            : null;
        cookieStore.set(
          GOOGLE_ACCOUNT_DISCLOSURE_COOKIE,
          token ?? "",
          googleAccountDisclosureCookieOptions(
            process.env.NODE_ENV === "production",
            token ? undefined : 0,
          ),
        );
      }
      return authorized;
    },
    async jwt({ token, account }) {
      if (account) {
        if (!account.providerAccountId) {
          delete token.provider;
          delete token.providerAccountId;
          delete token.e2eRunId;
          return token;
        }
        token.provider = account.provider;
        token.providerAccountId = account.providerAccountId;
        if (account.provider === E2E_AUTH_PROVIDER_ID) {
          token.e2eRunId = e2eAuthConfiguration?.runId;
        } else {
          delete token.e2eRunId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      const provider =
        typeof token.provider === "string" ? token.provider : undefined;
      const providerAccountId =
        typeof token.providerAccountId === "string"
          ? token.providerAccountId
          : undefined;
      if (session.user) {
        session.user.provider = provider;
        session.user.providerAccountId = providerAccountId;
      }
      return session;
    },
  },
} satisfies NextAuthOptions;
