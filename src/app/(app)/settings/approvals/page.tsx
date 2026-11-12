import { notFound } from "next/navigation";
import { LinkButton, PageHeader, Card } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { dubaiToday, loadAutoConfig } from "@/lib/auto-approve";
import { AutoApproveForm } from "./AutoApproveForm";

/** Settings > Approvals (12 November 2026): the owner's auto-approve switches while he is away. Owner only. */
export default async function AutoApprovePage() {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") notFound();
  const cfg = await loadAutoConfig();
  return (
    <div className="flex flex-col gap-4" data-auto-page>
      <PageHeader title="Approvals while I'm away" subtitle="Tick what may be approved without you. Everything else keeps coming to you." actions={<LinkButton href="/approvals#auto-approved" tone="secondary">Auto-approved list</LinkButton>} />
      <Card>
        <AutoApproveForm cfg={cfg} today={dubaiToday()} />
      </Card>
    </div>
  );
}
