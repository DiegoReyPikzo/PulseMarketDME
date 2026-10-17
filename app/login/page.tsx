import Link from "next/link";
import { Suspense } from "react";

import { getAuthProviderSelection } from "../../lib/e2e-auth-config";
import { OAuthSignInButton } from "./oauth-sign-in-button";

type LoginPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

async function LoginError({
  searchParams,
}: LoginPageProps) {
  const params = await searchParams;
  if (params.error === undefined) return null;

  return (
    <p
      aria-live="polite"
      className="login-page__error max-w-md rounded-lg p-3 text-sm"
      role="alert"
    >
      No se pudo completar el inicio de sesión. Inténtalo de nuevo.
    </p>
  );
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const provider = getAuthProviderSelection(process.env);

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
          <p className="login-page__copy text-sm">{provider.description}</p>
        </div>
        <Suspense fallback={null}>
          <LoginError searchParams={searchParams} />
        </Suspense>
        <OAuthSignInButton label={provider.label} providerId={provider.id} />
        <Link className="login-page__back text-sm underline underline-offset-4" href="/">
          Volver al inicio
        </Link>
      </section>
    </main>
  );
}
