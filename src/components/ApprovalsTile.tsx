import Link from "next/link";
import { loadApprovals, KIND_WORDS } from "@/lib/approvals";

/** The owner's dashboard tile (11 November 2026, Section 4): how many approvals wait, and of what kind; opens Approvals. */
export async function ApprovalsTile() {
  const items = await loadApprovals();
  const kinds = Array.from(new Set(items.map((i) => i.kind)));
  return (
    <Link href="/approvals" className={`flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border-2 px-4 py-3 ${items.length ? "border-amber-bar bg-amber-soft" : "border-line bg-white"}`} data-tile="approvals" data-tile-count={items.length}>
      <span className="text-xs font-extrabold uppercase tracking-[0.08em]">Approvals</span>
      <span className="text-2xl font-extrabold">{items.length}</span>
      <span className="text-sm text-muted">{items.length ? kinds.map((k) => `${KIND_WORDS[k]} ${items.filter((i) => i.kind === k).length}`).join(" · ") : "Nothing waiting for you"}</span>
    </Link>
  );
}
