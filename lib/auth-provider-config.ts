import { E2E_AUTH_PROVIDER_ID, getE2eAuthConfiguration } from "./e2e-auth-config";

export type LoginProvider = {
  id: string;
  label: string;
  description: string;
};

export type LoginProviderConfiguration = {
  providers: readonly LoginProvider[];
  error: string | null;
};

const PROVIDERS = [
  {
    id: "github",
    clientId: "GITHUB_ID",
    clientSecret: "GITHUB_SECRET",
    label: "Continuar con GitHub",
    description: "Inicia sesión con tu cuenta de GitHub.",
  },
  {
    id: "google",
    clientId: "GOOGLE_CLIENT_ID",
    clientSecret: "GOOGLE_CLIENT_SECRET",
    label: "Continuar con Google",
    description: "Inicia sesión con tu cuenta de Google.",
  },
] as const;

export function getLoginProviderConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): LoginProviderConfiguration {
  try {
    const e2e = getE2eAuthConfiguration(environment);
    if (e2e) {
      return {
        providers: [
          {
            id: E2E_AUTH_PROVIDER_ID,
            label: "Continuar con OAuth simulado",
            description:
              "Usa un proveedor OAuth simulado local; no inicia sesión en GitHub ni Google.",
          },
          ...(e2e.googleDenial
            ? [
                {
                  id: "google",
                  label: "Continuar con Google (simulado para pruebas)",
                  description:
                    "Ejecuta un rechazo Google simulado en el entorno E2E aislado.",
                },
              ]
            : []),
        ],
        error: null,
      };
    }
  } catch {
    return {
      providers: [],
      error: "La configuración de autenticación no está completa.",
    };
  }

  const missing: string[] = [];
  for (const name of ["NEXTAUTH_SECRET", "NEXTAUTH_URL"] as const) {
    if (!environment[name]?.trim()) missing.push(name);
  }

  const configured: LoginProvider[] = [];
  for (const provider of PROVIDERS) {
    const hasId = Boolean(environment[provider.clientId]?.trim());
    const hasSecret = Boolean(environment[provider.clientSecret]?.trim());
    if (hasId !== hasSecret) {
      missing.push(provider.clientId, provider.clientSecret);
    } else if (hasId && hasSecret) {
      configured.push({
        id: provider.id,
        label: provider.label,
        description: provider.description,
      });
    }
  }

  if (configured.length === 0) {
    missing.push("GITHUB_ID/GITHUB_SECRET or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET");
  }

  if (missing.length > 0) {
    return {
      providers: [],
      error: `Configuración de autenticación incompleta: ${[...new Set(missing)].join(", ")}.`,
    };
  }

  return { providers: configured, error: null };
}
