import { z } from "zod";

const accountSchema = z
  .object({
    provider: z.enum(["github", "google"]),
    providerAccountId: z
      .string()
      .min(1)
      .max(256)
      .refine((id) => id.trim().length > 0 && id === id.trim()),
  })
  .strict();

const accountsSchema = z.array(accountSchema).max(1000).superRefine(
  (accounts, context) => {
    const unique = new Set<string>();
    for (const account of accounts) {
      const key = `${account.provider}\0${account.providerAccountId}`;
      if (unique.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate authorized account.",
        });
        return;
      }
      unique.add(key);
    }
  },
);

export type AuthorizedProvider = "github" | "google";

export type ProviderIdentity = {
  provider: string;
  providerAccountId: string;
};

export function parseAuthorizedAccounts(
  value: string | undefined,
): readonly z.infer<typeof accountSchema>[] | null {
  if (value === undefined) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return null;
  }

  const result = accountsSchema.safeParse(decoded);
  return result.success ? result.data : null;
}

export function isListedProviderIdentity(
  provider: unknown,
  providerAccountId: unknown,
  authorizedAccounts: string | undefined,
): boolean {
  if (typeof provider !== "string" || typeof providerAccountId !== "string") {
    return false;
  }

  const accounts = parseAuthorizedAccounts(authorizedAccounts);
  return Boolean(
    accounts?.some(
      (account) =>
        account.provider === provider &&
        account.providerAccountId === providerAccountId,
    ),
  );
}

export function isProxyProviderIdentityAllowed(
  provider: unknown,
  providerAccountId: unknown,
  e2eRunId: unknown,
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  if (provider === "local-oauth") {
    const activeRunId = environment.PULSEMARKET_E2E_RUN_ID;
    return Boolean(
      environment.NODE_ENV !== "production" &&
        activeRunId &&
        /^[A-Za-z0-9_-]{43}$/.test(activeRunId) &&
        e2eRunId === activeRunId &&
        providerAccountId === activeRunId,
    );
  }

  return isListedProviderIdentity(
    provider,
    providerAccountId,
    environment.PULSEMARKET_AUTHORIZED_ACCOUNTS,
  );
}
