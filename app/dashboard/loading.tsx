import { WingedPiggybank } from "../components/loading/winged-piggybank";

export default function DashboardLoading() {
  return (
    <main
      aria-busy="true"
      className="w-full"
    >
      <WingedPiggybank layout="page" />
    </main>
  );
}
