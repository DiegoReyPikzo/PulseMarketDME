"use client";

import { signIn } from "next-auth/react";

import { rememberLoginProvider } from "./access-denied-help";

export function OAuthSignInButton({
  providerId,
  label,
}: {
  providerId: string;
  label: string;
}) {
  return (
    <button
      className="login-page__provider-button min-h-12 w-full rounded-lg px-5 py-3 font-medium"
      onClick={() => {
        rememberLoginProvider(providerId);
        void signIn(providerId, { callbackUrl: "/dashboard" });
      }}
      type="button"
    >
      {label}
    </button>
  );
}
