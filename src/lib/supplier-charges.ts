import "server-only";
import { round2 } from "./money";
import { createAdminClient } from "./supabase/admin";

/**
 * A supplier's charge that is not a part (courier, freight, handling): an internal cost of the job. It rides on
 * that supplier's LPO as an "Other charges" row (the LPO total includes it, so the supplier-invoice check sees it),
 * counts against the job's profit, and never reaches a customer document. Made by a price import or by hand.
 */
export type SupplierCharge = { id: string; job_id: string; supplier_id: string | null; supplier_name: string; description: string; amount_aed: number; import_id: string | null; po_id: string | null; created_at: string };

const SELECT = "id, job_id, supplier_id, supplier_name, description, amount_aed, import_id, po_id, created_at";
const toCharge = (r: Record<string, unknown>): SupplierCharge => ({ ...(r as unknown as SupplierCharge), amount_aed: Number(r.amount_aed) || 0 });
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export async function jobCharges(jobId: string): Promise<SupplierCharge[]> {
  const { data } = await createAdminClient().from("supplier_charges").select(SELECT).eq("job_id", jobId).eq("is_active", true).order("created_at");
  return ((data ?? []) as Record<string, unknown>[]).map(toCharge);
}

export async function poCharges(poId: string): Promise<SupplierCharge[]> {
  const { data } = await createAdminClient().from("supplier_charges").select(SELECT).eq("po_id", poId).eq("is_active", true).order("created_at");
  return ((data ?? []) as Record<string, unknown>[]).map(toCharge);
}

/** The charges of several LPOs at once, by LPO. */
export async function chargesByPo(poIds: string[]): Promise<Map<string, SupplierCharge[]>> {
  const out = new Map<string, SupplierCharge[]>();
  if (!poIds.length) return out;
  const { data } = await createAdminClient().from("supplier_charges").select(SELECT).in("po_id", poIds).eq("is_active", true).order("created_at");
  for (const c of ((data ?? []) as Record<string, unknown>[]).map(toCharge)) out.set(c.po_id!, [...(out.get(c.po_id!) ?? []), c]);
  return out;
}

/** Each job's supplier charges added up (the profit's internal cost). */
export async function chargeTotalsByJob(jobIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!jobIds.length) return out;
  const { data } = await createAdminClient().from("supplier_charges").select("job_id, amount_aed").in("job_id", jobIds).eq("is_active", true);
  for (const r of (data ?? []) as { job_id: string; amount_aed: number | string }[]) out.set(r.job_id, round2((out.get(r.job_id) ?? 0) + (Number(r.amount_aed) || 0)));
  return out;
}

/**
 * Put the job's loose charges of these suppliers on an LPO (the main LPO when it is raised). Returns what was added
 * to the LPO's total.
 */
export async function attachChargesToPo(jobId: string, poId: string, supplierNames: string[], by: string): Promise<number> {
  const admin = createAdminClient();
  const loose = (await jobCharges(jobId)).filter((c) => !c.po_id && supplierNames.some((s) => same(s, c.supplier_name)));
  if (!loose.length) return 0;
  await admin.from("supplier_charges").update({ po_id: poId, updated_by: by }).in("id", loose.map((c) => c.id));
  return round2(loose.reduce((a, c) => a + c.amount_aed, 0));
}

/** At the split of a main LPO: one supplier's charges move to that supplier's own LPO. Returns their sum. */
export async function moveChargesToSupplierPo(mainId: string, supplierName: string, poId: string, by: string): Promise<number> {
  const admin = createAdminClient();
  const mine = (await poCharges(mainId)).filter((c) => same(c.supplier_name, supplierName));
  if (!mine.length) return 0;
  await admin.from("supplier_charges").update({ po_id: poId, updated_by: by }).in("id", mine.map((c) => c.id));
  return round2(mine.reduce((a, c) => a + c.amount_aed, 0));
}

/** A cancelled LPO lets its charges go back to the job, ready for the next LPO. */
export async function releaseCharges(poId: string, by: string): Promise<void> {
  await createAdminClient().from("supplier_charges").update({ po_id: null, updated_by: by }).eq("po_id", poId).eq("is_active", true);
}
