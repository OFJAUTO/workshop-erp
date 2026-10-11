// One-off data migration for the rework of 11 October 2026 (safe to run twice):
//  - the inspection checklist: "Wheels, tyres and brakes" becomes "Wheels and brakes" (wheel items, bolts or nuts with
//    the locking nut and key, alignment and balancing, the brake items), the tyre line and the main battery line go
//    (tyres are judged in the Tyres section, the battery in the Battery test), and the OK / Required items are added;
//  - the ready-made labour jobs (settings.labour_jobs) join the services list as hourly jobs under their categories.
//   node --env-file=.env.local scripts/migrate-checklist-11-oct.mjs
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  // 1. The checklist
  const { rows } = await client.query("select value from public.settings where key = 'inspection_checklist'");
  const checklist = rows[0]?.value;
  if (!Array.isArray(checklist)) throw new Error("No checklist in settings");
  const JOB = ["Wheel alignment", "Wheel balancing", "Engine oil service due", "Brake fluid change due", "Coolant change due", "Transmission oil service due", "A/C gas recharge", "Software update / service reset"];
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  let wheels = checklist.find((s) => s.key === "wheels_tyres_and_brakes" || /wheels/i.test(s.title));
  const steering = checklist.find((s) => s.key === "steering_and_suspension");
  const electrical = checklist.find((s) => s.key === "electrical");
  if (wheels) {
    wheels.title = "Wheels and brakes";
    wheels.items = wheels.items.filter((i) => !/^tyres/i.test(i.label));
    for (const i of wheels.items) if (/^wheel bolts$/i.test(i.label)) i.label = "Wheel bolts or nuts (with locking nut and key)";
    // Alignment moves here from Steering and suspension; balancing is new. Both answer OK / Required.
    const alignment = steering?.items.find((i) => /^wheel alignment$/i.test(i.label));
    if (steering && alignment) steering.items = steering.items.filter((i) => i !== alignment);
    if (!wheels.items.some((i) => /^wheel alignment$/i.test(i.label))) wheels.items.push({ key: alignment?.key ?? `${wheels.key}.wheel_alignment`, label: "Wheel alignment", style: "job" });
    if (!wheels.items.some((i) => /^wheel balancing$/i.test(i.label))) wheels.items.push({ key: `${wheels.key}.wheel_balancing`, label: "Wheel balancing", style: "job" });
    for (const i of wheels.items) if (/^wheel (alignment|balancing)$/i.test(i.label)) i.style = "job";
  }
  if (electrical) electrical.items = electrical.items.filter((i) => !/^main battery$/i.test(i.label));
  // The service items that are a job, not a component: OK or Required.
  let service = checklist.find((s) => s.key === "service_items");
  if (!service) {
    service = { key: "service_items", title: "Service items", items: [] };
    const otherIdx = checklist.findIndex((s) => s.key === "other");
    checklist.splice(otherIdx < 0 ? checklist.length : otherIdx, 0, service);
  }
  for (const label of JOB.slice(2)) {
    if (!service.items.some((i) => i.label.toLowerCase() === label.toLowerCase())) service.items.push({ key: `service_items.${slug(label)}`, label, style: "job" });
  }
  for (const i of service.items) i.style = "job";
  await client.query("update public.settings set value = $1::jsonb where key = 'inspection_checklist'", [JSON.stringify(checklist)]);
  console.log("checklist updated:", checklist.map((s) => `${s.title} (${s.items.length})`).join(", "));

  // 2. Labour jobs join the services list.
  const { rows: lj } = await client.query("select value from public.settings where key = 'labour_jobs'");
  const jobs = lj[0]?.value && typeof lj[0].value === "object" ? lj[0].value : {};
  const { rows: cats } = await client.query("select id, name from public.service_categories where is_active");
  const { rows: existing } = await client.query("select lower(name) as n from public.services where is_active");
  const have = new Set(existing.map((r) => r.n));
  let added = 0;
  for (const [category, names] of Object.entries(jobs)) {
    if (!Array.isArray(names)) continue;
    let cat = cats.find((c) => c.name.toLowerCase() === String(category).toLowerCase());
    if (!cat) {
      const { rows: c } = await client.query("insert into public.service_categories (name, position) values ($1, (select coalesce(max(position), 0) + 1 from public.service_categories)) returning id, name", [category]);
      cat = c[0];
      cats.push(cat);
    }
    let pos = (await client.query("select coalesce(max(position), 0) as p from public.services where category_id = $1", [cat.id])).rows[0].p;
    for (const name of names) {
      const n = String(name).trim();
      if (!n || have.has(n.toLowerCase())) continue;
      pos += 1;
      await client.query("insert into public.services (category_id, name, department, price_aed, default_hours, position) values ($1, $2, 'both', null, null, $3)", [cat.id, n, pos]);
      have.add(n.toLowerCase());
      added++;
    }
  }
  console.log(`labour jobs merged into services: ${added} added`);
  // 3. Suggestions: the jobs the findings point to, by keyword on the service name.
  const SUGGEST = [
    ["tyre", ["tyre:fl", "tyre:fr", "tyre:rl", "tyre:rr", "wheels_tyres_and_brakes.wheel_balancing"]],
    ["balanc", ["tyre:fl", "tyre:fr", "tyre:rl", "tyre:rr", "wheels_tyres_and_brakes.wheel_balancing"]],
    ["alignment", ["wheels_tyres_and_brakes.wheel_alignment", "tyre:fl", "tyre:fr", "tyre:rl", "tyre:rr"]],
    ["brake pad", ["wheels_tyres_and_brakes.brake_pads"]],
    ["brake disc", ["wheels_tyres_and_brakes.front_brake_discs", "wheels_tyres_and_brakes.rear_brake_discs"]],
    ["oil and filter", ["service_items.engine_oil_service_due", "engine_bay.engine_oil_level_and_condition"]],
    ["brake fluid", ["service_items.brake_fluid_change_due", "engine_bay.brake_fluid"]],
    ["coolant", ["service_items.coolant_change_due", "cooling.coolant_tank"]],
    ["transmission oil", ["service_items.transmission_oil_service_due", "transmission_and_driveline.transmission_and_differential_fluid_condition"]],
    ["a/c gas", ["service_items.a_c_gas_recharge", "air_conditioning.a_c_gas_level"]],
    ["battery replacement", ["measure:battery_health"]],
    ["shock absorber", ["steering_and_suspension.front_shock_absorbers_air_hydraulic", "steering_and_suspension.rear_shock_absorbers"]],
    ["lower arm", ["steering_and_suspension.lower_arms"]],
    ["upper arm", ["steering_and_suspension.upper_arms"]],
    ["water pump", ["cooling.water_pump"]],
    ["thermostat", ["cooling.thermostat"]],
    ["spark plug", ["engine_bay.spark_plugs"]],
    ["ignition coil", ["engine_bay.ignition_coil_wiring"]],
    ["serpentine belt", ["engine_bay.serpentine_belt_auxiliary_belts"]],
    ["engine mount", ["engine_bay.engine_mounts"]],
    ["valve cover", ["engine_bay.valve_cover"]],
  ];
  const { rows: svcs } = await client.query("select id, name, suggest_for from public.services where is_active");
  let tagged = 0;
  for (const s of svcs) {
    const keys = new Set(Array.isArray(s.suggest_for) ? s.suggest_for : []);
    for (const [word, refs] of SUGGEST) if (s.name.toLowerCase().includes(word)) for (const r of refs) keys.add(r);
    if (/brake pad|brake disc|shock absorber|lower arm|upper arm|wheel bearing|headlight|tail light|control arm|tie rod|stabili/i.test(s.name)) {
      await client.query("update public.services set position_ask = true where id = $1", [s.id]);
    }
    if (keys.size) { await client.query("update public.services set suggest_for = $2 where id = $1", [s.id, Array.from(keys)]); tagged++; }
  }
  console.log(`services with suggestions: ${tagged}`);
} finally {
  await client.end();
}
