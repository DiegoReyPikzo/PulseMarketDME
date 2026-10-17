import "server-only";

import type { NextAuthOptions } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";
import { z } from "zod";
import GitHubProvider from "next-auth/providers/github";

import {
  E2E_AUTH_PROVIDER_ID,
  getE2eAuthConfiguration,
} from "./e2e-auth-config";

const localOAuthProfileSchema = z.object({
  sub: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
});

type LocalOAuthProfile = z.infer<typeof localOAuthProfileSchema>;

function createLocalOAuthProvider(
  configuration: NonNullable<ReturnType<typeof getE2eAuthConfiguration>>,
): OAuthConfig<LocalOAuthProfile> {
  const origin = configuration.providerOrigin;
  return {
    id: E2E_AUTH_PROVIDER_ID,
    name: "Local OAuth simulator",
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

export const authOptions = {
  providers: [
    e2eAuthConfiguration
      ? createLocalOAuthProvider(e2eAuthConfiguration)
      : GitHubProvider({
          clientId: process.env.GITHUB_ID ?? "",
          clientSecret: process.env.GITHUB_SECRET ?? "",
        }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
} satisfies NextAuthOptions;
