import { notFound } from "next/navigation";
import { LinkButton, PageHeader, Card, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { APPROVAL_KINDS, KIND_WORDS } from "@/lib/approvals";
import { dubaiToday, loadAutoConfig } from "@/lib/auto-approve";
import { ROLE_LABELS, type RoleId } from "@/lib/roles";
import { loadStandIn } from "@/lib/standin";
import { standInActive } from "@/lib/standin-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { roleTitleOf } from "@/lib/teams";
import { AutoApproveForm } from "./AutoApproveForm";
import { StandInForm } from "./StandInForm";

/**
 * Settings > Approvals (12 November 2026): the owner's auto-approve switches while he is away; and since 13 November
 * (Section 15) "Send my approvals to <person>" - the stand-in, beside auto-approve, through the same Approvals page.
 * Owner only.
 */
export default async function AutoApprovePage() {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") notFound();
  const [cfg, sCfg, { data: people }] = await Promise.all([
    loadAutoConfig(),
    loadStandIn(),
    createAdminClient().from("staff").select("id, display_name, role_id, department_id, team").eq("is_active", true).in("role_id", ["workshop_manager", "accounts", "service_advisor", "parts"]).order("display_name"),
  ]);
  const today = dubaiToday();
  const list = ((people ?? []) as { id: string; display_name: string; role_id: string; department_id: string | null; team: string | null }[]).map((p) => ({ id: p.id, name: p.display_name, role: roleTitleOf(p, ROLE_LABELS[p.role_id as RoleId] ?? p.role_id) }));
  return (
    <div className="flex flex-col gap-4" data-auto-page>
      <PageHeader title="Approvals while I'm away" subtitle="Tick what may be approved without you, or send your approvals to a person. Everything else keeps coming to you." actions={<LinkButton href="/approvals#auto-approved" tone="secondary">Auto-approved list</LinkButton>} />
      <Card>
        <AutoApproveForm cfg={cfg} today={today} />
      </Card>
      <Card className="flex flex-col gap-3" id="stand-in">
        <SectionLabel>Send my approvals to a person</SectionLabel>
        <StandInForm cfg={sCfg} active={standInActive(sCfg, today)} people={list} kinds={APPROVAL_KINDS.map((k) => ({ key: k, label: KIND_WORDS[k] }))} today={today} />
      </Card>
    </div>
  );
}
