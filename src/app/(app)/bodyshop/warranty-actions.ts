"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { loadStages, setStageDone } from "@/lib/bodyshop";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldOf } from "@/lib/warranty";
import { saveWarrantyEntry, stageAsks, warrantyCardOf, type WarrantyRow } from "@/lib/warranty-data";

const enc = encodeURIComponent;
const BODYSHOP_DEPTS = ["bodyshop", "paint", "ppf_tint", "detailing"];

function refresh(jobId: string) {
  revalidatePath(`/bodyshop/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/bodyshop");
  revalidatePath("/warranties");
}

/** Who writes the warranty details: the owner, the bodyshop manager, a team leader (QC too). */
async function writer() {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const ok = !staff.viewingAs && (role === "owner" || can(role, "leadSection") || (role === "workshop_manager" && BODYSHOP_DEPTS.includes(staff.department_id ?? "")));
  if (!ok) redirect("/home");
  return staff;
}

/** The typed details of the rows on this form, saved; rows not on the form are left alone. */
async function saveRows(jobId: string, rows: WarrantyRow[], formData: FormData, actor: { id: string }, stageId: string | null) {
  let saved = 0;
  for (const r of rows) {
    if (!formData.has(fieldOf(r, "roll")) && !formData.has(fieldOf(r, "product"))) continue;
    const typed = String(formData.get(fieldOf(r, "area_other")) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const areas = Array.from(new Set([...formData.getAll(fieldOf(r, "areas")).map(String), ...typed]));
    await saveWarrantyEntry(jobId, { product: r.product, itemKey: r.itemKey, rollBatch: String(formData.get(fieldOf(r, "roll")) ?? ""), productName: r.product === "ceramic" ? String(formData.get(fieldOf(r, "product")) ?? "") : null, areas: r.product === "ppf" ? areas : [] }, actor, stageId);
    saved++;
  }
  // A ceramic product typed by hand becomes a one-tap chip next time.
  const names = rows.filter((r) => r.product === "ceramic").map((r) => String(formData.get(fieldOf(r, "product")) ?? "").trim()).filter(Boolean);
  if (names.length) {
    const admin = createAdminClient();
    const { data } = await admin.from("settings").select("value").eq("key", "ceramic_products_used").maybeSingle();
    const have = Array.isArray(data?.value) ? (data!.value as unknown[]).map(String) : [];
    const next = Array.from(new Set([...names, ...have])).slice(0, 12);
    if (next.join("|") !== have.join("|")) await admin.from("settings").upsert({ key: "ceramic_products_used", label: "Ceramic products used (one-tap suggestions)", value: next, updated_by: actor.id }, { onConflict: "key" });
  }
  // A changed detail needs QC to confirm the set again.
  if (saved) await createAdminClient().from("jobs").update({ warranty_confirmed_at: null, warranty_confirmed_by: null }).eq("id", jobId);
  return saved;
}

/**
 * A stage's Done with its warranty details: the PPF stage writes the roll or batch number and the areas, the tint
 * stage the roll, the final detail the ceramic product and batch. QC ticks "Warranty details complete" - only
 * possible when nothing is missing - and only then can QC be done (the car goes to Ready after it).
 */
export async function stageDoneWarrantyAction(jobId: string, stageId: string, formData: FormData) {
  const staff = await writer();
  const settings = await getSettings();
  const stages = await loadStages(jobId);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) redirect(`/bodyshop/${jobId}?error=${enc("Stage not found.")}#stages`);
  const card = await warrantyCardOf(jobId, settings);
  if (card) {
    const asked = stage!.key === "qc" ? card.rows : stageAsks(stage!, stages.map((s) => s.key), card.rows);
    await saveRows(jobId, asked, formData, staff, stageId);
    if (stage!.key === "qc" && card.rows.length) {
      const fresh = await warrantyCardOf(jobId, settings);
      if (fresh?.missing.length) redirect(`/bodyshop/${jobId}?error=${enc(`Warranty details missing: ${fresh.missing.join(", ")}.`)}#stages`);
      if (formData.get("warranty_complete") !== "on") redirect(`/bodyshop/${jobId}?error=${enc("Tick \"Warranty details complete\" first.")}#stages`);
      await createAdminClient().from("jobs").update({ warranty_confirmed_at: new Date().toISOString(), warranty_confirmed_by: staff.id }).eq("id", jobId);
      await createAdminClient().from("job_events").insert({ job_id: jobId, event_type: "warranty_confirmed", note: `Warranty details complete, confirmed at QC by ${staff.display_name}`, created_by: staff.id });
    }
  }
  const r = await setStageDone(stageId, staff, settings);
  refresh(jobId);
  redirect(`/bodyshop/${jobId}?${r.error ? `error=${enc(r.error)}` : `message=${enc(`${stage!.label} done. The next section has been told.`)}`}#stages`);
}

/** The Warranty details card: correct or complete any product's details at any time. */
export async function saveWarrantyDetailsAction(jobId: string, formData: FormData) {
  const staff = await writer();
  const card = await warrantyCardOf(jobId, await getSettings());
  const saved = card ? await saveRows(jobId, card.rows, formData, staff, null) : 0;
  if (saved) await createAdminClient().from("job_events").insert({ job_id: jobId, event_type: "warranty_details", note: `Warranty details updated by ${staff.display_name}`, created_by: staff.id });
  refresh(jobId);
  redirect(`/bodyshop/${jobId}?message=${enc(saved ? "Warranty details saved." : "Nothing to save.")}#warranty`);
}
