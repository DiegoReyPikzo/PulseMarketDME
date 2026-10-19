"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

// Remembers, for this browser tab only, which provider the user chose on the
// login page, so a later AccessDenied shows the help for that provider.
const LOGIN_PROVIDER_STORAGE_KEY = "pulsemarket-login-provider";

export function rememberLoginProvider(providerId: string): void {
  try {
    window.sessionStorage.setItem(LOGIN_PROVIDER_STORAGE_KEY, providerId);
  } catch {
    // Storage can be unavailable (private mode or blocked site data).
  }
}

function readLoginProvider(): string | null {
  try {
    return window.sessionStorage.getItem(LOGIN_PROVIDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

const subscribe = () => () => {};
const isHelpProvider = (value: string | null) =>
  value === "github" || value === "google";

export function AccessDeniedHelp({
  sessionProvider,
}: {
  sessionProvider: string | null;
}) {
  const chosenProvider = useSyncExternalStore(
    subscribe,
    readLoginProvider,
    () => null,
  );
  const provider = isHelpProvider(chosenProvider)
    ? chosenProvider
    : sessionProvider;

  if (provider === "google") {
    return (
      <>
        <p className="login-page__copy max-w-md text-sm">
          Puedes consultar tu identificador durante los próximos 2 minutos.
          Si pasa ese tiempo, vuelve a intentarlo con Google.
        </p>
        <Link
          className="login-page__back text-sm underline underline-offset-4"
          href="/login/request-access"
        >
          Consultar mi identificador Google para solicitar acceso
        </Link>
      </>
    );
  }

  if (provider === "github") {
    return (
      <p className="login-page__copy max-w-md text-sm">
        Tu cuenta de GitHub aún no está autorizada para acceder a PulseMarket.
        Para solicitar acceso, envía tu GitHub ID al administrador. Puedes
        consultarlo en{" "}
        <code className="break-all">
          https://api.github.com/users/(tu_usuario_de_github)
        </code>{" "}
        (es el número del campo <code>&quot;id&quot;</code>).
      </p>
    );
  }

  return null;
}
