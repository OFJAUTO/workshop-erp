import type { Metadata } from "next";
import { BodyshopBoard } from "@/components/BodyshopBoard";
import { Logo } from "@/components/Logo";
import { loadBoard } from "@/lib/bodyshop";
import { getCurrentDevice } from "@/lib/devices";
import { Reload } from "../Reload";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bodyshop board", robots: { index: false, follow: false } };

/** The bodyshop board on the TV and the tablets: no login, a registered device only. It refreshes itself every half minute. */
export default async function BodyshopBoardPage() {
  const device = await getCurrentDevice();
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-ink text-white flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/15">
        <Logo onDark className="h-10" alt="OFJ Automotive" />
        <span className="text-xl font-extrabold tracking-[0.12em] uppercase">Bodyshop board</span>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
  if (!device) {
    return shell(<p className="text-lg text-white/80">This screen is not registered. The owner signs in on this device and opens <span className="font-mono">/tablet/register</span>, then comes back to this page.</p>);
  }
  const board = await loadBoard();
  return shell(
    <>
      <Reload seconds={30} />
      <BodyshopBoard cars={board.cars} goingOut={board.goingOut} today={board.today} tomorrow={board.tomorrow} tv />
    </>,
  );
}
