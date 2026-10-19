import Link from "next/link";
import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import { Suspense } from "react";

import { getLoginProviderConfiguration } from "../../lib/auth-provider-config";
import { AccessDeniedHelp } from "./access-denied-help";
import { OAuthSignInButton } from "./oauth-sign-in-button";

type LoginPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

const SESSION_COOKIE_NAMES = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
];

// Provider of an existing session that was denied (for example, an account
// removed from the authorized list). Read-only: it never creates, changes or
// clears a session, and any failure simply means "unknown".
async function getSessionProvider(): Promise<string | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  try {
    const cookieStore = await cookies();
    for (const name of SESSION_COOKIE_NAMES) {
      const token =
        cookieStore.get(name)?.value ??
        cookieStore
          .getAll()
          .filter(
            (cookie) =>
              cookie.name.startsWith(`${name}.`) &&
              /^\d+$/.test(cookie.name.slice(name.length + 1)),
          )
          .sort(
            (left, right) =>
              Number(left.name.slice(name.length + 1)) -
              Number(right.name.slice(name.length + 1)),
          )
          .map((cookie) => cookie.value)
          .join("");
      if (!token) continue;
      const payload = await decode({ token, secret });
      return typeof payload?.provider === "string" ? payload.provider : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function LoginError({
  searchParams,
}: LoginPageProps) {
  const params = await searchParams;
  if (params.error === undefined) return null;
  const accessDenied = params.error === "AccessDenied";
  const sessionProvider = accessDenied ? await getSessionProvider() : null;

  return (
    <div className="flex flex-col items-center gap-3">
      <p
        aria-live="polite"
        className="login-page__error max-w-md rounded-lg p-3 text-sm"
        role="alert"
      >
        No se pudo completar el inicio de sesión. Inténtalo de nuevo.
      </p>
      {accessDenied ? (
        <AccessDeniedHelp sessionProvider={sessionProvider} />
      ) : null}
    </div>
  );
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const configuration = getLoginProviderConfiguration(process.env);
  const description =
    configuration.providers.length === 1
      ? configuration.providers[0].description
      : "Selecciona un proveedor para continuar.";

  return (
    <main className="login-page flex min-h-screen flex-col items-center justify-center px-6 py-10 text-center">
      <section
        aria-labelledby="login-heading"
        className="login-page__card flex w-full max-w-md flex-col items-center gap-6 rounded-xl p-6 sm:p-8"
      >
        <div className="space-y-2">
          <p aria-hidden="true" className="login-page__ornament">
            ◆
          </p>
          <h1 className="login-page__title text-3xl" id="login-heading">
            Acceso a PulseMarket
          </h1>
          <p className="login-page__copy text-sm">{description}</p>
        </div>
        {configuration.error ? (
          <p className="login-page__error max-w-md rounded-lg p-3 text-sm" role="alert">
            No se puede iniciar sesión en este momento. La configuración de
            autenticación está incompleta.
          </p>
        ) : (
          configuration.providers.map((provider) => (
            <OAuthSignInButton
              key={provider.id}
              label={provider.label}
              providerId={provider.id}
            />
          ))
        )}
        <Suspense fallback={null}>
          <LoginError searchParams={searchParams} />
        </Suspense>
        <Link className="login-page__back text-sm underline underline-offset-4" href="/">
          Volver al inicio
        </Link>
      </section>
    </main>
  );
}
