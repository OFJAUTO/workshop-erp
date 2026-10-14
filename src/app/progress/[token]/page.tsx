import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { loadUpdate } from "@/lib/bodyshop-public";
import { customerPageMetadata } from "@/lib/customer-pages";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const WORDS: Record<"arrived" | "film" | "ready", { title: string; line: string }> = {
  arrived: { title: "Your car has arrived", line: "It is checked in and in good hands. We will send a word when the film goes on." },
  film: { title: "Film is going on", line: "The installation is under way. We will tell you when the car is ready for collection." },
  ready: { title: "Your car is ready for collection", line: "Your handover page has the before and after, the warranty and the care instructions." },
};

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const u = await loadUpdate(token);
  return customerPageMetadata(u ? `OFJ Automotive · ${WORDS[u.kind].title}` : "OFJ Automotive", u ? WORDS[u.kind].line : "", `/progress/${token}`);
}

/** One short progress update for the customer: one good photo and one line. Nothing else. */
export default async function ProgressPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [u, settings] = await Promise.all([loadUpdate(token), getSettings()]);
  void settings;
  return (
    <div className="min-h-screen bg-[#E9E9EC] text-[#111113]">
      <main className="mx-auto w-full max-w-[640px] px-0 py-0 sm:px-4 sm:py-6">
        <div className="bg-white sm:shadow-sm sm:rounded-lg flex flex-col">
          <header className="sm:rounded-t-lg flex items-center justify-center bg-[#F4F4F5] border-b-[3px] border-[#111113] py-5 sm:py-7">
            <Logo className="h-14 sm:h-20 w-auto" />
          </header>
          {!u ? (
            <p className="p-6 text-sm">This link is not valid. Please ask the workshop for a new one.</p>
          ) : (
            <div className="flex flex-col gap-4 p-5 sm:p-8" data-progress={u.kind}>
              <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#5F6368]">{u.carTitle}{u.plate ? ` · ${u.plate}` : ""}</span>
              <h1 className="text-2xl font-extrabold">{WORDS[u.kind].title}</h1>
              {u.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.photoUrl} alt={WORDS[u.kind].title} className="aspect-[4/3] w-full rounded-lg object-cover bg-[#F4F4F5]" />
              ) : null}
              <p className="text-sm leading-relaxed">{WORDS[u.kind].line}</p>
              {u.kind === "ready" && u.handoverToken ? (
                <Link href={`/handover/${u.handoverToken}`} className="flex min-h-14 w-full items-center justify-center rounded-lg bg-[#111113] text-base font-extrabold text-white">Open your handover page</Link>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
