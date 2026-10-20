// 20 October 2026, section 4: one Brakes section in the inspection checklist (front discs, front pads,
// rear discs, rear pads, brake fluid, handbrake, then the other brake items), and the old single
// "Brake pads" answers copied to front and rear on every existing report, marked as migrated.
// Run: node --env-file=.env.local scripts/migrate-brakes-20-oct.mjs
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MOVE_KEYS = [
  "wheels_tyres_and_brakes.front_brake_discs",
  "wheels_tyres_and_brakes.rear_brake_discs",
  "engine_bay.brake_fluid",
  "electrical.parking_brakes",
  "wheels_tyres_and_brakes.brake_fluid_pipes_caliper_leak_piston_jam",
  "wheels_tyres_and_brakes.brake_dust_cover",
  "engine_bay.brake_vacuum_pump",
];
const OLD_PADS_KEY = "wheels_tyres_and_brakes.brake_pads";

/* ---------- 1. The checklist ---------- */
const { data: row } = await admin.from("settings").select("value").eq("key", "inspection_checklist").maybeSingle();
const checklist = row?.value ?? [];
if (checklist.some((s) => s.key === "brakes")) {
  console.log("checklist: the Brakes section already exists, nothing to do");
} else {
  const moved = new Map();
  for (const sec of checklist) {
    sec.items = (sec.items ?? []).filter((it) => {
      if (MOVE_KEYS.includes(it.key)) { moved.set(it.key, it); return false; }
      if (it.key === OLD_PADS_KEY) return false; // replaced by front and rear items
      return true;
    });
  }
  const take = (key, fallbackLabel) => moved.get(key) ?? { key, label: fallbackLabel };
  const handbrake = take("electrical.parking_brakes", "Parking brakes");
  handbrake.label = "Handbrake (parking brakes)";
  const brakes = {
    key: "brakes",
    title: "Brakes",
    items: [
      take("wheels_tyres_and_brakes.front_brake_discs", "Front brake discs"),
      { key: "brakes.front_brake_pads", label: "Front brake pads" },
      take("wheels_tyres_and_brakes.rear_brake_discs", "Rear brake discs"),
      { key: "brakes.rear_brake_pads", label: "Rear brake pads" },
      take("engine_bay.brake_fluid", "Brake fluid"),
      handbrake,
      take("wheels_tyres_and_brakes.brake_fluid_pipes_caliper_leak_piston_jam", "Brake fluid pipes / caliper leak / piston jam"),
      take("wheels_tyres_and_brakes.brake_dust_cover", "Brake dust cover"),
      take("engine_bay.brake_vacuum_pump", "Brake vacuum pump"),
    ],
  };
  const at = checklist.findIndex((s) => s.key === "wheels_tyres_and_brakes");
  const wheels = at >= 0 ? checklist[at] : null;
  if (wheels && wheels.title === "Wheels and brakes") wheels.title = "Wheels and tyres";
  checklist.splice(at >= 0 ? at + 1 : checklist.length, 0, brakes);
  const { error } = await admin.from("settings").update({ value: checklist }).eq("key", "inspection_checklist");
  if (error) throw new Error(error.message);
  console.log("checklist: Brakes section created with", brakes.items.length, "items; Wheels section renamed");
}

/* ---------- 2. Old single "Brake pads" answers → front and rear, marked as migrated ---------- */
const { data: limitsRow } = await admin.from("settings").select("value").eq("key", "inspection_limits").maybeSingle();
const badMax = Number(limitsRow?.value?.pads_bad_max) || 3;
const goodMin = Number(limitsRow?.value?.pads_good_min) || 6;
const statusFor = (mm, fallback) => {
  const n = Number(String(mm ?? "").replace(",", "."));
  if (!String(mm ?? "").trim() || !Number.isFinite(n)) return fallback;
  return n <= badMax ? "bad" : n < goodMin ? "average" : "good";
};
const words = (mm, st) => (st === "bad" ? `${mm} mm – Replace now` : st === "average" ? `${mm} mm – Getting low, replace soon` : `${mm} mm – Good`);

const { data: oldRows, error: oldErr } = await admin.from("inspection_items").select("id, inspection_id, status, remarks, position").eq("item_key", OLD_PADS_KEY);
if (oldErr) throw new Error(oldErr.message);
let made = 0;
for (const old of oldRows ?? []) {
  const { data: existing } = await admin.from("inspection_items").select("id").eq("inspection_id", old.inspection_id).eq("item_key", "brakes.front_brake_pads").limit(1);
  if (existing?.length) continue;
  const { data: insp } = await admin.from("inspections").select("measurements").eq("id", old.inspection_id).maybeSingle();
  const m = insp?.measurements ?? {};
  for (const [key, label, mmKey] of [["brakes.front_brake_pads", "Front brake pads", "pad_front"], ["brakes.rear_brake_pads", "Rear brake pads", "pad_rear"]]) {
    const mm = String(m[mmKey] ?? "").trim();
    const status = statusFor(mm, old.status);
    const remark = mm ? words(mm, status) : (old.remarks ?? "").trim();
    const { error } = await admin.from("inspection_items").insert({
      inspection_id: old.inspection_id,
      section_key: "brakes",
      section_title: "Brakes",
      item_key: key,
      item_label: label,
      position: old.position,
      status,
      style: "grade",
      remarks: [remark, "migrated from the single Brake pads answer"].filter(Boolean).join(" · "),
    });
    if (error) { console.log("skip", old.inspection_id, error.message); break; }
    made++;
  }
}
console.log(`answers: ${oldRows?.length ?? 0} old single Brake pads rows found, ${made} front/rear rows written`);
