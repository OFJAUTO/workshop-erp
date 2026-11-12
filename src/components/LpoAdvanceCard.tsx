import { Card, SectionLabel } from "@/components/ui";
import { ApplyAdvanceForm, PayFirstForm, PayInAdvanceButton } from "@/components/LpoAdvanceForms";
import { advancesForPo, customerDepositWords, lpoAdvanceReady } from "@/lib/lpo-advance";
import { lpoAmounts } from "@/lib/supplier-vat";
import { applyLpoAdvanceAction, payFirstAction, payInAdvanceAction } from "@/app/(app)/parts/lpo-advance-actions";
import { SUPPLIER_PAY_METHODS } from "@/lib/zoho-sync";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

type Po = { id: string; number: string; kind?: string | null; status: string; job_id: string | null; supplier_id: string | null; supplier_name: string; total_cost_aed: number; supplier_invoice_status: string | null; supplier_invoice_number: string | null; supplier_paid_at: string | null; pay_first_at?: string | null; pay_first_note?: string | null };
const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * THE advance against an LPO (13 November 2026, Section 4), one card on the LPO page (#advance) and the same pieces on
 * the Supplier invoices card: "ADVANCE PAID AED … – date", the parts desk's "Supplier needs payment first", accounts'
 * "Pay in advance" before the invoice and "Apply the advance to this invoice" after it.
 */
export async function LpoAdvanceCard({ po, role, viewingAs, compact = false }: { po: Po; role: string; viewingAs: boolean; compact?: boolean }) {
  if (!(await lpoAdvanceReady())) return null;
  if (po.kind === "main" || po.status === "cancelled" || po.status === "pending_approval") return null;
  // The "pay first" mark is read here (the callers' LPO reads predate it).
  const { data: pf } = await createAdminClient().from("purchase_orders").select("pay_first_at, pay_first_note").eq("id", po.id).maybeSingle();
  po = { ...po, pay_first_at: (pf?.pay_first_at as string | null) ?? null, pay_first_note: (pf?.pay_first_note as string | null) ?? null };
  const advances = await advancesForPo(po.id);
  const invoiced = po.supplier_invoice_status === "received" && !!po.supplier_invoice_number;
  const canPay = (role === "owner" || role === "accounts") && !viewingAs;
  const canAsk = ["owner", "parts", "accounts"].includes(role) && !viewingAs;
  const left = advances.reduce((a, x) => a + x.left, 0);
  const paid = advances.reduce((a, x) => a + x.amount, 0);
  // Nothing to say on a paid LPO with no advance, or an invoiced one with nothing left to apply.
  if (!advances.length && (invoiced || po.supplier_paid_at) && !po.pay_first_at) return null;
  const gross = (await lpoAmounts([po])).get(po.id)?.gross ?? Number(po.total_cost_aed);
  // eslint-disable-next-line react-hooks/purity
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const body = (
    <div className="flex flex-col gap-2" data-lpo-advance={po.id}>
      {advances.map((a) => (
        <p key={a.id} className="rounded-control border-2 border-green bg-green-soft px-3 py-2 text-sm font-extrabold text-green-text" data-lpo-advance-paid>
          ADVANCE PAID {aed(a.amount)} – {formatDate(a.paidOn)} ({a.number}){a.left > 0.004 && a.left < a.amount - 0.004 ? ` · ${aed(a.left)} not used yet` : ""}
        </p>
      ))}
      {po.pay_first_at && !advances.length ? <p className="rounded-control border border-amber-bar bg-amber-soft px-3 py-2 text-sm font-bold text-amber-text" data-pay-first-waiting>Supplier needs payment first{po.pay_first_note ? ` – ${po.pay_first_note}` : ""} · waiting for accounts</p> : null}
      {po.pay_first_at && advances.length && !invoiced ? <p className="text-sm font-semibold" data-pay-first-paid>Paid: the parts desk confirms the order with the supplier.</p> : null}
      {!invoiced && !po.supplier_paid_at && canPay ? (
        <PayInAdvanceButton poId={po.id} poNumber={po.number} supplier={po.supplier_name} suggest={Math.max(0, gross - paid)} today={today} depositWords={await customerDepositWords(po.job_id)} methods={SUPPLIER_PAY_METHODS.map((m) => ({ value: m.key, label: m.label }))} action={payInAdvanceAction.bind(null, po.id)} />
      ) : null}
      {!invoiced && !po.pay_first_at && !advances.length && canAsk && !compact ? <PayFirstForm action={payFirstAction.bind(null, po.id)} /> : null}
      {invoiced && !po.supplier_paid_at && left > 0.004 && canPay ? <ApplyAdvanceForm action={applyLpoAdvanceAction.bind(null, po.id)} words={`The invoice is in: apply the advance of ${aed(left)}?`} /> : null}
    </div>
  );
  if (compact) return body;
  return (
    <Card className="flex flex-col gap-2 scroll-mt-4" id="advance" data-lpo-advance-card>
      <SectionLabel>Advance to the supplier</SectionLabel>
      {body}
    </Card>
  );
}

/** The same card by LPO id (the Supplier invoices card and Supplier payments read their LPOs their own way). */
export async function LpoAdvanceByPoId({ poId, role, viewingAs, compact = true }: { poId: string; role: string; viewingAs: boolean; compact?: boolean }) {
  if (!(await lpoAdvanceReady())) return null;
  const { data } = await createAdminClient().from("purchase_orders").select("id, number, kind, status, job_id, supplier_id, supplier_name, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_paid_at").eq("id", poId).maybeSingle();
  if (!data) return null;
  return <LpoAdvanceCard po={data as unknown as Po} role={role} viewingAs={viewingAs} compact={compact} />;
}

/** Supplier payments: the LPOs whose supplier wants payment first and is not paid yet, each with Pay in advance. */
export async function PayFirstList({ role, viewingAs }: { role: string; viewingAs: boolean }) {
  if (!(await lpoAdvanceReady())) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("purchase_orders").select("id, number, supplier_name").not("pay_first_at", "is", null).neq("status", "cancelled").is("supplier_paid_at", null).order("pay_first_at");
  const rows = (data ?? []) as { id: string; number: string; supplier_name: string }[];
  const { data: adv } = rows.length ? await admin.from("supplier_payments").select("advance_for_po_id").in("advance_for_po_id", rows.map((r) => r.id)).eq("status", "recorded") : { data: [] };
  const paid = new Set(((adv ?? []) as { advance_for_po_id: string }[]).map((a) => a.advance_for_po_id));
  const open = rows.filter((r) => !paid.has(r.id));
  if (!open.length) return null;
  return (
    <Card className="flex flex-col gap-3" data-pay-first-list>
      <SectionLabel right={String(open.length)}>Suppliers who want payment first</SectionLabel>
      {open.map((r) => (
        <div key={r.id} className="flex flex-col gap-2 border-t border-line pt-2">
          <span className="text-sm font-bold">{r.number} · {r.supplier_name}</span>
          <LpoAdvanceByPoId poId={r.id} role={role} viewingAs={viewingAs} />
        </div>
      ))}
    </Card>
  );
}
