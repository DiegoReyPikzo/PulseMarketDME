import "server-only";

const requiredAuthEnvironment = [
  "GITHUB_ID",
  "GITHUB_SECRET",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
] as const;

export function assertAuthConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const missing = requiredAuthEnvironment.filter(
    (name) => !environment[name]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required authentication environment variables: ${missing.join(", ")}.`,
    );
  }
}
