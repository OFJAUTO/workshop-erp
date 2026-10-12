import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { formatDate, formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "OFJ Automotive, LPO verification", robots: { index: false, follow: false } };

/**
 * The page behind the QR code on the supplier copy of an LPO: the LPO number, the supplier, the date, the
 * total and whether it is still valid. Nothing else: no car, no job, no lines, no names.
 */
export default async function LpoVerificationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, number, supplier_name, status, total_cost_aed, approved_at, created_at, superseded_by").eq("verify_token", token).eq("is_active", true).maybeSingle();
  const { data: next } = po?.superseded_by ? await admin.from("purchase_orders").select("number").eq("id", po.superseded_by).maybeSingle() : { data: null };
  const total = po ? Math.round(Number(po.total_cost_aed) * 1.05 * 100) / 100 : 0;
  const state = !po ? null : po.superseded_by ? { label: `Superseded by ${next?.number ?? "a newer LPO"}`, tone: "amber" } : po.status === "cancelled" ? { label: "Cancelled", tone: "red" } : po.status === "pending_approval" ? { label: "Not yet approved", tone: "amber" } : { label: "Valid", tone: "green" };
  const toneClass = state?.tone === "green" ? "border-green bg-green-soft text-green" : state?.tone === "red" ? "border-red-bar bg-red-soft text-red" : "border-amber-bar bg-amber-soft text-amber";
  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto max-w-md px-4 py-8 flex flex-col gap-4">
        <div className="flex justify-center"><Logo className="h-12" /></div>
        <div className="rounded-card border border-line bg-white p-5 flex flex-col gap-3">
          <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-muted">Local purchase order</span>
          {!po || !state ? (
            <p className="text-sm font-semibold text-red">This verification link is not valid.</p>
          ) : (
            <>
              <span className="text-2xl font-extrabold">{po.number}</span>
              <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted">Supplier</dt><dd className="font-semibold">{po.supplier_name}</dd>
                <dt className="text-muted">Date</dt><dd>{formatDate(po.approved_at ?? po.created_at)}</dd>
                <dt className="text-muted">Total</dt><dd className="font-semibold">AED {total.toLocaleString("en-GB", { minimumFractionDigits: 2 })} <span className="font-normal text-muted">including VAT</span></dd>
              </dl>
              <div className={`rounded-control border-2 px-4 py-3 text-center text-lg font-extrabold ${toneClass}`}>{state.label}</div>
              <p className="text-xs text-muted">Checked {formatDateTime(new Date().toISOString())}. Issued electronically by the OFJ Automotive system; no signature or stamp needed.</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
