import { createAdminClient } from "@/lib/supabase/admin";
import { returnEndingsReady, returnEndingView } from "@/lib/return-endings";
import { ReturnEnding } from "@/components/ReturnEnding";
import { confirmReturnAdvanceAction, correctReturnEndingAction, saveReturnEndingAction } from "./return-ending-actions";

/**
 * The returned parts of an LPO (or of a list of parts), each with THE return-ending box (20 November 2026, Section 1).
 * Server component: it reads the facts; the box itself is the one shared client component.
 */
export async function ReturnEndingsCard({ poId, partIds, role, title = "Returns on this LPO" }: { poId?: string; partIds?: string[]; role: string; title?: string }) {
  let ids = partIds ?? [];
  if (poId) {
    const { data } = await createAdminClient().from("part_items").select("id, disposition, return_status").eq("po_id", poId);
    ids = ((data ?? []) as { id: string; disposition: string | null; return_status: string | null }[]).filter((p) => p.disposition === "returned" || p.disposition === "return_pending" || p.return_status === "to_return" || p.return_status === "returned").map((p) => p.id);
  }
  if (!ids.length) return null;
  const [ready, views] = await Promise.all([returnEndingsReady(), Promise.all(ids.map((id) => returnEndingView(id, role)))]);
  const list = views.filter((v): v is NonNullable<typeof v> => !!v);
  if (!list.length) return null;
  const isAccounts = role === "owner" || role === "accounts";
  return (
    <section id="returns" className="flex flex-col gap-2 rounded-card border border-line bg-white p-4" data-return-endings>
      <h2 className="text-base font-extrabold">{title}</h2>
      {list.map((v) => (
        <ReturnEnding
          key={v.partId}
          partId={v.partId}
          name={v.name}
          value={v.facts.value}
          paid={v.facts.paid}
          ending={v.ending}
          endingWords={v.endingWords}
          endedBy={v.endedBy}
          advance={v.advance}
          choices={v.choices}
          history={v.history}
          wrong={v.wrong}
          isAccounts={isAccounts}
          ready={ready}
          save={saveReturnEndingAction.bind(null, v.partId)}
          correct={correctReturnEndingAction.bind(null, v.partId)}
          confirm={confirmReturnAdvanceAction.bind(null, v.partId)}
        />
      ))}
    </section>
  );
}
