import "server-only";
import { createAdminClient } from "./supabase/admin";

/**
 * Estimate → job carry-over, THE exactness check (6 November 2026): the job's quotation must equal its estimate line by
 * line (each copy found by the estimate line it came from), with the same VAT and total. Read by the carry-over and by
 * the quotation page's red warning.
 */
/** The estimate's lines with no copy on this quotation (by the line they came from), and the copies whose amount differs. */
export async function carryDifferences(estimateId: string, quotationId: string) {
  const admin = createAdminClient();
  const [{ data: est }, { data: q }, { data: estLines }, { data: qLines }] = await Promise.all([
    admin.from("quotations").select("number, status, approver_name, responded_at, total_aed, vat_aed, sent_to_phone").eq("id", estimateId).maybeSingle(),
    admin.from("quotations").select("number, status, total_aed, vat_aed").eq("id", quotationId).maybeSingle(),
    admin.from("quotation_lines").select("id, title, line_total, fee_kind, line_type").eq("quotation_id", estimateId).eq("is_active", true).order("position"),
    admin.from("quotation_lines").select("source_key, line_total, fee_kind").eq("quotation_id", quotationId).eq("is_active", true),
  ]);
  const copied = new Map(((qLines ?? []) as { source_key: string | null; line_total: number | string | null; fee_kind: string | null }[]).filter((l) => !l.fee_kind && l.source_key).map((l) => [l.source_key as string, Number(l.line_total) || 0]));
  const own = ((estLines ?? []) as { id: string; title: string; line_total: number | string | null; fee_kind: string | null; line_type: string }[]).filter((l) => !l.fee_kind);
  const missing = own.filter((l) => !copied.has(l.id));
  const changed = own.filter((l) => copied.has(l.id) && Math.abs((copied.get(l.id) ?? 0) - (Number(l.line_total) || 0)) > 0.005);
  const dTotal = Math.round(((Number(q?.total_aed) || 0) - (Number(est?.total_aed) || 0)) * 100) / 100;
  const dVat = Math.round(((Number(q?.vat_aed) || 0) - (Number(est?.vat_aed) || 0)) * 100) / 100;
  return { est, q, missing, changed, dTotal, dVat, exact: !missing.length && !changed.length && Math.abs(dTotal) <= 0.005 && Math.abs(dVat) <= 0.005 };
}

/** The words of a copy that is not exact, or null. */
export async function carryWarning(estimateId: string, quotationId: string): Promise<{ words: string; missing: number } | null> {
  const d = await carryDifferences(estimateId, quotationId);
  if (d.exact || !d.est) return null;
  const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parts = [
    d.missing.length ? `${d.missing.length} line${d.missing.length === 1 ? "" : "s"} missing (${d.missing.map((l) => l.title).join("; ").slice(0, 200)})` : null,
    d.changed.length ? `${d.changed.length} line${d.changed.length === 1 ? "" : "s"} at a different amount (${d.changed.map((l) => l.title).join("; ").slice(0, 120)})` : null,
    Math.abs(d.dTotal) > 0.005 ? `total AED ${aed(Number(d.q?.total_aed) || 0)} vs the estimate's AED ${aed(Number(d.est.total_aed) || 0)} (${d.dTotal > 0 ? "+" : "−"}${aed(Math.abs(d.dTotal))})` : null,
  ].filter(Boolean);
  return { words: `Not an exact copy of ${d.est.number}: ${parts.join(" · ")}.`, missing: d.missing.length };
}
