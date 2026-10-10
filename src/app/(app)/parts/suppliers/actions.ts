"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

const back = (msg: string, ok: boolean) => redirect(`/parts/suppliers?${ok ? "message" : "error"}=${encodeURIComponent(msg)}`);

function read(formData: FormData) {
  const name = (blankToNull(formData.get("name")) ?? "").slice(0, 120);
  if (name.length < 2) back("Type the supplier's name.", false);
  const trn = blankToNull(formData.get("trn"))?.replace(/\s+/g, "").slice(0, 20) ?? null;
  if (trn && !/^\d{15}$/.test(trn)) back("A TRN is 15 digits.", false);
  return {
    name,
    trn,
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
  const { error } = await admin.from("suppliers").insert({ ...row, created_by: staff.id, updated_by: staff.id });
  if (error) back(error.message, false);
  revalidatePath("/parts/suppliers");
  revalidatePath("/parts");
  back(`${row.name} added.`, true);
}

export async function updateSupplier(id: string, formData: FormData) {
  const staff = await requirePermission("manageSuppliers");
  const row = read(formData);
  const admin = createAdminClient();
  const { error } = await admin.from("suppliers").update({ ...row, updated_by: staff.id }).eq("id", id);
  if (error) back(error.message, false);
  // LPOs carry the supplier's name at the time; the ones not yet sent follow a rename.
  await admin.from("purchase_orders").update({ supplier_name: row.name, updated_by: staff.id }).eq("supplier_id", id).in("status", ["pending_approval", "approved"]);
  revalidatePath("/parts/suppliers");
  revalidatePath("/parts");
  back(`${row.name} saved.`, true);
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
