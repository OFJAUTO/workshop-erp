import "server-only";
import { newToken } from "./media";
import { packageParts } from "./packages";
import { cutOf, isPpfFilmItem, isPpfText, ppfFinishOf } from "./ppf-cut";
import { approvedQuotations, LINE_SELECT, toLine } from "./quote-data";
import { isUnchosen } from "./quotes";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { isTintText, TINT_WINDOWS, tintSummary, type TintSpec } from "./tint";
import { tintSpecForJob } from "./tint-data";
import { formatPlate } from "./types";
import { addMonthsIso, areasFromLabels, ceramicCoverageOf, dubaiDay, monthsFromWords, periodWords, termsOf, warrantyStatusOf, type AftercareRow, type WarrantyProduct, type WarrantyStatus, type WarrantyTerms } from "./warranty";
import { JOB_FILES_BUCKET } from "./work-data";

/**
 * Section 12: the ONE warranty card model. Built from the job's approved quotation (what was fitted: PPF, tint,
 * ceramic - package items or plain lines), the team leaders' details (roll and batch numbers, areas, ceramic
 * product), the tint specification, the cutting method, the handover day and the 10-day check. Read by the tax
 * invoice PDF, the customer's invoice page, the public warranty page, the certificate PDF, the bodyshop page, the
 * job card and the warranty list.
 */
export type WarrantyRow = {
  product: WarrantyProduct;
  itemKey: string;
  name: string;
  coverage: string;
  rollBatch: string | null;
  cut: string | null;
  darkness: string | null;
  months: number;
  period: string;
  start: string | null;
  validUntil: string | null;
  /** What the package or line names, pre-ticked as areas for the PPF row. */
  suggestedAreas: string[];
  areas: string[];
  productName: string | null;
  label: string;
};
export type WarrantyEntry = { id: string; product: WarrantyProduct; item_key: string; roll_batch: string | null; product_name: string | null; areas: string[]; entered_by: string | null; entered_at: string };
export type WarrantyCard = {
  jobId: string;
  jobNumber: string;
  department: string | null;
  token: string | null;
  certificateNo: string;
  car: string;
  colour: string | null;
  plate: string | null;
  vin: string | null;
  rows: WarrantyRow[];
  mechanical: { months: number; period: string; start: string | null; validUntil: string | null } | null;
  handoverDay: string | null;
  status: WarrantyStatus;
  check: (AftercareRow & { id: string; done_by_name: string | null }) | null;
  checkPhotos: { id: string; url: string | null; caption: string | null }[];
  terms: WarrantyTerms;
  missing: string[];
  confirmedAt: string | null;
  /** When the advisor sent the "Your OFJ warranty card" WhatsApp. */
  sentAt: string | null;
  entries: WarrantyEntry[];
};

const JOB_COLS = "id, job_number, department, gated_out_at, warranty_token, warranty_confirmed_at, warranty_card_sent_at, customer_id, vehicle:vehicles(make:vehicle_makes(name), model:vehicle_models(name), model_year, colour, vin, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)";
type JobRaw = { id: string; job_number: string; department: string | null; gated_out_at: string | null; warranty_token: string | null; warranty_confirmed_at: string | null; warranty_card_sent_at: string | null; customer_id: string | null; vehicle: (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null; model_year: number | null; colour: string | null; vin: string | null }) | null };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);

/** The windows the tint covers, in words: "Windshield, front & rear side windows, rear window, roof". */
function tintCoverageOf(spec: TintSpec | null, labels: string[]): string {
  if (!spec) return labels.join(", ") || "Windows";
  const on = TINT_WINDOWS.filter((w) => spec.rows[w.key].on && (w.key !== "roof" || spec.roofFitted)).map((w) => w.key);
  if (!on.length) return labels.join(", ") || "Windows";
  const words: string[] = [];
  if (on.includes("windshield")) words.push("Windshield");
  const sides = ["front_sides", "rear_sides"].filter((k) => on.includes(k as never));
  if (sides.length === 2) words.push("front and rear side windows");
  else if (sides.length === 1) words.push(sides[0] === "front_sides" ? "front side windows" : "rear side windows");
  if (on.includes("rear_window")) words.push("rear window");
  if (on.includes("roof")) words.push("sunroof / panoramic roof");
  const text = words.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Cand = { product: WarrantyProduct; itemKey: string; labels: string[]; months: number | null; cut: { method: string | null; note: string | null } | null; filmColour: string | null };

/** What was fitted, from the approved quotation(s): one PPF row, one tint row, one row per ceramic item. */
async function fittedOf(jobId: string): Promise<Cand[]> {
  const admin = createAdminClient();
  const quotes = await approvedQuotations(jobId);
  if (!quotes.length) return [];
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", quotes.map((q) => q.id)).eq("is_active", true);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !isUnchosen(l) && !l.left_off);
  const svcIds = Array.from(new Set(lines.map((l) => l.service_id).filter((x): x is string => !!x)));
  const { data: svcs } = svcIds.length ? await admin.from("services").select("id, bodyshop_kind").in("id", svcIds) : { data: [] as { id: string; bodyshop_kind: string | null }[] };
  const kindOf = new Map((svcs ?? []).map((s) => [s.id, s.bodyshop_kind as string | null]));
  const out = new Map<string, Cand>();
  const add = (product: WarrantyProduct, itemKey: string, label: string, warranty: string | null, cut: Cand["cut"], filmColour: string | null) => {
    const key = `${product}:${itemKey}`;
    const have = out.get(key) ?? { product, itemKey, labels: [], months: null, cut: null, filmColour: null };
    have.labels.push(label);
    const m = monthsFromWords(warranty);
    if (m && (!have.months || m > have.months)) have.months = m;
    if (cut && !have.cut) have.cut = cut;
    if (filmColour && !have.filmColour) have.filmColour = filmColour;
    out.set(key, have);
  };
  for (const l of lines) {
    const kind = l.service_id ? (kindOf.get(l.service_id) ?? null) : null;
    const cut = { method: l.cut_method ?? null, note: l.cut_note ?? null };
    const parts = l.package_items ? packageParts(l.package_items) : null;
    if (parts) {
      for (const it of parts.items) {
        if (isPpfFilmItem(it.label)) add("ppf", "", it.label, it.warranty, cut, l.film_colour ?? null);
        else if (isTintText(it.label)) add("tint", "", it.label, it.warranty, null, null);
        else if (/ceramic|coating/i.test(it.label)) add("ceramic", slug(it.label), it.label, it.warranty, null, null);
      }
      continue;
    }
    const title = l.title ?? "";
    if (kind === "ppf_removal" || /remov/i.test(title)) continue;
    if (kind === "ppf" || kind === "coloured_ppf" || (isPpfText(title) && !/ceramic|coating|tint/i.test(title))) add("ppf", "", title, null, cut, l.film_colour ?? null);
    else if (kind === "tint" || isTintText(title)) add("tint", "", title, null, null, null);
    else if (/ceramic|coating/i.test(title)) add("ceramic", slug(title), title, null, null, null);
  }
  const order: WarrantyProduct[] = ["ppf", "tint", "ceramic"];
  return Array.from(out.values()).sort((a, b) => order.indexOf(a.product) - order.indexOf(b.product));
}

export async function warrantyEntriesOf(jobId: string): Promise<WarrantyEntry[]> {
  const { data } = await createAdminClient().from("warranty_entries").select("id, product, item_key, roll_batch, product_name, areas, entered_by, entered_at").eq("job_id", jobId).eq("is_active", true);
  return ((data ?? []) as WarrantyEntry[]).map((e) => ({ ...e, areas: Array.isArray(e.areas) ? e.areas.map(String) : [] }));
}

/** The job's own warranty address (the QR and the public page); made the first time it is needed. */
export async function ensureWarrantyToken(jobId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("jobs").select("warranty_token").eq("id", jobId).maybeSingle();
  if (!data) return null;
  if (data.warranty_token) return data.warranty_token as string;
  const token = newToken();
  await admin.from("jobs").update({ warranty_token: token }).eq("id", jobId).is("warranty_token", null);
  const { data: again } = await admin.from("jobs").select("warranty_token").eq("id", jobId).abortSignal(new AbortController().signal).maybeSingle();
  return (again?.warranty_token as string | null) ?? token;
}

export async function warrantyCardOf(jobId: string, settings: Settings, opts: { photos?: boolean; today?: string } = {}): Promise<WarrantyCard | null> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("jobs").select(JOB_COLS).eq("id", jobId).maybeSingle();
  if (!raw) return null;
  const job = raw as unknown as JobRaw;
  const [fitted, entries, spec, { data: checkRow }] = await Promise.all([
    fittedOf(jobId),
    warrantyEntriesOf(jobId),
    tintSpecForJob(jobId),
    admin.from("aftercare_checks").select("id, due_date, done_at, done_by, activated_at, activation_note, reminded_at, reminded_12_at, reminded_20_at, doneBy:staff!aftercare_checks_done_by_fkey(display_name)").eq("job_id", jobId).eq("is_active", true).maybeSingle(),
  ]);
  const terms = termsOf(settings.warranty_terms);
  const handoverDay = job.gated_out_at ? dubaiDay(job.gated_out_at) : null;
  const brand = String(settings.ppf_brand_name || "OFJ PPF");
  const entryOf = (p: WarrantyProduct, k: string) => entries.find((e) => e.product === p && e.item_key === k) ?? null;
  const rows: WarrantyRow[] = fitted.map((c) => {
    const e = entryOf(c.product, c.itemKey);
    const months = c.months ?? terms[c.product].months;
    const label = c.labels[0] ?? "";
    const suggestedAreas = c.product === "ppf" ? areasFromLabels(c.labels) : [];
    const areas = e?.areas?.length ? e.areas : [];
    let name = label;
    let coverage = label;
    let darkness: string | null = null;
    let cut: string | null = null;
    if (c.product === "ppf") {
      const finish = ppfFinishOf(c.labels.join(" "), c.filmColour);
      name = `${brand} – ${finish}`;
      coverage = (areas.length ? areas : suggestedAreas).join(", ") || label.replace(/\bppf\b|paint protection film/gi, "").replace(/[-–—,·]+/g, " ").replace(/\s+/g, " ").trim() || "Full body";
      const co = cutOf(c.cut?.method ?? null, c.cut?.note ?? null);
      cut = co.note ? `${co.short} (${co.note})` : co.short;
    } else if (c.product === "tint") {
      name = (c.labels.find((x) => /tint/i.test(x)) ?? label).split(/\s+[-–—]\s+/)[0].trim() || "Window tint";
      coverage = tintCoverageOf(spec, c.labels);
      darkness = tintSummary(spec);
    } else {
      name = e?.product_name?.trim() || label;
      coverage = ceramicCoverageOf(label);
    }
    return { product: c.product, itemKey: c.itemKey, name, coverage, rollBatch: e?.roll_batch?.trim() || null, cut, darkness, months, period: periodWords(months), start: handoverDay, validUntil: handoverDay ? addMonthsIso(handoverDay, months) : null, suggestedAreas, areas, productName: e?.product_name ?? null, label };
  });
  const missing: string[] = [];
  for (const r of rows) {
    if (r.product === "ppf") {
      if (!r.rollBatch) missing.push("PPF film roll or batch number");
      if (!r.areas.length) missing.push("PPF areas covered");
    } else if (r.product === "tint") {
      if (!r.rollBatch) missing.push("Tint roll number");
    } else {
      if (!r.productName) missing.push(`Ceramic product (${r.label})`);
      if (!r.rollBatch) missing.push(`Ceramic batch number (${r.label})`);
    }
  }
  const mechanical = job.department && job.department !== "bodyshop" ? { months: terms.mechanical.months, period: periodWords(terms.mechanical.months), start: handoverDay, validUntil: handoverDay ? addMonthsIso(handoverDay, terms.mechanical.months) : null } : null;
  const check = checkRow ? { id: checkRow.id as string, due_date: String(checkRow.due_date), done_at: (checkRow.done_at as string | null) ?? null, activated_at: (checkRow.activated_at as string | null) ?? null, activation_note: (checkRow.activation_note as string | null) ?? null, reminded_at: (checkRow.reminded_at as string | null) ?? null, reminded_12_at: (checkRow.reminded_12_at as string | null) ?? null, reminded_20_at: (checkRow.reminded_20_at as string | null) ?? null, done_by_name: (checkRow.doneBy as unknown as { display_name: string } | null)?.display_name ?? null } : null;
  const today = opts.today ?? dubaiDay(new Date().toISOString());
  let checkPhotos: WarrantyCard["checkPhotos"] = [];
  if (opts.photos && check?.done_at) {
    const { data: files } = await admin.from("job_files").select("id, storage_path, caption").eq("job_id", jobId).eq("caption", "10-day check").is("removed_at", null).order("taken_at");
    const paths = (files ?? []).map((f) => f.storage_path as string);
    const { data: signed } = paths.length ? await admin.storage.from(JOB_FILES_BUCKET).createSignedUrls(paths, 3600) : { data: [] as { path: string | null; signedUrl: string }[] };
    const urlOf = new Map((signed ?? []).filter((s) => s.path).map((s) => [s.path as string, s.signedUrl]));
    checkPhotos = (files ?? []).map((f) => ({ id: f.id as string, url: urlOf.get(f.storage_path as string) ?? null, caption: (f.caption as string | null) ?? null }));
  }
  const v = job.vehicle;
  return {
    jobId: job.id,
    jobNumber: job.job_number,
    department: job.department,
    token: job.warranty_token,
    certificateNo: `W-${job.job_number.replace(/^J-/, "")}`,
    car: [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ") || "Your car",
    colour: v?.colour ?? null,
    plate: v && v.has_plate !== false && v.plate_number ? formatPlate(v) : null,
    vin: v?.vin ?? null,
    rows,
    mechanical,
    handoverDay,
    status: warrantyStatusOf({ handoverDay, check, today }),
    check,
    checkPhotos,
    terms,
    missing,
    confirmedAt: job.warranty_confirmed_at,
    sentAt: job.warranty_card_sent_at,
    entries,
  };
}

export async function warrantyCardByToken(token: string, settings: Settings): Promise<WarrantyCard | null> {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return null;
  const { data } = await createAdminClient().from("jobs").select("id").eq("warranty_token", token).maybeSingle();
  return data ? warrantyCardOf(data.id as string, settings, { photos: true }) : null;
}

/** Which details a stage's Done asks for: PPF at the PPF stage (with the tint when it merged in), tint at the tint stage, ceramic at the final detail (or the clean). */
export function stageAsks(stage: { key: string }, stageKeys: string[], rows: WarrantyRow[]): WarrantyRow[] {
  const hasTintStage = stageKeys.includes("tint");
  const ceramicStage = stageKeys.includes("detail") ? "detail" : stageKeys.includes("clean") ? "clean" : null;
  return rows.filter((r) => (r.product === "ppf" && stage.key === "ppf") || (r.product === "tint" && (stage.key === "tint" || (stage.key === "ppf" && !hasTintStage))) || (r.product === "ceramic" && stage.key === ceramicStage));
}

/** The words that say what a row still needs (empty when complete). */
export function rowMissing(r: WarrantyRow): string[] {
  if (r.product === "ppf") return [!r.rollBatch ? "roll or batch number" : null, !r.areas.length ? "areas covered" : null].filter((x): x is string => !!x);
  if (r.product === "tint") return !r.rollBatch ? ["roll number"] : [];
  return [!r.productName ? "product" : null, !r.rollBatch ? "batch number" : null].filter((x): x is string => !!x);
}

/** Save one product's details (the stage's Done, or the Warranty details card). */
export async function saveWarrantyEntry(jobId: string, input: { product: WarrantyProduct; itemKey: string; rollBatch: string | null; productName: string | null; areas: string[] }, actor: { id: string }, stageId: string | null = null): Promise<void> {
  const admin = createAdminClient();
  const row = { roll_batch: input.rollBatch?.trim() || null, product_name: input.productName?.trim() || null, areas: input.areas, stage_id: stageId, entered_by: actor.id, entered_at: new Date().toISOString(), updated_by: actor.id };
  const { data: have } = await admin.from("warranty_entries").select("id").eq("job_id", jobId).eq("product", input.product).eq("item_key", input.itemKey).eq("is_active", true).abortSignal(new AbortController().signal).maybeSingle();
  if (have) await admin.from("warranty_entries").update(row).eq("id", have.id);
  else await admin.from("warranty_entries").insert({ job_id: jobId, product: input.product, item_key: input.itemKey, ...row, created_by: actor.id });
}
