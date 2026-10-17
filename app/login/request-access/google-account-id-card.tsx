"use client";

import { useEffect, useRef, useState } from "react";

import { OAuthSignInButton } from "../oauth-sign-in-button";

// Must match GOOGLE_ACCOUNT_DISCLOSURE_PATH (server-only module).
const DISCLOSURE_PATH = "/api/auth/google-account-id";

// "unavailable" is only the endpoint's 404 (missing, invalid, or expired
// credential); network errors, 403, and other server errors are "failed".
type DisclosureResult =
  | { status: "ready"; providerAccountId: string }
  | { status: "unavailable" }
  | { status: "failed" };

type CardState = { status: "loading" } | DisclosureResult;

type CopyStatus = "idle" | "copied" | "failed";

async function requestGoogleAccountId(): Promise<DisclosureResult> {
  try {
    const response = await fetch(DISCLOSURE_PATH, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) return { status: "unavailable" };
    if (!response.ok) return { status: "failed" };
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "providerAccountId" in body &&
      typeof body.providerAccountId === "string" &&
      body.providerAccountId.length > 0
    ) {
      return { status: "ready", providerAccountId: body.providerAccountId };
    }
    return { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

export function GoogleAccountIdCard({
  canRetryWithGoogle,
}: {
  canRetryWithGoogle: boolean;
}) {
  const [state, setState] = useState<CardState>({ status: "loading" });
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  // One request per mounted page: refs survive StrictMode's effect replay,
  // so the cookie-clearing endpoint is not called twice.
  // No automatic retry: a failed request is shown, never repeated.
  const request = useRef<Promise<DisclosureResult> | null>(null);

  useEffect(() => {
    let active = true;
    request.current ??= requestGoogleAccountId();
    void request.current.then((result) => {
      if (active) setState(result);
    });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <p aria-busy="true" className="login-page__copy text-sm" role="status">
        Consultando tu identificador…
      </p>
    );
  }

  if (state.status === "failed") {
    return (
      <div
        className="login-page__error w-full space-y-1 rounded-lg p-4 text-left text-sm"
        role="alert"
      >
        <p className="font-medium">No pudimos completar la consulta.</p>
        <p>Vuelve al inicio de sesión e inténtalo de nuevo.</p>
      </div>
    );
  }

  if (state.status === "unavailable") {
    return (
      <div className="flex w-full flex-col gap-4">
        <div
          className="login-page__error space-y-1 rounded-lg p-4 text-left text-sm"
          role="alert"
        >
          <p className="font-medium">No pudimos recuperar tu identificador.</p>
          <p>
            El enlace temporal puede haber caducado o el identificador ya se
            consultó en este navegador. Vuelve a intentarlo con Google.
          </p>
        </div>
        {canRetryWithGoogle ? (
          <OAuthSignInButton label="Reintentar con Google" providerId="google" />
        ) : null}
      </div>
    );
  }

  const { providerAccountId } = state;

  async function copyIdentifier() {
    try {
      await navigator.clipboard.writeText(providerAccountId);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <p className="login-page__copy text-sm">
        Copia este identificador y compártelo con el administrador para
        solicitar acceso. Si recargas o sales de esta pantalla, tendrás que
        volver a identificarte con Google para consultarlo otra vez.
      </p>
      <div className="login-page__identifier rounded-lg p-4 text-left">
        <p
          className="login-page__identifier-label text-xs font-medium uppercase tracking-[0.18em]"
          id="google-account-id-label"
        >
          Identificador estable de tu cuenta de Google
        </p>
        <p
          aria-labelledby="google-account-id-label"
          className="login-page__identifier-value mt-2 break-all font-mono text-base select-all"
        >
          {providerAccountId}
        </p>
      </div>
      <button
        className="login-page__provider-button min-h-12 w-full rounded-lg px-5 py-3 font-medium"
        onClick={() => void copyIdentifier()}
        type="button"
      >
        Copiar identificador
      </button>
      <p
        aria-live="polite"
        className={`min-h-5 text-sm ${
          copyStatus === "failed"
            ? "login-page__copy-feedback--error"
            : "login-page__copy-feedback"
        }`}
        role="status"
      >
        {copyStatus === "copied"
          ? "Identificador copiado."
          : copyStatus === "failed"
            ? "No se pudo copiar. Selecciona el identificador y cópialo manualmente."
            : ""}
      </p>
    </div>
  );
}
