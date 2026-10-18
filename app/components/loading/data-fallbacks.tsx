import type { ReactNode } from "react";

import { ListingSkeleton, SummarySkeleton } from "./skeletons";
import { WingedPiggybank } from "./winged-piggybank";

// Suspense fallbacks for the dashboard data views: the winged piggybank keeps
// announcing the loading state, and a skeleton shaped like the view sits below.

function DataFallback({
  message,
  children,
}: {
  message: string;
  children: ReactNode;
}) {
  // Fallbacks render before DashboardShell, so they reuse its Art Déco
  // backdrop instead of showing the plain document background.
  return (
    <div className="dashboard-shell w-full min-w-0 space-y-6 px-4 py-6 sm:px-8">
      <WingedPiggybank layout="section" message={message} />
      {children}
    </div>
  );
}

export function SummaryFallback() {
  return (
    <DataFallback message="Preparando tu resumen...">
      <SummarySkeleton />
    </DataFallback>
  );
}

export function ProductsFallback() {
  return (
    <DataFallback message="Preparando tu catálogo...">
      <ListingSkeleton columns={7} creationFields={6} filters={5} />
    </DataFallback>
  );
}

export function CustomersFallback() {
  return (
    <DataFallback message="Preparando tus clientes...">
      <ListingSkeleton columns={5} creationFields={3} filters={4} />
    </DataFallback>
  );
}

export function SalesFallback() {
  return (
    <DataFallback message="Preparando tus ventas...">
      <ListingSkeleton columns={5} filters={8} />
    </DataFallback>
  );
}
