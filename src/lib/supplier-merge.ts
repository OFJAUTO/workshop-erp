import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";

/*
 * 13 November 2026, Section 8: merge two supplier records that are the same company (SPAREIN AUTO SPARE PARTS and
 * SPAREIN AUTOMOTIVE L.L.C share one TRN). The owner or accounts choose the record to KEEP; every LPO, supplier
 * invoice, payment, advance, lathe bill, return, charge, stock item and open part moves across; the other record stays
 * (inactive, "merged into …") and its name is kept as "also known as" on the kept one, so it is still found by a search.
 * Nothing is deleted; the merge is logged.
 */

export async function supplierMergeReady(): Promise<boolean> {
  return schemaReady("suppliers", "also_known_as, merged_into");
}

type Actor = { id: string; display_name: string; role_id: string };

export async function mergeSuppliers(keepId: string, goneId: string, reason: string, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!(await supplierMergeReady())) return { error: "Merging suppliers switches on once the database change is applied." };
  if (!["owner", "accounts"].includes(by.role_id)) return { error: "Only the owner or accounts merge suppliers." };
  if (keepId === goneId) return { error: "Pick two different suppliers." };
  if (reason.trim().length < 3) return { error: "Say why they are the same (a few words, logged)." };
  const admin = createAdminClient();
  const { data: rows } = await admin.from("suppliers").select("id, name, trn, is_active, also_known_as, merged_into").in("id", [keepId, goneId]);
  const keep = (rows ?? []).find((r) => r.id === keepId) as { id: string; name: string; trn: string | null; also_known_as: string[] | null } | undefined;
  const gone = (rows ?? []).find((r) => r.id === goneId) as { id: string; name: string; trn: string | null; also_known_as: string[] | null; merged_into: string | null } | undefined;
  if (!keep || !gone) return { error: "One of the two suppliers is no longer on the list." };
  if (gone.merged_into) return { error: `${gone.name} was already merged.` };
  const moved: string[] = [];
  const move = async (table: string, set: Record<string, unknown>, by2: "supplier_id" | "supplier_name" | "supplier") => {
    const q = admin.from(table).update({ ...set }).select("id");
    const { data, error } = by2 === "supplier_id" ? await q.eq("supplier_id", gone.id) : await q.ilike(by2, gone.name);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (data?.length) moved.push(`${data.length} ${table.replace(/_/g, " ")}`);
  };
  try {
    await move("purchase_orders", { supplier_id: keep.id, supplier_name: keep.name, updated_by: by.id }, "supplier_id");
    await move("supplier_payments", { supplier_id: keep.id, supplier_name: keep.name, updated_by: by.id }, "supplier_id");
    await move("lathe_bills", { supplier_id: keep.id, supplier_name: keep.name, updated_by: by.id }, "supplier_id");
    await move("lpo_invoices", { supplier_id: keep.id, supplier_name: keep.name, updated_by: by.id }, "supplier_id");
    await move("purchase_returns", { supplier_id: keep.id, supplier_name: keep.name, updated_by: by.id }, "supplier_id");
    await move("supplier_charges", { supplier_id: keep.id, supplier_name: keep.name, updated_by: by.id }, "supplier_id");
    await move("stock_items", { supplier_id: keep.id, updated_by: by.id }, "supplier_id");
    await move("price_imports", { supplier_id: keep.id }, "supplier_id");
    // Parts name their supplier by its text: the gone name becomes the kept name.
    await move("part_items", { supplier: keep.name, updated_by: by.id }, "supplier");
  } catch (e) {
    return { error: `Couldn't move everything across (${e instanceof Error ? e.message : String(e)}). Nothing was deleted; press Merge again to finish.` };
  }
  const aka = Array.from(new Set([...(keep.also_known_as ?? []), gone.name, ...(gone.also_known_as ?? [])].map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== keep.name.toLowerCase())));
  await admin.from("suppliers").update({ also_known_as: aka, trn: keep.trn ?? gone.trn, updated_by: by.id }).eq("id", keep.id);
  await admin.from("suppliers").update({ is_active: false, merged_into: keep.id, merged_at: new Date().toISOString(), merged_by: by.id, updated_by: by.id }).eq("id", gone.id);
  const words = `${gone.name} merged into ${keep.name} by ${by.display_name}: ${reason.trim()}. Moved: ${moved.join(", ") || "nothing on file"}.`;
  await admin.from("audit_log").insert({ table_name: "suppliers", record_id: keep.id, action: "MERGE", old_data: { merged: gone.id, name: gone.name }, new_data: { kept: keep.id, name: keep.name, reason: reason.trim(), moved }, changed_by: by.id });
  return { words };
}

/** Other suppliers sharing a TRN with this one (for the duplicate notices and the merge offer). */
export async function suppliersSharingTrn(): Promise<Map<string, { id: string; name: string }[]>> {
  const { data } = await createAdminClient().from("suppliers").select("id, name, trn").eq("is_active", true).not("trn", "is", null);
  const byTrn = new Map<string, { id: string; name: string }[]>();
  for (const s of (data ?? []) as { id: string; name: string; trn: string | null }[]) {
    const t = (s.trn ?? "").replace(/\D/g, "");
    if (t.length !== 15) continue;
    byTrn.set(t, [...(byTrn.get(t) ?? []), { id: s.id, name: s.name }]);
  }
  const out = new Map<string, { id: string; name: string }[]>();
  for (const list of byTrn.values()) if (list.length > 1) for (const s of list) out.set(s.id, list.filter((x) => x.id !== s.id));
  return out;
}
