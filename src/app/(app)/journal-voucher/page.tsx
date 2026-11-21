import { requireStaff } from "@/lib/auth";
import { refuse } from "@/lib/refusal";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { jvReady, loadToRecord, loadVouchers } from "@/lib/journal-vouchers";
import { jvPaidByLabel, jvTypeLabel, toReimburse } from "@/lib/jv-rules";
import { signJobFiles } from "@/lib/work-data";
import { Badge, Card, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { providerList } from "@/lib/providers";
import { ManualVoucherForm, PayVoucherForm, ReimburseForm, ToRecordList, VoidVoucherForm } from "./JvForms";

/**
 * JOURNAL VOUCHER (17 November 2026, Section 6): accounts and the owner ONLY (refused by the server for everyone else).
 * Every charge cost an advisor entered on a job ("Cost (we pay)") arrives as TO RECORD; accounts check it against the
 * receipt and record it (who paid, date, reference, proof) as a voucher JV-00001…, or keep several of one provider's
 * monthly invoice as "pay later". Manual vouchers for expenses not tied to a car; who is owed money back per staff member.
 * A recovery done as a trip (our driver or a recovery company) is paid on the Recovery page, never here.
 */
export default async function JournalVoucherPage() {
  const staff = await requireStaff();
  if (!can(staff.role_id as RoleId, "journalVouchers")) return refuse("no_permission");
  const ready = await jvReady();
  const [toRecord, vouchers] = await Promise.all([loadToRecord(), loadVouchers()]);
  const urls = await signJobFiles([...toRecord.map((r) => r.receiptPath), ...vouchers.map((v) => v.proofPath)].filter((x): x is string => !!x));
  const { data: ppl } = await createAdminClient().from("staff").select("id, display_name").eq("is_active", true).order("display_name");
  const staffList = ((ppl ?? []) as { id: string; display_name: string }[]).map((p) => ({ id: p.id, name: p.display_name }));
  const unpaid = vouchers.filter((v) => v.status === "unpaid");
  const owed = toReimburse(vouchers.map((v) => ({ staffId: v.staffId, staffName: v.staffName, amount: v.amount, vat: v.vat, status: v.status, reimbursedAt: v.reimbursedAt, paidBy: v.paidBy })));
  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const acts = !staff.viewingAs;
  const providers = acts ? await providerList() : [];
  return (
    <div className="flex flex-col gap-4" data-journal-voucher>
      <PageHeader title="Journal Voucher" subtitle="Charge costs entered on jobs (recovery, fuel, delivery, other): record who paid them, or keep them to pay later. Accounts and the owner." />
      {!ready ? <Notice tone="info">The Journal Voucher switches on once the database change is applied (it is on the WAITING FOR APPLY list).</Notice> : null}

      <Card className="flex flex-col gap-3" data-jv-to-record>
        <SectionLabel right={`${toRecord.length}`}>To record</SectionLabel>
        {acts ? <ToRecordList rows={toRecord.map((r) => ({ ...r, receiptUrl: r.receiptPath ? urls[r.receiptPath] ?? null : null }))} staff={staffList} providers={providers} /> : <p className="text-sm text-muted">View as is read-only.</p>}
      </Card>

      {unpaid.length ? (
        <Card className="flex flex-col gap-2" data-jv-unpaid>
          <SectionLabel right={`${unpaid.length}`}>Pay later – not paid yet</SectionLabel>
          <ul className="divide-y divide-line">
            {unpaid.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm" data-jv-unpaid-row={v.number}>
                <span className="font-bold">{v.number}</span>
                <span>{v.description}</span>
                {v.jobs.length ? <span className="text-muted">{v.jobs.join(", ")}</span> : null}
                <span className="ml-auto font-semibold">AED {fmt(v.amount + v.vat)}</span>
                {acts ? <PayVoucherForm id={v.id} number={v.number} total={v.amount + v.vat} staff={staffList} /> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-2" data-jv-reimburse-list>
        <SectionLabel>To reimburse (paid with a staff member&apos;s own money)</SectionLabel>
        {owed.length === 0 ? <p className="text-sm text-muted">Nobody is owed money back.</p> : null}
        <ul className="divide-y divide-line">
          {owed.map((o) => (
            <li key={o.staffId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm" data-jv-owed={o.staffName}>
              <span className="font-bold">{o.staffName}</span>
              <span className="text-muted">{o.count} voucher{o.count === 1 ? "" : "s"}</span>
              <span className="ml-auto font-semibold">AED {fmt(o.total)}</span>
              {acts ? <span className="basis-full"><ReimburseForm ids={vouchers.filter((v) => v.staffId === o.staffId && v.paidBy === "staff" && !v.reimbursedAt && v.status === "paid").map((v) => v.id)} name={o.staffName} total={o.total} /></span> : null}
            </li>
          ))}
        </ul>
      </Card>

      {acts && ready ? (
        <Card className="flex flex-col gap-2" data-jv-manual>
          <SectionLabel>Manual voucher (an expense not tied to a car)</SectionLabel>
          <ManualVoucherForm staff={staffList} />
        </Card>
      ) : null}

      <Card className="flex flex-col gap-2" data-jv-history>
        <SectionLabel right={`${vouchers.length}`}>Vouchers</SectionLabel>
        {vouchers.length ? <a href="/api/export/journal-vouchers" className="self-start text-sm font-bold underline underline-offset-4" data-jv-export>Download Excel</a> : null}
        {vouchers.length === 0 ? <p className="text-sm text-muted">No vouchers yet.</p> : null}
        <ul className="divide-y divide-line">
          {vouchers.map((v) => (
            <li key={v.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm ${v.status === "void" ? "text-muted line-through" : ""}`} data-jv-voucher={v.number}>
              <span className="font-bold">{v.number}</span>
              <span>{v.paidOn ? formatDate(v.paidOn) : "not paid yet"}</span>
              <span className="text-muted">{jvTypeLabel(v.type)}{v.provider ? ` · ${v.provider}` : ""}{v.jobs.length ? ` · ${v.jobs.join(", ")}` : v.kind === "manual" ? " · no car" : ""}</span>
              <Badge tone={v.status === "void" ? "neutral" : v.status === "unpaid" ? "amber" : "green"}>{v.status === "void" ? "Void" : v.status === "unpaid" ? "Pay later" : jvPaidByLabel(v.paidBy)}</Badge>
              {v.paidBy === "staff" ? <Badge tone={v.reimbursedAt ? "green" : "amber"}>{v.staffName}: {v.reimbursedAt ? "reimbursed" : "to reimburse"}</Badge> : null}
              {v.noReceipt ? <Badge tone="amber" data-jv-tag-no-receipt>No receipt</Badge> : null}
              {v.providerInvoice || v.providerTrn ? <span className="basis-full text-xs text-muted" data-jv-voucher-bill>{[v.provider, v.providerTrn ? `TRN ${v.providerTrn}` : null, v.providerInvoice ? `invoice ${v.providerInvoice}` : null, v.providerInvoiceDate ? formatDate(v.providerInvoiceDate) : null, v.vat > 0 ? `VAT AED ${fmt(v.vat)} reclaimable` : null].filter(Boolean).join(" · ")}</span> : null}
              {v.proofPath && urls[v.proofPath] ? <a href={urls[v.proofPath]} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4 no-underline">Proof</a> : null}
              <span className="ml-auto font-semibold">AED {fmt(v.amount + v.vat)}</span>
              {v.by ? <span className="basis-full text-xs text-muted">by {v.by}{v.reference ? ` · ref ${v.reference}` : ""}{v.voidReason ? ` · voided: ${v.voidReason}` : ""}</span> : null}
              {acts && v.status !== "void" ? <span className="basis-full no-underline"><VoidVoucherForm id={v.id} number={v.number} /></span> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
