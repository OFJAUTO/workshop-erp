import { notFound } from "next/navigation";
import { PageHeader, Card, Empty } from "@/components/ui";
import { ApprovalBox } from "@/components/ApprovalBox";
import { requireStaff } from "@/lib/auth";
import { KIND_WORDS, loadApprovals, type ApprovalKind } from "@/lib/approvals";

/**
 * APPROVALS (11 November 2026, Section 4): everything in the ERP waiting for the owner, oldest first, grouped by kind,
 * each in THE yellow box with Approve and Refuse (a reason) right here, and Open to its own page.
 */
export default async function ApprovalsPage() {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") notFound();
  const items = await loadApprovals();
  const kinds = Array.from(new Set(items.map((i) => i.kind))) as ApprovalKind[];
  return (
    <div className="flex flex-col gap-4" data-approvals-page={items.length}>
      <PageHeader title="Approvals" subtitle="Everything waiting for your yes or no. Approve here, or refuse with a reason; Open shows the whole page." />
      {items.length === 0 ? <Empty title="Nothing waiting for you" /> : null}
      {kinds.map((k) => (
        <Card key={k} className="flex flex-col gap-2" data-approvals-group={k}>
          <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted">{KIND_WORDS[k]} · {items.filter((i) => i.kind === k).length}</span>
          {items.filter((i) => i.kind === k).map((i) => <ApprovalBox key={i.key} item={i} link />)}
        </Card>
      ))}
    </div>
  );
}
