import { ApprovalBox, ApprovalWaiting } from "@/components/ApprovalBox";
import { loadApprovals } from "@/lib/approvals";
import type { CurrentStaff } from "@/lib/auth";
import { remindedToday } from "@/lib/approval-reminders";

const MONEY_KINDS = ["void", "overpayment", "early_tax", "lpo", "price", "lathe_void"];

/**
 * The approvals of ONE page, at its top (11 November 2026, Section 4): the owner gets the yellow box with Approve and
 * Refuse; everyone else the "Waiting for owner approval" line. `highlight` = the bell's ?approval= key.
 */
export async function ApprovalsHere({ staff, jobId, quotationId, poId, highlight = null, kinds = null, extras = {} }: { staff: Pick<CurrentStaff, "role_id" | "viewingAs"> & { display_name?: string }; jobId?: string; quotationId?: string; poId?: string; highlight?: string | null; kinds?: string[] | null; /** A kind's own details inside its box, by item key. */ extras?: Record<string, React.ReactNode> }) {
  const items = (await loadApprovals({ jobId, quotationId, poId })).filter((i) => !kinds || kinds.includes(i.kind));
  if (!items.length) return null;
  const owner = staff.role_id === "owner" && !staff.viewingAs;
  // 18 November 2026: the person who asked (and accounts on money items) may remind the owner once a day.
  const reminded = owner ? new Set<string>() : await remindedToday();
  const mayRemind = (i: (typeof items)[number]) => !staff.viewingAs && staff.role_id !== "owner" && ((!!i.askedBy && i.askedBy === staff.display_name) || (staff.role_id === "accounts" && MONEY_KINDS.includes(i.kind)));
  return (
    <div className="flex flex-col gap-2" data-approvals-here={items.length}>
      {items.map((i) => (owner ? <ApprovalBox key={i.key} item={i} highlight={highlight === i.key || (highlight === "1" && items.length === 1)} extra={extras[i.key] ?? null} /> : <ApprovalWaiting key={i.key} item={i} canRemind={mayRemind(i)} remindedToday={reminded.has(i.key)} />))}
    </div>
  );
}
