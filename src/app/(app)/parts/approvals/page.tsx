import { notFound } from "next/navigation";
import { Badge, Button, Card, Empty, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { decideDiscountApproval } from "../remove-actions";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  job_id: string;
  description: string;
  part_number: string | null;
  supplier: string | null;
  part_type: string | null;
  list_price_aed: number | string | null;
  discount_percent: number | string | null;
  cost_aed: number | string | null;
  discount_approval_status: string | null;
  discount_approval_at: string | null;
  discount_approval_note: string | null;
  created_at: string;
  job: { job_number: string; vehicle: { kind: string; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null } | null;
};

const money = (n: number | string | null) => (n === null ? "?" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** The owner's one-tap approval of supplier discounts above the limit (Settings), with the recent decisions under it. */
export default async function DiscountApprovalsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") notFound();
  const { message, error } = await searchParams;
  const [settings, { data }] = await Promise.all([
    getSettings(),
    createAdminClient().from("part_items").select("id, job_id, description, part_number, supplier, part_type, list_price_aed, discount_percent, cost_aed, discount_approval_status, discount_approval_at, discount_approval_note, created_at, job:jobs(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").in("discount_approval_status", ["pending", "approved", "refused"]).order("created_at", { ascending: false }).limit(100),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const pending = rows.filter((r) => r.discount_approval_status === "pending");
  const decided = rows.filter((r) => r.discount_approval_status !== "pending").slice(0, 20);
  const limit = Number(settings.supplier_discount_approval_above_percent ?? 70);
  const line = (r: Row) => `${r.job?.job_number ?? ""}${r.job?.vehicle ? ` · ${formatPlate(r.job.vehicle)}` : ""}`;
  return (
    <>
      <PageHeader title="Supplier discounts to approve" subtitle={`A discount above ${limit}% waits for you before the part counts as priced. Change the limit in Settings.`} actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${pending.length}`}>Waiting for you</SectionLabel>
        {pending.length === 0 ? <Empty title="Nothing waiting">Every supplier discount is within the limit, or already decided.</Empty> : (
          <ul className="divide-y divide-line">
            {pending.map((r) => (
              <li key={r.id} className="py-3 flex flex-col gap-2" data-approval-row>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-extrabold">{r.description}</span>
                  {r.part_number ? <span className="text-muted">{r.part_number}</span> : null}
                  <Badge tone="amber">{r.discount_percent}% from {r.supplier ?? "no supplier"}</Badge>
                  <span className="text-muted">List AED {money(r.list_price_aed)} · net AED {money(r.cost_aed)} · {line(r)}</span>
                  <LinkButton href={`/parts/${r.job_id}`} tone="secondary" size="md">Parts page</LinkButton>
                </div>
                <form action={decideDiscountApproval.bind(null, r.id)} className="flex flex-wrap items-center gap-2">
                  <Input name="note" placeholder="Note (optional)" className="min-h-10 w-64 text-sm" textCase="sentence" />
                  <Button type="submit" name="decision" value="approve" size="md">Approve</Button>
                  <Button type="submit" name="decision" value="refuse" tone="secondary" size="md">Refuse: use the standard</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {decided.length ? (
        <Card className="flex flex-col gap-2">
          <SectionLabel>Recent decisions</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {decided.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.description}</span>
                <Badge tone={r.discount_approval_status === "approved" ? "green" : "neutral"}>{r.discount_approval_status === "approved" ? "Approved" : "Refused"} · {r.discount_percent}%</Badge>
                <span className="text-muted">{r.supplier ?? ""} · {line(r)}{r.discount_approval_at ? ` · ${formatDateTime(r.discount_approval_at)}` : ""}{r.discount_approval_note ? ` · ${r.discount_approval_note}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
