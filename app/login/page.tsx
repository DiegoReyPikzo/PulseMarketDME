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
      className="max-w-md rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300"
      role="alert"
    >
      No se pudo completar el inicio de sesión. Inténtalo de nuevo.
    </p>
  );
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const provider = getAuthProviderSelection(process.env);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Acceso a PulseMarket</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{provider.description}</p>
      </div>
      <Suspense fallback={null}>
        <LoginError searchParams={searchParams} />
      </Suspense>
      <OAuthSignInButton label={provider.label} providerId={provider.id} />
      <Link className="text-sm underline underline-offset-4" href="/">
        Volver al inicio
      </Link>
    </main>
  );
}
