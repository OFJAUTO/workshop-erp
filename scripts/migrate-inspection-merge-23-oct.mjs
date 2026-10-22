// 23 October 2026, section 6: one A/C gas item, and the "service due" items folded into their fluid items.
// 1. The checklist in Settings: "A/C gas level" becomes "A/C gas" (style gas: Good / Low / Empty / N/A); the four
//    "... due" job items and "A/C gas recharge" leave Service items; their fluid items carry "due": true.
// 2. Every inspection's own checklist copy: the same.
// 3. Every existing report: the folded item's answer moves onto the merged item (Required -> service due /
//    recharge needed; labour hours, remark, Dangerous carried), the old row keeps its answer and is marked
//    merged_into so nothing reads it twice.
// 4. The services' "suggest for" keys point at the merged items.
// Safe to run twice. Run: node --env-file=.env.local scripts/migrate-inspection-merge-23-oct.mjs
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Old key -> the item it folds into, and what a "Required" answer becomes there.
const MERGES = {
  "service_items.a_c_gas_recharge": { into: "air_conditioning.a_c_gas_level", as: "recharge" },
  "service_items.engine_oil_service_due": { into: "engine_bay.engine_oil_level_and_condition", as: "service_due" },
  "service_items.brake_fluid_change_due": { into: "engine_bay.brake_fluid", as: "service_due" },
  "service_items.coolant_change_due": { into: "cooling.coolant_tank", as: "service_due" },
  "service_items.transmission_oil_service_due": { into: "transmission_and_driveline.transmission_and_differential_fluid_condition", as: "service_due" },
};
const LABELS = {
  "air_conditioning.a_c_gas_level": "A/C gas",
  "engine_bay.engine_oil_level_and_condition": "Engine oil (level, condition, service due)",
  "engine_bay.brake_fluid": "Brake fluid (level, condition, change due)",
  "cooling.coolant_tank": "Coolant tank and coolant (level, change due)",
  "transmission_and_driveline.transmission_and_differential_fluid_condition": "Transmission and differential fluid (condition, service due)",
};
const AC = "air_conditioning.a_c_gas_level";

function mergeChecklist(checklist) {
  let changed = false;
  for (const sec of checklist ?? []) {
    const before = (sec.items ?? []).length;
    sec.items = (sec.items ?? []).filter((it) => !MERGES[it.key]);
    if (sec.items.length !== before) changed = true;
    for (const it of sec.items) {
      if (LABELS[it.key] && it.label !== LABELS[it.key]) { it.label = LABELS[it.key]; changed = true; }
      if (it.key === AC && it.style !== "gas") { it.style = "gas"; changed = true; }
      if (LABELS[it.key] && it.key !== AC && !it.due) { it.due = true; changed = true; }
    }
  }
  return changed;
}

/* ---------- 1. Settings ---------- */
const { data: row } = await admin.from("settings").select("value").eq("key", "inspection_checklist").maybeSingle();
const checklist = row?.value ?? [];
if (mergeChecklist(checklist)) {
  const { error } = await admin.from("settings").update({ value: checklist }).eq("key", "inspection_checklist");
  if (error) throw new Error(error.message);
  console.log("settings checklist: merged");
} else console.log("settings checklist: already merged");

/* ---------- 2 and 3. Every inspection ---------- */
const { data: inspections } = await admin.from("inspections").select("id, checklist");
let reports = 0;
let folded = 0;
for (const insp of inspections ?? []) {
  const list = insp.checklist ?? [];
  if (mergeChecklist(list)) await admin.from("inspections").update({ checklist: list }).eq("id", insp.id);
  const { data: items } = await admin.from("inspection_items").select("id, item_key, item_label, status, style, remarks, labour_hours, dangerous, dangerous_reason, merged_into, service_due, recharge_needed").eq("inspection_id", insp.id);
  const byKey = new Map((items ?? []).map((i) => [i.item_key, i]));
  let touched = false;
  for (const [oldKey, m] of Object.entries(MERGES)) {
    const old = byKey.get(oldKey);
    const target = byKey.get(m.into);
    if (!target) continue;
    const patch = {};
    if (LABELS[m.into] && target.item_label !== LABELS[m.into]) patch.item_label = LABELS[m.into];
    if (m.into === AC && target.style !== "gas") patch.style = "gas";
    if (old && !old.merged_into) {
      const required = old.status === "bad";
      if (required && m.as === "service_due") patch.service_due = true;
      if (required && m.as === "recharge") {
        patch.recharge_needed = true;
        // A recharge was required but the gas level was marked Good: it is at least Low.
        if (!target.status || target.status === "good") patch.status = "average";
      }
      if (Number(old.labour_hours) > Number(target.labour_hours ?? 0)) patch.labour_hours = old.labour_hours;
      const oldRemark = (old.remarks ?? "").trim();
      if (oldRemark && !(target.remarks ?? "").includes(oldRemark)) patch.remarks = [(target.remarks ?? "").trim(), oldRemark].filter(Boolean).join(" · ");
      if (old.dangerous && !target.dangerous) { patch.dangerous = true; patch.dangerous_reason = old.dangerous_reason; }
      await admin.from("inspection_items").update({ merged_into: m.into }).eq("id", old.id);
      folded++;
      touched = true;
    }
    if (m.into === AC && ["average", "bad"].includes(patch.status ?? target.status) && !target.recharge_needed) patch.recharge_needed = true;
    if (Object.keys(patch).length) { await admin.from("inspection_items").update(patch).eq("id", target.id); touched = true; }
  }
  if (touched) reports++;
}
console.log(`reports: ${reports} updated, ${folded} old answers folded into their merged item`);

/* ---------- 4. Services ---------- */
const { data: services } = await admin.from("services").select("id, name, suggest_for");
let svc = 0;
for (const s of services ?? []) {
  const keys = Array.isArray(s.suggest_for) ? s.suggest_for : [];
  if (!keys.some((k) => MERGES[k])) continue;
  const next = Array.from(new Set(keys.map((k) => MERGES[k]?.into ?? k)));
  await admin.from("services").update({ suggest_for: next }).eq("id", s.id);
  svc++;
}
// "A/C gas recharge" is the job a Low or Empty A/C gas answers.
const { data: recharge } = await admin.from("services").select("id, suggest_for").ilike("name", "A/C gas recharge").maybeSingle();
if (recharge && !(recharge.suggest_for ?? []).includes(AC)) { await admin.from("services").update({ suggest_for: [...(recharge.suggest_for ?? []), AC] }).eq("id", recharge.id); svc++; }
console.log(`services: ${svc} suggestion lists pointed at the merged items`);
