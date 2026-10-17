import Link from "next/link";

import { getLoginProviderConfiguration } from "../../../lib/auth-provider-config";
import { GoogleAccountIdCard } from "./google-account-id-card";

export default function RequestAccessPage() {
  const canRetryWithGoogle = getLoginProviderConfiguration(
    process.env,
  ).providers.some(({ id }) => id === "google");

  return (
    <main className="login-page flex min-h-screen flex-col items-center justify-center px-6 py-10 text-center">
      <section
        aria-labelledby="request-access-heading"
        className="login-page__card flex w-full max-w-md flex-col items-center gap-6 rounded-xl p-6 sm:max-w-lg sm:p-8"
      >
        <div className="space-y-2">
          <p aria-hidden="true" className="login-page__ornament">
            ◆
          </p>
          <h1 className="login-page__title text-3xl" id="request-access-heading">
            Solicitar acceso
          </h1>
          <p className="login-page__copy text-sm">
            Tu cuenta de Google aún no está autorizada en PulseMarket.
          </p>
        </div>
        <GoogleAccountIdCard canRetryWithGoogle={canRetryWithGoogle} />
        <Link
          className="login-page__secondary-button inline-flex min-h-12 w-full items-center justify-center rounded-lg px-5 py-3 text-sm font-medium no-underline"
          href="/login"
        >
          Volver al inicio de sesión
        </Link>
      </section>
    </main>
  );
}
