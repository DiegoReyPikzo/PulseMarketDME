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
    <div className="dashboard-shell font-sans">
      <aside className="dashboard-shell__sidebar fixed inset-y-0 left-0 hidden w-64 flex-col border-r px-5 py-6 lg:flex">
        <Link className="dashboard-brand text-xl font-semibold" href="/dashboard">
          Pulse<span>Market</span>
        </Link>
        <nav
          aria-label="Navegación principal"
          className="dashboard-shell__nav mt-10 space-y-1"
        >
          {navigation.map((item) => (
            <Link
              aria-current={activePath === item.href ? "page" : undefined}
              className="dashboard-nav-link block rounded-lg px-3 py-2.5 text-sm"
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
        <header className="dashboard-shell__header sticky top-0 z-10 flex min-h-16 flex-wrap items-center justify-between gap-x-4 border-b px-4 py-2 backdrop-blur sm:px-8">
          <Link
            className="dashboard-brand order-1 font-semibold lg:hidden"
            href="/dashboard"
          >
            Pulse<span>Market</span>
          </Link>
          <nav
            aria-label="Navegación principal"
            className="dashboard-shell__nav dashboard-shell__mobile-nav order-3 -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-4 pb-1 lg:hidden"
          >
            {navigation.map((item) => (
              <Link
                aria-current={activePath === item.href ? "page" : undefined}
                className="dashboard-nav-link whitespace-nowrap rounded-md px-3 py-2 text-sm"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="order-2 ml-auto flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-sm text-slate-300 sm:block">
              {session.user?.name ?? "Cuenta de GitHub"}
            </span>
            <SignOutButton />
          </div>
        </header>
        <main className="dashboard-shell__main mx-auto w-full max-w-7xl p-4 sm:p-8">
          {children}
        </main>
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
          <p className="dashboard-shell__identity-detail truncate text-xs">
            {session.user.email}
          </p>
        ) : null}
      </div>
    </div>
  );
}
