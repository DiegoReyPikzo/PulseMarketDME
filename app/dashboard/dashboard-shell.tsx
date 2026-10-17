import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Session } from "next-auth";

import { SignOutButton } from "./sign-out-button";

const navigation = [
  { href: "/dashboard", label: "Resumen" },
  { href: "/dashboard/products", label: "Productos" },
  { href: "/dashboard/customers", label: "Clientes" },
  { href: "/dashboard/sales", label: "Ventas" },
] as const;

type DashboardShellProps = {
  session: Session;
  activePath: (typeof navigation)[number]["href"];
  children: ReactNode;
};

export function DashboardShell({
  session,
  activePath,
  children,
}: DashboardShellProps) {
  return (
    <div className="min-h-screen bg-[#0b1117] font-sans text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-800 bg-[#0e151d] px-5 py-6 lg:flex">
        <Link className="text-xl font-semibold tracking-tight" href="/dashboard">
          Pulse<span className="text-cyan-400">Market</span>
        </Link>
        <nav aria-label="Navegación principal" className="mt-10 space-y-1">
          {navigation.map((item) => (
            <Link
              aria-current={activePath === item.href ? "page" : undefined}
              className={`block rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 ${
                activePath === item.href
                  ? "bg-cyan-400/10 font-medium text-cyan-300"
                  : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
              }`}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <UserIdentity session={session} className="mt-auto border-t border-slate-800 pt-5" />
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-4 border-b border-slate-800 bg-[#0b1117]/95 px-4 backdrop-blur sm:px-8">
          <Link className="font-semibold lg:hidden" href="/dashboard">
            Pulse<span className="text-cyan-400">Market</span>
          </Link>
          <nav
            aria-label="Navegación principal"
            className="flex items-center gap-1 overflow-x-auto lg:hidden"
          >
            {navigation.map((item) => (
              <Link
                aria-current={activePath === item.href ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 ${
                  activePath === item.href
                    ? "text-cyan-300"
                    : "text-slate-400 hover:text-slate-100"
                }`}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-sm text-slate-300 sm:block">
              {session.user?.name ?? "Cuenta de GitHub"}
            </span>
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}

function UserIdentity({
  session,
  className,
}: {
  session: Session;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      {session.user?.image ? (
        <Image
          alt=""
          className="h-10 w-10 rounded-full border border-slate-700"
          height={40}
          src={session.user.image}
          unoptimized
          width={40}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-cyan-300"
        >
          {(session.user?.name ?? "G").slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-100">
          {session.user?.name ?? "Cuenta de GitHub"}
        </p>
        {session.user?.email ? (
          <p className="truncate text-xs text-slate-500">
            {session.user.email}
          </p>
        ) : null}
      </div>
    </div>
  );
}
