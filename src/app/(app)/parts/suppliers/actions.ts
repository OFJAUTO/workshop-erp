"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { supplierDiscount, type SupplierOption } from "@/lib/parts-rows";
import { syncLineForPart } from "../actions";

const back = (msg: string, ok: boolean) => redirect(`/parts/suppliers?${ok ? "message" : "error"}=${encodeURIComponent(msg)}`);

/** The standard discounts on the form: Parts, accounts and the owner may change them (every change is logged). */
function readDiscounts(formData: FormData): { default_discount_percent: number; discount_by_type: Record<string, number> } | null {
  if (formData.get("discount_default") === null) return null;
  const pct = (v: FormDataEntryValue | null) => {
    const n = Number(String(v ?? "").trim().replace(",", "."));
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n * 100) / 100)) : null;
  };
  const byType: Record<string, number> = {};
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("discount__")) continue;
    const n = String(v ?? "").trim() === "" ? null : pct(v);
    if (n !== null) byType[k.slice("discount__".length)] = n;
  }
  return { default_discount_percent: pct(formData.get("discount_default")) ?? 0, discount_by_type: byType };
}

function read(formData: FormData) {
  const name = (blankToNull(formData.get("name")) ?? "").slice(0, 120);
  if (name.length < 2) back("Type the supplier's name.", false);
  const trn = blankToNull(formData.get("trn"))?.replace(/\s+/g, "").slice(0, 20) ?? null;
  if (trn && !/^\d{15}$/.test(trn)) back("A TRN is 15 digits.", false);
  return {
    name,
    trn,
    vat_registered: formData.get("vat_registered") === "on",
    phone: blankToNull(formData.get("phone"))?.slice(0, 40) ?? null,
    email: blankToNull(formData.get("email"))?.slice(0, 120) ?? null,
    address: blankToNull(formData.get("address"))?.slice(0, 300) ?? null,
    payment_terms: blankToNull(formData.get("payment_terms"))?.slice(0, 120) ?? null,
    notes: blankToNull(formData.get("notes"))?.slice(0, 500) ?? null,
  };
}

/** Parts, accounts or the owner add a supplier: name, TRN, phone, email, address, payment terms. */
export async function addSupplier(formData: FormData) {
  const staff = await requirePermission("manageSuppliers");
  const row = read(formData);
  const admin = createAdminClient();
  const { data: same } = await admin.from("suppliers").select("id, is_active").ilike("name", row.name).maybeSingle();
  if (same) {
    if (!same.is_active) {
      await admin.from("suppliers").update({ ...row, is_active: true, updated_by: staff.id }).eq("id", same.id);
      revalidatePath("/parts/suppliers");
      back(`${row.name} is back on the list.`, true);
    }
    back(`${row.name} is already on the list.`, false);
  }
  const { error } = await admin.from("suppliers").insert({ ...row, ...(readDiscounts(formData) ?? {}), created_by: staff.id, updated_by: staff.id });
  if (error) back(error.message, false);
  revalidatePath("/parts/suppliers");
  revalidatePath("/parts");
  back(`${row.name} added.`, true);
}

export async function updateSupplier(id: string, formData: FormData) {
  const staff = await requirePermission("manageSuppliers");
  const row = read(formData);
  const admin = createAdminClient();
  const { data: before } = await admin.from("suppliers").select("name, default_discount_percent, discount_by_type").eq("id", id).maybeSingle();
  const discounts = readDiscounts(formData);
  const { error } = await admin.from("suppliers").update({ ...row, ...(discounts ?? {}), updated_by: staff.id }).eq("id", id);
  if (error) back(error.message, false);
  // LPOs carry the supplier's name at the time; the ones not yet sent follow a rename.
  await admin.from("purchase_orders").update({ supplier_name: row.name, updated_by: staff.id }).eq("supplier_id", id).in("status", ["pending_approval", "approved"]);
  revalidatePath("/parts/suppliers");
  revalidatePath("/parts");
  // Every change of a standard discount is logged (who, when, from, to). New and unpriced lines take the new figure by
  // themselves; priced lines on open jobs are offered it: "Apply 55% to the 6 open Gargash lines?".
  if (discounts && before) {
    const changes: { part_type: string | null; from: number | null; to: number }[] = [];
    const oldDefault = Number(before.default_discount_percent ?? 0);
    if (oldDefault !== discounts.default_discount_percent) changes.push({ part_type: null, from: oldDefault, to: discounts.default_discount_percent });
    const oldByType = (before.discount_by_type as Record<string, number> | null) ?? {};
    for (const [t, pct] of Object.entries(discounts.discount_by_type)) if (oldByType[t] !== pct) changes.push({ part_type: t, from: oldByType[t] ?? null, to: pct });
    for (const t of Object.keys(oldByType)) if (discounts.discount_by_type[t] === undefined) changes.push({ part_type: t, from: oldByType[t], to: discounts.default_discount_percent });
    if (changes.length) {
      await admin.from("supplier_discount_changes").insert(changes.map((c) => ({ supplier_id: id, part_type: c.part_type, from_percent: c.from, to_percent: c.to, created_by: staff.id })));
      const open = await openPricedLines(row.name);
      if (open.length) redirect(`/parts/suppliers?message=${encodeURIComponent(`${row.name} saved.`)}&apply=${id}&count=${open.length}`);
    }
  }
  back(`${row.name} saved.`, true);
}

/** The priced lines of this supplier on open jobs that are not ordered yet. */
async function openPricedLines(name: string) {
  const admin = createAdminClient();
  const { data: parts } = await admin.from("part_items").select("id, job_id, part_type, list_price_aed, discount_percent, cost_aed").ilike("supplier", name).eq("is_active", true).eq("order_status", "none").not("cost_aed", "is", null);
  const jobIds = Array.from(new Set((parts ?? []).map((p) => p.job_id as string)));
  if (!jobIds.length) return [];
  const { data: jobs } = await admin.from("jobs").select("id").in("id", jobIds).eq("is_open", true);
  const open = new Set((jobs ?? []).map((j) => j.id as string));
  return (parts ?? []).filter((p) => open.has(p.job_id as string));
}

/** "Apply 55% to the 6 open Gargash lines": the standard discount goes onto every priced, unordered line of open jobs; the net follows; sent quotations are flagged; the change is logged. */
export async function applySupplierDiscount(id: string) {
  const staff = await requirePermission("manageSuppliers");
  const admin = createAdminClient();
  const { data: s } = await admin.from("suppliers").select("id, name, default_discount_percent, discount_by_type").eq("id", id).maybeSingle();
  if (!s) return back("Supplier not found.", false);
  const option: SupplierOption = { id: s.id, name: s.name, discount: Number(s.default_discount_percent) || 0, byType: (s.discount_by_type as Record<string, number> | null) ?? {} };
  const lines = await openPricedLines(s.name);
  const now = new Date().toISOString();
  const jobs = new Set<string>();
  for (const p of lines) {
    const d = supplierDiscount(option, String(p.part_type ?? ""));
    const list = p.list_price_aed === null ? null : Number(p.list_price_aed);
    const patch: Record<string, unknown> = { discount_percent: d, updated_by: staff.id };
    if (list !== null) patch.cost_aed = Math.round(list * (1 - Math.min(100, d) / 100) * 100) / 100;
    await admin.from("part_items").update(patch).eq("id", p.id);
    await syncLineForPart(p.job_id as string, p.id as string, staff.id);
    jobs.add(p.job_id as string);
  }
  for (const jobId of jobs) {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "supplier_discount", note: `${s.name}: the standard discount was applied to the open lines by ${staff.display_name}`, created_by: staff.id });
    await admin.from("quotations").update({ parts_price_changed_at: now, updated_by: staff.id }).eq("job_id", jobId).eq("is_active", true).in("status", ["sent", "opened", "approved", "urgent_requested", "pending_owner"]);
    revalidatePath(`/parts/${jobId}`);
    revalidatePath(`/jobs/${jobId}`);
  }
  await admin.from("supplier_discount_changes").insert({ supplier_id: id, part_type: null, from_percent: null, to_percent: option.discount, applied_lines: lines.length, note: "Applied to the open priced lines", created_by: staff.id });
  back(`${s.name}: ${lines.length} line${lines.length === 1 ? "" : "s"} updated.`, true);
}

/** Suppliers are never deleted: an inactive one drops off the pick-lists and keeps its history. */
export async function setSupplierActive(id: string, formData: FormData) {
  const staff = await requirePermission("manageSuppliers");
  const active = String(formData.get("active") ?? "") === "yes";
  const admin = createAdminClient();
  await admin.from("suppliers").update({ is_active: active, updated_by: staff.id }).eq("id", id);
  revalidatePath("/parts/suppliers");
  revalidatePath("/parts");
  back(active ? "Supplier back on the list." : "Supplier taken off the list (history kept).", true);
}
