import Link from "next/link";
import { Suspense } from "react";

import { getLoginProviderConfiguration } from "../../lib/auth-provider-config";
import { OAuthSignInButton } from "./oauth-sign-in-button";

type LoginPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

async function LoginError({
  searchParams,
}: LoginPageProps) {
  const params = await searchParams;
  if (params.error === undefined) return null;
  const canRequestGoogleAccess = params.error === "AccessDenied";

  return (
    <div className="flex flex-col items-center gap-3">
      <p
        aria-live="polite"
        className="login-page__error max-w-md rounded-lg p-3 text-sm"
        role="alert"
      >
        No se pudo completar el inicio de sesión. Inténtalo de nuevo.
      </p>
      {canRequestGoogleAccess ? (
        // Full navigation to a plain-text route handler; <Link> prefetch/RSC
        // fetches could hit the route, which clears the disclosure cookie.
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a
          className="login-page__back text-sm underline underline-offset-4"
          href="/api/auth/google-account-id"
        >
          Consultar mi identificador Google para solicitar acceso
        </a>
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
