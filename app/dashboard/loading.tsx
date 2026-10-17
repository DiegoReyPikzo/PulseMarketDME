export default function DashboardLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="mx-auto w-full max-w-7xl p-4 sm:p-8"
    >
      <p className="text-sm text-slate-400">Cargando datos...</p>
    </main>
  );
}
