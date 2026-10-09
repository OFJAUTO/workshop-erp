import { notFound } from "next/navigation";
import { Badge, Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { JOB_BRIEF_SELECT, PART_FULL_SELECT, toPartFull, type JobBrief } from "@/lib/parts-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { issueParts, returnPart } from "../../order-actions";
import { IssueParts, type IssuePart } from "./IssueParts";

export const dynamic = "force-dynamic";

/** Issue the received parts of a job to the technician, scan returns back. */
export default async function IssuePartsPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("managePurchaseOrders");
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const [{ data: job }, { data: rows }, { data: techs }] = await Promise.all([
    admin.from("jobs").select(JOB_BRIEF_SELECT).eq("id", jobId).maybeSingle(),
    admin.from("part_items").select(PART_FULL_SELECT).eq("job_id", jobId).eq("is_active", true).neq("order_status", "none").order("created_at"),
    admin.from("staff").select("id, display_name").eq("role_id", "technician").eq("is_active", true).order("display_name"),
  ]);
  if (!job) notFound();
  const j = job as unknown as JobBrief;
  const parts = ((rows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  const { data: pos } = parts.length ? await admin.from("purchase_orders").select("id, status").in("id", parts.map((p) => p.po_id).filter((x): x is string => !!x)) : { data: [] };
  const approved = new Set((pos ?? []).filter((p) => !["pending_approval", "cancelled"].includes(p.status)).map((p) => p.id));
  const items: IssuePart[] = parts.map((p) => ({ id: p.id, description: p.description, part_number: p.part_number, label_code: p.label_code, received_qty: p.received_qty, issue_status: p.issue_status, return_status: p.return_status, on_approved_po: (!!p.po_id && approved.has(p.po_id)) || p.availability === "in_stock" }));
  const issued = parts.filter((p) => p.issue_status === "confirmed");
  const techList = (techs ?? []).sort((a, b) => (a.id === j.assigned_to ? -1 : b.id === j.assigned_to ? 1 : 0));

  return (
    <>
      <PageHeader title={`Issue parts · ${j.vehicle ? formatPlate(j.vehicle) : j.job_number}`} subtitle={`${[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · ${j.job_number}`} actions={<><LinkButton href={`/parts/labels/${jobId}`} tone="secondary" size="lg">Print labels</LinkButton><LinkButton href={`/parts/${jobId}`} tone="secondary" size="lg">Parts desk</LinkButton></>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${items.filter((p) => p.issue_status !== "confirmed").length} to issue`}>Scan and issue</SectionLabel>
        {items.length === 0 ? <p className="text-sm text-muted">No approved parts on this job.</p> : <IssueParts parts={items} technicians={techList} action={issueParts.bind(null, jobId)} />}
      </Card>
      {issued.length ? (
        <Card className="flex flex-col gap-3">
          <SectionLabel right={`${issued.length}`}>Issued (scan back to return)</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {issued.map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap items-center gap-3">
                <span className="font-semibold">{p.description}</span>
                <span className="text-muted">{p.label_code} · issued {formatDateTime(p.issued_at)}</span>
                <Badge tone="green">Confirmed by the technician</Badge>
                <form action={returnPart.bind(null, p.id)} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="stage" value="to_return" />
                  <Input name="note" placeholder="Why it goes back" className="w-48" />
                  <Button type="submit" tone="secondary" size="md">Scan back</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {parts.some((p) => p.return_status === "to_return") ? (
        <Card className="flex flex-col gap-3 border-red-bar">
          <SectionLabel>To return to the supplier</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {parts.filter((p) => p.return_status === "to_return").map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap items-center gap-3">
                <span className="font-semibold">{p.description}</span>
                <span className="text-muted">{p.return_note}</span>
                <form action={returnPart.bind(null, p.id)} className="ml-auto">
                  <input type="hidden" name="stage" value="returned" />
                  <Button type="submit" tone="secondary" size="md">Returned to supplier, take the cost off</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
