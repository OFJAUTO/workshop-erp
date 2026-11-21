import "server-only";
import { createAdminClient } from "./supabase/admin";
import { cleanTrn } from "./charge-edit-rules";

/**
 * THE provider of a charge or a Journal Voucher (21 November 2026): a record in the SUPPLIER LIST (Parts > Suppliers),
 * picked or added as new - the same record the charge, the voucher and Zoho use. Never only typed into a description.
 */

export type Provider = { id: string; name: string; trn: string | null };

/** Every active supplier, by name (for the pickers). */
export async function providerList(): Promise<Provider[]> {
  const { data } = await createAdminClient().from("suppliers").select("id, name, trn").eq("is_active", true).order("name").limit(2000);
  return ((data ?? []) as { id: string; name: string; trn: string | null }[]).map((s) => ({ id: s.id, name: s.name, trn: cleanTrn(s.trn) }));
}

/** The picked supplier, or a new one by name (an existing name is reused, never doubled). A TRN typed for a supplier with none is saved on it. */
export async function resolveProvider(input: { supplierId?: string | null; newName?: string | null; trn?: string | null }, by: { id: string }): Promise<{ provider: Provider | null; error?: string }> {
  const admin = createAdminClient();
  const trn = cleanTrn(input.trn);
  if (input.trn && String(input.trn).trim() && !trn) return { provider: null, error: "A TRN has 15 digits. Check it, or leave it empty." };
  let row: { id: string; name: string; trn: string | null } | null = null;
  if (input.supplierId) {
    const { data } = await admin.from("suppliers").select("id, name, trn").eq("id", input.supplierId).maybeSingle();
    if (!data) return { provider: null, error: "That provider is not in the supplier list any more. Pick it again." };
    row = data as { id: string; name: string; trn: string | null };
  } else if (input.newName && input.newName.trim().length >= 2) {
    const name = input.newName.trim().replace(/\s+/g, " ").slice(0, 120);
    const { data: same } = await admin.from("suppliers").select("id, name, trn, is_active").ilike("name", name).maybeSingle();
    if (same) {
      if (!same.is_active) await admin.from("suppliers").update({ is_active: true, updated_by: by.id }).eq("id", same.id);
      row = same as { id: string; name: string; trn: string | null };
    } else {
      const { data: made, error } = await admin.from("suppliers").insert({ name, ...(trn ? { trn } : {}), created_by: by.id, updated_by: by.id }).select("id, name, trn").single();
      if (error || !made) return { provider: null, error: "The new provider could not be added – nothing was changed. Try again." };
      row = made as { id: string; name: string; trn: string | null };
    }
  } else return { provider: null };
  if (trn && !cleanTrn(row.trn)) {
    await admin.from("suppliers").update({ trn, updated_by: by.id }).eq("id", row.id);
    row = { ...row, trn };
  }
  return { provider: { id: row.id, name: row.name, trn: cleanTrn(row.trn) } };
}
