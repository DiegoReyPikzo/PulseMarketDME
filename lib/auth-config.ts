import "server-only";

import { getE2eAuthConfiguration } from "./e2e-auth-config";

const requiredAuthEnvironment = [
  "GITHUB_ID",
  "GITHUB_SECRET",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
] as const;

export function assertAuthConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (getE2eAuthConfiguration(environment)) return;

  const missing = requiredAuthEnvironment.filter(
    (name) => !environment[name]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required authentication environment variables: ${missing.join(", ")}.`,
    );
  }
}
