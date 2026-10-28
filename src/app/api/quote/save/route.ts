import { refuseIfLocked } from "@/lib/quote-lock-server";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { dropParts } from "@/lib/drop-parts";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { LINE_TYPES, effectiveMarkupPercent, floorProblem, isHidden, lineTotal, minimumMarkupAed, parseHours, recoveryTitle, round2, type LineType, type QuoteLine } from "@/lib/quotes";
import { LINE_SELECT, SERVICE_SELECT, approvalReasonsNow, labourRateFor, loadQuotation, minMarkupFor, refreshQuoteTotals, toLine, logQuoteEvent } from "@/lib/quote-data";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { can, type RoleId } from "@/lib/roles";
import { toSnapshot } from "@/lib/packages";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { LINE_TEXT_MAX, tooLongWords } from "@/lib/text-limits";

type LinePatch = {
  package_key?: string | null;
  package_items?: unknown;
  line_type?: string;
  title?: string;
  details?: string | null;
  group_label?: string | null;
  quantity?: number | string;
  unit_cost?: number | string | null;
  markup_percent?: number | string | null;
  /** A part's markup kept as a percentage of the cost ("percent") or as a fixed AED amount per unit ("aed"). */
  markup_mode?: string | null;
  markup_aed?: number | string | null;
  unit_price?: number | string | null;
  hours?: number | string | null;
  /** Labour lines: the workshop's estimate of the hours (labour at cost), beside the quoted hours. */
  hours_estimate?: number | string | null;
  /** A service done outside: its cost is typed, never in the labour discount. */
  outside_work?: boolean;
  /** Section 10: the PPF cutting method and its note. */
  cut_method?: string | null;
  cut_note?: string | null;
  /** Bodyshop lines: film colour and code, or the tint shade. */
  film_colour?: string | null;
  film_code?: string | null;
  tint_percent?: number | string | null;
  labour_rate?: number | string | null;
  discount_percent?: number | string;
  discount_reason?: string | null;
  visible_to_customer?: boolean;
  urgency?: string | null;
  chosen?: boolean;
  recovery_trips?: number | string | null;
  recovery_provider?: string | null;
  recovery_provider_kind?: string | null;
  parent_line_id?: string | null;
  markup_confirmed?: boolean;
  dangerous?: boolean;
  source_type?: string | null;
  source_key?: string | null;
  positions?: unknown;
  service_id?: string | null;
  price_per?: string | null;
  /** A part left off this quotation: stays on the car's list, counts for nothing, is not ordered. */
  left_off?: boolean;
  /** Normal / Full down / Closed box (Settings). */
  recovery_type?: string | null;
  /** Who pays for the recovery (us: cost only, off the customer's quotation) and whether to mention it as free. */
  recovery_paid_by?: string | null;
  recovery_mention_free?: boolean;
  /** Sold at 0 on purpose: 'complimentary' or 'included' is a valid line that prints the word, not a price. */
  price_display?: string | null;
  /** Bodyshop costing: the estimated installer hours on the line (internal only). */
  installer_hours?: number | string | null;
};
type Body = {
  quotationId?: string;
  /** Set by the editor on every change; the same key twice is the same change (a retry), not a second row. */
  opId?: string;
  addLine?: LinePatch & { service_id?: string | null };
  patchLine?: { id: string } & LinePatch;
  /** keepParts: the job goes but its parts stay on the quotation, unlinked. */
  /** withParts: the parts under the job go too (off the parts list; Parts asked when one was already ordered). */
  removeLine?: { id: string; keepParts?: boolean; withParts?: boolean };
  reorder?: { ids: string[] };
  header?: { deposit_mode?: string | null; deposit_value?: number | string | null; discount_scope?: string; discount_percent?: number | string; customer_note?: string | null; validity_days?: number | string; payment_by_card?: boolean; expected_payment_method?: string; /** The labour discount: a percentage or a fixed amount of our own labour lines. */ discount_kind?: string | null; discount_value?: number | string | null; materials_cost_aed?: number | string | null; /** Section 7: the owner's per-job film rolls for the package cost estimate. */ film_rolls_est?: number | string | null };
  /** The editing lock: "take" every half minute while the editor is open, "release" on leaving. */
  lock?: "take" | "release";
  /** An advisor's part: description and quantity only; it goes to the Parts desk to be priced. */
  requestPart?: { description: string; quantity?: number | string; source_type?: string | null; source_key?: string | null; positions?: unknown; catalogue_id?: string | null };
  /** A finding the advisor is not quoting, with the reason; a null reason takes the mark off again. */
  notQuoted?: { key: string; reason: string | null };
};

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : null;
};

/**
 * Saves one change to a quotation as the advisor types. Every change is kept at once; nothing typed
 * is lost. The rules live here too: parts come only from the Parts desk (an estimate may type them),
 * a listed part keeps the name, quantity and cost Parts gave it and the advisor sets only the markup,
 * never below the floor and, above the confirmation level, only after confirming the selling price;
 * a labour line is Urgent or nothing; the bank charge line cannot be touched; a dangerous warning
 * is the owner's to switch off; any change after "Quotation complete" reopens the quotation.
 */
export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (staff.viewingAs) return NextResponse.json({ error: "View only." }, { status: 403 });
  const role = staff.role_id as RoleId;
  const isOwner = role === "owner";
  if (!can(role, "editQuotes")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, kind, job_id, number, status, created_by, vehicle_id, not_quoted, editing_by, editing_at").eq("id", String(body.quotationId ?? "")).maybeSingle();
  if (!q) return NextResponse.json({ error: "Quotation not found." }, { status: 404 });
  // One person edits a quotation at a time. The lock is fresh for a minute and a half after the last heartbeat.
  const LOCK_FRESH_MS = 90000;
  const lockHeldByOther = !!q.editing_by && q.editing_by !== staff.id && !!q.editing_at && Date.now() - Date.parse(q.editing_at) < LOCK_FRESH_MS;
  const lockerName = async () => (await admin.from("staff").select("display_name").eq("id", q.editing_by ?? "").maybeSingle()).data?.display_name ?? "Someone";
  if (body.lock === "release") {
    if (q.editing_by === staff.id) await admin.from("quotations").update({ editing_by: null, editing_at: null }).eq("id", q.id);
    return NextResponse.json({ ok: true });
  }
  if (body.lock === "take") {
    if (lockHeldByOther) return NextResponse.json({ error: `${await lockerName()} is editing this quotation.`, lockedBy: await lockerName() }, { status: 423 });
    const taking = q.editing_by !== staff.id;
    const fresh = !taking && !!q.editing_at && Date.now() - Date.parse(q.editing_at) < 30_000;
    if (!fresh) await admin.from("quotations").update({ editing_by: staff.id, editing_at: new Date().toISOString() }).eq("id", q.id);
    if (taking && q.job_id) {
      // The car's advisor hears when someone else starts on his quotation.
      const { data: job } = await admin.from("jobs").select("gated_in_by, job_number").eq("id", q.job_id).maybeSingle();
      const advisors = (await advisorsInCharge(q.job_id)).filter((x) => x !== staff.id);
      if (advisors.length && !advisors.includes(staff.id)) await notifyStaff(advisors, { type: "quote_other_editor", title: `${staff.display_name} is working on ${q.number} · ${job?.job_number ?? ""}`, body: "Your car's quotation is being changed by someone else.", jobId: q.job_id, href: `/jobs/${q.job_id}/quote/${q.id}` });
    }
    return NextResponse.json({ ok: true });
  }
  if (lockHeldByOther) return NextResponse.json({ error: `${await lockerName()} is editing this quotation. You can read it; changes open once they leave.` }, { status: 423 });
  if (q.status !== "draft" && q.status !== "pending_owner") {
    // Approved by the customer (or replaced): locked for everyone, whatever the screen; the attempt goes in the quotation's history.
    const what = body.removeLine ? "remove a line" : body.addLine ? "add a line" : body.patchLine ? `change a line (${Object.keys(body.patchLine).filter((k) => k !== "id").join(", ").replace(/_/g, " ") || "fields"})` : body.header ? `change the ${Object.keys(body.header).join(", ").replace(/_/g, " ")}` : body.reorder ? "reorder the lines" : body.requestPart ? "add a part request" : body.notQuoted ? "mark a finding as not quoted" : "change the quotation";
    const refused = await refuseIfLocked(q.id, staff.id, what, "quotation editor");
    if (refused) return NextResponse.json({ error: refused, locked: true }, { status: 423 });
    return NextResponse.json({ error: "This version has been sent. Revise it to make changes." }, { status: 423 });
  }
  const settings = await getSettings();
  const { data: vehicle } = q.vehicle_id ? await admin.from("vehicles").select("make:vehicle_makes(name)").eq("id", q.vehicle_id).maybeSingle() : { data: null };
  const makeName = (vehicle?.make as unknown as { name: string } | null)?.name ?? null;
  const minMarkup = minMarkupFor(settings, makeName);
  const { data: job } = q.job_id ? await admin.from("jobs").select("department, job_number").eq("id", q.job_id).maybeSingle() : { data: null };
  const labourRate = labourRateFor(settings, job?.department ?? null, makeName);
  const recoveryTypes = (settings.recovery_types ?? []) as { key: string; label: string; cost: number; price: number }[];
  const stamp = { updated_by: staff.id };
  const refreshed = () => refreshQuoteTotals(q.id, settings, staff.id, { reopen: true });

  const cleanPatch = (p: LinePatch, current: Partial<QuoteLine> | null): Record<string, unknown> | string | { confirm: string } => {
    const out: Record<string, unknown> = {};
    if (current?.fee_kind) return "The bank charge line is automatic; it cannot be changed.";
    const type = (p.line_type ?? current?.line_type) as LineType | undefined;
    if (p.line_type !== undefined) {
      if (!LINE_TYPES.some((t) => t.value === p.line_type)) return "Bad line type.";
      if (current?.part_item_id) return "A listed part keeps its type.";
      if (p.line_type === "fee") return "The bank charge is automatic; there is no Fee line to add.";
      out.line_type = p.line_type;
    }
    if (p.title !== undefined) {
      if (current?.part_item_id && !isOwner) return "A listed part keeps the name Parts gave it. Ask Parts to change it.";
      const t = String(p.title).trim();
      if (t.length > LINE_TEXT_MAX) return tooLongWords(t.length);
      out.title = t;
    }
    if (p.details !== undefined) {
      const d = p.details ? String(p.details).trim() : "";
      if (d.length > LINE_TEXT_MAX) return tooLongWords(d.length);
      out.details = d || null;
    }
    if (p.group_label !== undefined) out.group_label = p.group_label ? String(p.group_label).trim().slice(0, 200) : null;
    if (p.source_type !== undefined) out.source_type = p.source_type && ["request", "item", "tyre", "manual"].includes(p.source_type) ? p.source_type : null;
    if (p.source_key !== undefined) out.source_key = p.source_key ? String(p.source_key).slice(0, 120) : null;
    if (p.quantity !== undefined) out.quantity = Math.max(0.01, n(p.quantity) ?? 1);
    if (p.unit_cost !== undefined) {
      if (type === "part" && q.kind === "quotation") return "The cost of a part comes from Parts.";
      out.unit_cost = n(p.unit_cost);
    }
    if (p.unit_price !== undefined) out.unit_price = n(p.unit_price);
    if (p.price_display !== undefined) out.price_display = p.price_display && ["complimentary", "included"].includes(String(p.price_display)) ? String(p.price_display) : "normal";
    if (p.hours !== undefined) out.hours = parseHours(p.hours);
    if (p.hours_estimate !== undefined) out.hours_estimate = p.hours_estimate === null || p.hours_estimate === "" ? null : parseHours(p.hours_estimate);
    if (p.installer_hours !== undefined) out.installer_hours = p.installer_hours === null || p.installer_hours === "" ? null : parseHours(p.installer_hours);
    if (p.outside_work !== undefined) out.outside_work = !!p.outside_work;
    if (p.package_key !== undefined) out.package_key = p.package_key ? String(p.package_key).slice(0, 60) : null;
    if (p.package_items !== undefined) out.package_items = p.package_items ? toSnapshot(p.package_items) : null;
    if (p.cut_method !== undefined) out.cut_method = p.cut_method === "hand" || p.cut_method === "machine" || p.cut_method === "mixed" ? p.cut_method : null;
    if (p.cut_note !== undefined) {
      const cn = p.cut_note ? String(p.cut_note).trim() : "";
      if (cn.length > LINE_TEXT_MAX) return tooLongWords(cn.length);
      out.cut_note = cn || null;
    }
    if (p.film_colour !== undefined) out.film_colour = p.film_colour ? String(p.film_colour).trim().slice(0, 60) || null : null;
    if (p.film_code !== undefined) out.film_code = p.film_code ? String(p.film_code).trim().slice(0, 40) || null : null;
    if (p.tint_percent !== undefined) { const tp = n(p.tint_percent); out.tint_percent = tp === null ? null : Math.min(100, Math.max(1, Math.round(tp))); }
    if (p.labour_rate !== undefined) {
      // The advisor can raise the hourly rate, never set it below the standard rate for this car. Only the owner can go lower.
      const rate = n(p.labour_rate);
      if (rate === null || rate < 0) return "Enter the hourly rate.";
      if (!isOwner && rate + 0.005 < labourRate) return `The rate cannot be below the standard rate of AED ${labourRate} per hour for this car. Only the owner can go lower.`;
      out.labour_rate = rate;
    }
    if (p.markup_percent !== undefined || p.markup_aed !== undefined || p.markup_mode !== undefined) {
      if (type === "part") {
        // A part's markup is a percentage of the cost or a fixed AED amount per unit (22 October 2026). No upper limit
        // for now: nothing is asked however high it goes. The minimum stays: an advisor's figure below it goes back to
        // the minimum (in the line's own mode); only the owner can go below (kept as confirmed for the floor check).
        const mode = p.markup_mode === "aed" || p.markup_mode === "percent" ? p.markup_mode : current?.markup_mode === "aed" ? "aed" : "percent";
        const cost = Number(current?.unit_cost ?? 0) || 0;
        let pct = p.markup_percent !== undefined ? (n(p.markup_percent) ?? minMarkup) : Number(current?.markup_percent ?? minMarkup);
        let amt: number | null = p.markup_aed !== undefined ? n(p.markup_aed) : current?.markup_aed ?? null;
        if (mode === "aed" && (amt === null || amt === undefined)) amt = round2((cost * pct) / 100);
        let belowByOwner = false;
        if (effectiveMarkupPercent({ unit_cost: cost, markup_percent: pct, markup_mode: mode, markup_aed: amt }) < minMarkup - 1e-9) {
          if (isOwner) belowByOwner = true;
          else if (mode === "aed") amt = minimumMarkupAed(cost, minMarkup);
          else pct = minMarkup;
        }
        out.markup_mode = mode;
        out.markup_percent = Math.round(pct * 1e6) / 1e6;
        out.markup_aed = amt === null || amt === undefined ? null : round2(amt);
        out.markup_confirmed = belowByOwner;
      } else if (p.markup_percent !== undefined) out.markup_percent = n(p.markup_percent);
    }
    if (p.discount_percent !== undefined) {
      const d = Math.min(100, Math.max(0, n(p.discount_percent) ?? 0));
      const labourish = type === "labour" || type === "package";
      if (!isOwner && !(labourish && settings.advisor_labour_discount === true)) return labourish ? "Only the owner gives discounts on a line (Settings: Advisors can discount labour)." : "Only the owner gives discounts on a line.";
      if (type === "part" && d > 0 && !(p.discount_reason ?? current?.discount_reason)) return "Write the reason for the part discount; it is logged.";
      out.discount_percent = d;
    }
    if (p.discount_reason !== undefined) out.discount_reason = p.discount_reason ? String(p.discount_reason).trim().slice(0, 300) : null;
    if (p.visible_to_customer !== undefined) {
      // Section 13: any line can be an internal cost only (film, consumables) - never a system fee, never a safety finding.
      if (type === "fee") return "This line is set by the system.";
      if (p.visible_to_customer === false && current?.dangerous) return "A dangerous finding is always shown to the customer.";
      out.visible_to_customer = !!p.visible_to_customer;
    }
    if (p.urgency !== undefined) {
      if (p.urgency !== null && p.urgency !== "urgent") return "A line is Urgent or nothing.";
      if (current?.dangerous && p.urgency !== "urgent") return "A dangerous finding is always Urgent.";
      out.urgency = p.urgency;
    }
    if (p.dangerous !== undefined) {
      if (!isOwner) return "Only the owner can switch the safety warning off.";
      out.dangerous = !!p.dangerous;
      if (p.dangerous) out.urgency = "urgent";
    }
    if (p.chosen !== undefined) {
      if (!current?.option_group) return "This part has no other option to choose between.";
      out.chosen = !!p.chosen;
    }
    if (p.parent_line_id !== undefined) out.parent_line_id = p.parent_line_id ? String(p.parent_line_id) : null;
    if (p.left_off !== undefined) {
      if (type !== "part") return "Only a part can be left off the quotation.";
      out.left_off = !!p.left_off;
    }
    if (p.recovery_type !== undefined) {
      const rt = recoveryTypes.find((t) => t.key === String(p.recovery_type ?? ""));
      if (!rt) return "Choose the recovery type.";
      out.recovery_type = rt.key;
      if (p.unit_cost === undefined) out.unit_cost = Number(rt.cost) || 0;
      if (p.unit_price === undefined) out.unit_price = Number(rt.price) || 0;
    }
    if (p.positions !== undefined) out.positions = Array.isArray(p.positions) ? Array.from(new Set(p.positions.map((x) => String(x).trim().slice(0, 30)).filter(Boolean))).slice(0, 8) : null;
    if (p.service_id !== undefined) {
      if (current?.part_item_id) return "A listed part is not a service.";
      out.service_id = p.service_id ? String(p.service_id) : null;
    }
    if (p.price_per !== undefined) out.price_per = p.price_per ? String(p.price_per).trim().slice(0, 30) : null;
    if (p.recovery_trips !== undefined) {
      const t = n(p.recovery_trips);
      out.recovery_trips = t;
      if (t !== null && t > 0) out.quantity = t;
    }
    if (p.recovery_provider !== undefined) out.recovery_provider = p.recovery_provider ? String(p.recovery_provider).trim().slice(0, 120) : null;
    if (p.recovery_provider_kind !== undefined) {
      const k = String(p.recovery_provider_kind ?? "ours");
      if (!["ours", "external", "customer"].includes(k)) return "Choose the recovery provider.";
      out.recovery_provider_kind = k;
      if (k === "customer") Object.assign(out, { unit_cost: 0, unit_price: 0, visible_to_customer: false, recovery_provider: null });
      if (k === "ours") out.recovery_provider = null;
    }
    // Who pays decides what the customer sees: paid by us means no price and nothing on the quotation, unless it is mentioned as free (AED 0).
    if (p.recovery_paid_by !== undefined) {
      const who = String(p.recovery_paid_by ?? "");
      if (who !== "us" && who !== "customer") return "Who pays for the recovery: us or the customer?";
      out.recovery_paid_by = who;
      const free = p.recovery_mention_free !== undefined ? p.recovery_mention_free === true : current?.recovery_mention_free === true;
      if (who === "us") Object.assign(out, { unit_price: 0, visible_to_customer: free, recovery_mention_free: free, price_display: free ? "complimentary" : "normal", ...(free ? { title: "Complimentary pick-up & drop-off" } : {}) });
      else Object.assign(out, { visible_to_customer: true, recovery_mention_free: false, price_display: "normal" });
    }
    if (p.recovery_mention_free !== undefined && p.recovery_paid_by === undefined) {
      const on = p.recovery_mention_free === true;
      out.recovery_mention_free = on;
      if ((current?.recovery_paid_by ?? (current?.visible_to_customer === false ? "us" : "customer")) === "us") Object.assign(out, { visible_to_customer: on, unit_price: 0, price_display: on ? "complimentary" : "normal", ...(on ? { title: "Complimentary pick-up & drop-off" } : {}) });
    }
    return out;
  };

  /** After a change, a line with a cost must still clear the floor. */
  const checkFloor = (merged: QuoteLine) => {
    const problem = floorProblem(merged, minMarkup);
    if (problem) return `Blocked: ${problem}. The minimum markup is a floor on the final price, after every discount.`;
    if (merged.unit_cost !== null && merged.unit_cost !== undefined && (merged.line_type === "part" || merged.line_type === "other") && !isHidden(merged) && lineTotal(merged) + 0.005 < round2(merged.unit_cost * (merged.quantity || 1))) return "Blocked: that would sell the part below its cost.";
    return null;
  };
  const rememberProvider = async (name: string | null | undefined) => {
    const clean = (name ?? "").trim();
    if (!clean) return;
    const list = Array.isArray(settings.recovery_providers) ? (settings.recovery_providers as string[]) : [];
    if (list.some((x) => x.toLowerCase() === clean.toLowerCase())) return;
    await admin.from("settings").update({ value: [clean, ...list].slice(0, 50) }).eq("key", "recovery_providers");
  };

  if (body.notQuoted) {
    const key = String(body.notQuoted.key ?? "").slice(0, 160);
    if (!key) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const map = { ...((q.not_quoted ?? {}) as Record<string, string>) };
    const reason = body.notQuoted.reason === null ? null : String(body.notQuoted.reason).trim().slice(0, 300);
    if (reason === null) delete map[key];
    else {
      if (reason.length < 2) return NextResponse.json({ error: "Say why this finding is not quoted." }, { status: 400 });
      map[key] = reason;
    }
    const { error } = await admin.from("quotations").update({ not_quoted: map, ...stamp }).eq("id", q.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await refreshed();
    return NextResponse.json({ ok: true });
  }

  if (body.requestPart) {
    if (!q.job_id) return NextResponse.json({ error: "An estimate has no job for Parts to price. Type the part as a line instead." }, { status: 400 });
    const description = String(body.requestPart.description ?? "").trim();
    if (!description) return NextResponse.json({ error: "Describe the part." }, { status: 400 });
    if (description.length > LINE_TEXT_MAX) return NextResponse.json({ error: tooLongWords(description.length) }, { status: 400 });
    const qty = Math.max(0.01, n(body.requestPart.quantity) ?? 1);
    const reqPositions = Array.isArray(body.requestPart.positions) ? Array.from(new Set(body.requestPart.positions.map((x) => String(x).trim().slice(0, 30)).filter(Boolean))).slice(0, 8) : [];
    const reqCatalogue = typeof body.requestPart.catalogue_id === "string" && /^[0-9a-f-]{36}$/i.test(body.requestPart.catalogue_id) ? body.requestPart.catalogue_id : null;
    // A part asked from under a finding keeps that finding, so it lands under the right labour line once priced.
    const srcType = body.requestPart.source_type && ["request", "item", "tyre"].includes(body.requestPart.source_type) ? body.requestPart.source_type : "manual";
    const srcKey = srcType === "manual" ? `${q.id}:${Date.now()}` : `${String(body.requestPart.source_key ?? "")}#q${Date.now()}`;
    const opKey = body.opId ? String(body.opId).slice(0, 80) : null;
    if (opKey) {
      const { data: same } = await admin.from("part_requests").select("id").eq("client_key", opKey).maybeSingle();
      if (same) return NextResponse.json({ ok: true });
    }
    const { error } = await admin.from("part_requests").insert({ job_id: q.job_id, source_type: srcType, source_key: srcKey, label: description, positions: reqPositions, catalogue_id: reqCatalogue, requested_text: `Quantity ${qty} · asked by ${staff.display_name} on ${q.number}`, quantity: qty, client_key: opKey, created_by: staff.id, ...stamp });
    if (error) return NextResponse.json({ ok: !!/client_key/.test(error.message), error: /client_key/.test(error.message) ? undefined : error.message }, { status: /client_key/.test(error.message) ? 200 : 500 });
    await notifyRoles(["parts"], { type: "parts_request", title: `Part to price · ${job?.job_number ?? ""}`, body: `${description} × ${qty}, asked by ${staff.display_name} on ${q.number}.`, jobId: q.job_id, href: `/parts/${q.job_id}` });
    await refreshed();
    return NextResponse.json({ ok: true });
  }

  if (body.addLine) {
    const a = body.addLine;
    let type = ((a.line_type as LineType | undefined) ?? "labour") as LineType;
    if (type === "fee") return NextResponse.json({ error: "The bank charge is automatic; there is no Fee line to add." }, { status: 400 });
    if (type === "part" && q.kind === "quotation") return NextResponse.json({ error: "Parts come through the Parts desk. Use \"+ Add a part\"." }, { status: 400 });
    if (body.opId) {
      const { data: same } = await admin.from("quotation_lines").select("id").eq("client_key", String(body.opId).slice(0, 80)).maybeSingle();
      if (same) return NextResponse.json({ ok: true, id: same.id });
    }
    if (String(a.title ?? "").trim().length > LINE_TEXT_MAX) return NextResponse.json({ error: tooLongWords(String(a.title ?? "").trim().length) }, { status: 400 });
    const row: Record<string, unknown> = { quotation_id: q.id, line_type: type, source_type: "manual", client_key: body.opId ? String(body.opId).slice(0, 80) : null, created_by: staff.id, ...stamp, title: String(a.title ?? "").trim(), group_label: a.group_label ? String(a.group_label).slice(0, 200) : null };
    // Parts a service asks for; they go to the Parts desk once the line is safely in.
    let linked: { rows: Record<string, unknown>[]; name: string } | null = null;
    if (a.service_id) {
      const { data: svc } = await admin.from("services").select(SERVICE_SELECT).eq("id", String(a.service_id)).maybeSingle();
      if (!svc) return NextResponse.json({ error: "Service not found." }, { status: 404 });
      // A bodyshop package has no fixed price: a service line whose price the advisor types every time.
      // A service set as fixed price in Settings is a fixed line even when the price is typed each time (line_kind), never hours x rate.
      type = (svc.line_kind ? svc.line_kind === "service" : svc.price_aed !== null) || svc.bodyshop_kind ? "package" : "labour";
      Object.assign(row, { quantity: type === "package" ? Math.max(1, Math.round(Number(svc.usual_quantity) || 1)) : 1, price_per: type === "package" ? (svc.price_per ?? "job") : null, line_type: type, title: svc.name, details: svc.description ?? null, service_id: svc.id, source_type: a.source_type && a.source_key ? a.source_type : "package", source_key: a.source_type && a.source_key ? a.source_key : null, unit_price: svc.price_aed !== null ? Number(svc.price_aed) : null, hours: svc.default_hours !== null ? Number(svc.default_hours) : null, labour_rate: labourRate });
      // The service's default installer hours (bodyshop costing): copied onto the line, editable there.
      const svcInstaller = svc.installer_hours !== null && svc.installer_hours !== undefined ? Number(svc.installer_hours) : svc.bodyshop_kind || svc.department === "bodyshop" ? Number(settings.bodyshop_default_installer_hours) || null : null;
      if (type === "package" && svcInstaller) row.installer_hours = svcInstaller;
      // A job added for a finding keeps that finding, so its parts land under it.
      if (a.source_type && a.source_key && ["item", "tyre", "request"].includes(a.source_type)) Object.assign(row, { source_type: a.source_type, source_key: String(a.source_key).slice(0, 120) });
      if (Array.isArray(a.positions)) row.positions = Array.from(new Set(a.positions.map((x) => String(x).trim().slice(0, 30)).filter(Boolean))).slice(0, 8);
      if (q.job_id && Array.isArray(svc.parts_requests) && svc.parts_requests.length) {
        linked = { name: svc.name, rows: (svc.parts_requests as string[]).map((label, i) => ({ job_id: q.job_id, source_type: "manual", source_key: `${svc.id}:${Date.now()}:${i}`, label, requested_text: `For ${svc.name}, added by ${staff.display_name} on ${q.number}`, created_by: staff.id, ...stamp })) };
      }
    } else if (type === "part") {
      // Estimates only: the car is not here, so the advisor types the part with cost and markup.
      Object.assign(row, { unit_cost: n(a.unit_cost), markup_percent: Math.max(minMarkup, n(a.markup_percent) ?? minMarkup), quantity: Math.max(0.01, n(a.quantity) ?? 1), title: row.title || "Part" });
    } else {
      const patch = cleanPatch(a, null);
      if (typeof patch === "string") return NextResponse.json({ error: patch }, { status: 400 });
      if ("confirm" in patch) return NextResponse.json({ error: patch.confirm, confirm: true }, { status: 409 });
      Object.assign(row, patch);
      if (type === "labour" && row.labour_rate === undefined) row.labour_rate = labourRate;
      if ((type === "other" || type === "recovery") && row.markup_percent === undefined) row.markup_percent = minMarkup;
      if (type === "recovery") {
        if (row.recovery_trips === undefined) row.recovery_trips = 1;
        if (row.quantity === undefined) row.quantity = row.recovery_trips;
        if (row.recovery_provider_kind === undefined) row.recovery_provider_kind = "ours";
        if (row.recovery_paid_by === undefined) row.recovery_paid_by = row.visible_to_customer === false ? "us" : "customer";
        const rt = recoveryTypes.find((t) => t.key === row.recovery_type) ?? recoveryTypes[0] ?? null;
        if (rt) {
          row.recovery_type = rt.key;
          if (row.unit_cost === undefined) row.unit_cost = Number(rt.cost) || 0;
          if (row.unit_price === undefined) row.unit_price = row.recovery_paid_by === "us" ? 0 : Number(rt.price) || 0;
        }
        row.title = recoveryTitle(rt?.label ?? null, Number(row.recovery_trips) || 1, row.recovery_paid_by === "us" && row.recovery_mention_free === true);
        row.details = null;
      }
      if (type === "other" && !row.title) row.title = "";
    }
    // The editor draws the line before the save answers and sends its id: the row is born with it, so the screen and the server agree.
    const wantId = typeof (a as { id?: unknown }).id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((a as { id: string }).id) ? (a as { id: string }).id : null;
    if (wantId) row.id = wantId;
    const { data: last } = await admin.from("quotation_lines").select("position").eq("quotation_id", q.id).eq("is_active", true).neq("line_type", "fee").order("position", { ascending: false }).limit(1).maybeSingle();
    row.position = (Number(last?.position) || 0) + 1;
    const { data: created, error } = await admin.from("quotation_lines").insert(row).select("id").single();
    if (error || !created) return NextResponse.json({ error: error?.message ?? "Could not add the line." }, { status: 500 });
    if (linked) {
      await admin.from("part_requests").insert(linked.rows);
      await notifyRoles(["parts"], { type: "parts_request", title: `Parts to price · ${job?.job_number ?? ""}`, body: `${linked.rows.map((r) => r.label).join(", ")} for ${linked.name}.`, jobId: q.job_id, href: `/parts/${q.job_id}` });
    }
    if (type === "recovery" && row.recovery_provider_kind === "external") await rememberProvider(row.recovery_provider as string | null);
    await refreshed();
    return NextResponse.json({ ok: true, id: created.id });
  }
  if (body.patchLine) {
    const { data: curRaw } = await admin.from("quotation_lines").select(LINE_SELECT).eq("id", body.patchLine.id).eq("quotation_id", q.id).maybeSingle();
    if (!curRaw) return NextResponse.json({ error: "Line not found." }, { status: 404 });
    const cur = toLine(curRaw as Record<string, unknown>);
    const patch = cleanPatch(body.patchLine, cur);
    if (typeof patch === "string") return NextResponse.json({ error: patch }, { status: 400 });
    if ("confirm" in patch) return NextResponse.json({ error: patch.confirm, confirm: true }, { status: 409 });
    if (cur.part_item_id && "unit_cost" in patch) delete patch.unit_cost; // The cost of a listed part comes from Parts.
    if (cur.part_item_id && "quantity" in patch) delete patch.quantity; // And its quantity from the technician.
    const merged = { ...cur, ...patch } as QuoteLine;
    if (cur.line_type === "recovery") {
      // The customer's wording follows the type and the trips: "Recovery, closed box, two ways".
      const rt = recoveryTypes.find((t) => t.key === merged.recovery_type) ?? null;
      patch.title = recoveryTitle(rt?.label ?? null, merged.recovery_trips ?? merged.quantity ?? 1, (merged.recovery_paid_by ?? (merged.visible_to_customer === false ? "us" : "customer")) === "us" && merged.recovery_mention_free === true);
      patch.details = null;
      merged.title = String(patch.title);
    }
    const floorError = checkFloor(merged);
    if (floorError) return NextResponse.json({ error: floorError }, { status: 400 });
    if ("labour_rate" in patch && Number(patch.labour_rate) !== Number(cur.labour_rate ?? 0)) {
      await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: q.job_id, event_type: "labour_rate", note: `${staff.display_name} changed the hourly rate on ${cur.title || "a labour line"} from AED ${Number(cur.labour_rate ?? 0)} to AED ${Number(patch.labour_rate)} (standard AED ${labourRate})`, created_by: staff.id });
    }
    if ("discount_percent" in patch && Number(patch.discount_percent) > 0 && Number(patch.discount_percent) !== Number(cur.discount_percent ?? 0)) {
      await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: q.job_id, event_type: "part_discount", note: `${staff.display_name} gave a ${patch.discount_percent}% discount on ${cur.title}${merged.discount_reason ? `: ${merged.discount_reason}` : ""}`, created_by: staff.id });
    }
    if (patch.markup_confirmed === true && cur.line_type === "part") {
      await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: q.job_id, event_type: "markup_below_minimum", note: `${staff.display_name} set the markup on ${cur.title} below the minimum of ${minMarkup}%`, created_by: staff.id });
    }
    if ("dangerous" in patch && !patch.dangerous && cur.dangerous) {
      await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: q.job_id, event_type: "danger_off", note: `${staff.display_name} switched the safety warning off on ${cur.title}`, created_by: staff.id });
    }
    const { error } = await admin.from("quotation_lines").update({ ...patch, ...stamp }).eq("id", cur.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // One option used per group: choosing this one puts the others aside.
    if (patch.chosen === true && cur.option_group) await admin.from("quotation_lines").update({ chosen: false, ...stamp }).eq("quotation_id", q.id).eq("option_group", cur.option_group).neq("id", cur.id);
    if (cur.line_type === "recovery" && (merged.recovery_provider_kind ?? "ours") === "external") await rememberProvider(merged.recovery_provider);
    await refreshed();
    return NextResponse.json({ ok: true });
  }
  if (body.removeLine) {
    const { data: cur } = await admin.from("quotation_lines").select("id, fee_kind, line_type, part_item_id").eq("id", body.removeLine.id).eq("quotation_id", q.id).maybeSingle();
    if (!cur) return NextResponse.json({ error: "Line not found." }, { status: 404 });
    if (cur.fee_kind) return NextResponse.json({ error: "The bank charge line is automatic; it cannot be removed." }, { status: 400 });
    const { error } = await admin.from("quotation_lines").update({ is_active: false, ...stamp }).eq("id", cur.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const actor = { id: staff.id, display_name: staff.display_name };
    if (cur.line_type === "labour" || cur.line_type === "package") {
      if (body.removeLine.withParts && q.job_id) {
        // The customer declined the job: its parts go too. Not yet ordered: off the parts list; already ordered: Parts are asked.
        const { data: kids } = await admin.from("quotation_lines").select("id, part_item_id").eq("quotation_id", q.id).eq("parent_line_id", cur.id).eq("is_active", true);
        const ids = (kids ?? []).map((k) => k.id);
        if (ids.length) await admin.from("quotation_lines").update({ is_active: false, ...stamp }).in("id", ids);
        await dropParts(q.job_id, (kids ?? []).map((k) => k.part_item_id).filter((x): x is string => !!x), actor, "declined");
      } else {
        // Parts stand on their own: removing a job alone leaves its parts on the quotation, unlinked.
        await admin.from("quotation_lines").update({ parent_line_id: null, ...stamp }).eq("quotation_id", q.id).eq("parent_line_id", cur.id);
      }
    } else if (cur.line_type === "part" && cur.part_item_id && q.job_id) {
      // A part taken off the quotation leaves the parts list too (Parts are asked when it was already ordered).
      await dropParts(q.job_id, [cur.part_item_id], actor, "removed");
    }
    await refreshed();
    return NextResponse.json({ ok: true });
  }
  if (body.reorder) {
    let position = 0;
    for (const id of body.reorder.ids) await admin.from("quotation_lines").update({ position: position++, ...stamp }).eq("id", id).eq("quotation_id", q.id).is("fee_kind", null);
    // The customer documents follow the same order, so a completed quotation reopens for a fresh look at Send.
    await refreshed();
    return NextResponse.json({ ok: true });
  }
  if (body.header) {
    const h = body.header;
    const patch: Record<string, unknown> = { ...stamp };
    if (h.discount_percent !== undefined) {
      // The labour discount is the advisor's (within the Settings limit, checked at send); only the
      // LEGACY whole-total percent stays owner-only. Clearing it to 0 rides along with any discount save.
      const legacy = Math.min(100, Math.max(0, n(h.discount_percent) ?? 0));
      if (!isOwner && legacy > 0) return NextResponse.json({ error: "Only the owner uses the old whole-total discount. Use Discount (labour) instead." }, { status: 403 });
      patch.discount_percent = legacy;
    }
    // The labour discount: a percentage or a fixed amount of our own labour lines; nothing on parts or outside services.
    if (h.discount_kind !== undefined || h.discount_value !== undefined) {
      const kind = h.discount_kind === "aed" ? "aed" : h.discount_kind === "percent" ? "percent" : null;
      const v = n(h.discount_value) ?? 0;
      if (!kind || v <= 0) Object.assign(patch, { discount_kind: null, discount_value: null, discount_percent: 0 });
      else Object.assign(patch, { discount_kind: kind, discount_value: kind === "percent" ? Math.min(100, v) : v, discount_percent: 0 });
    }
    // Who gave the discount decides the words and the approval (B3). The giver is stamped only when the discount really
    // changes (Apply with the same figures changes nothing). The owner's own discount never needs his approval, and it
    // approves nothing else either: a quotation waiting for him is checked again after the save (below). An advisor's
    // change while it waits sends it back to draft, so the owner sees the new figure when it is sent again; an earlier
    // approval only covers what the owner saw (approvalCovers at the send).
    let ownerDiscountWhilePending = false;
    if (h.discount_kind !== undefined || h.discount_value !== undefined || h.discount_scope !== undefined) {
      const { data: curA } = await admin.from("quotations").select("status, discount_kind, discount_value, discount_scope").eq("id", q.id).maybeSingle();
      const kindWas = (curA?.discount_kind as string | null) ?? null;
      const valueWas = Number(curA?.discount_value ?? 0) || 0;
      const scopeWas = (curA?.discount_scope as string | null) ?? "labour";
      const kindNow = "discount_kind" in patch ? ((patch.discount_kind as string | null) ?? null) : kindWas;
      const valueNow = "discount_value" in patch ? Number(patch.discount_value ?? 0) || 0 : valueWas;
      const scopeNow = h.discount_scope !== undefined ? (h.discount_scope === "labour_services" ? "labour_services" : "labour") : scopeWas;
      if (kindNow !== kindWas || Math.abs(valueNow - valueWas) > 0.0001 || scopeNow !== scopeWas) {
        Object.assign(patch, { discount_set_by: staff.id, discount_set_at: new Date().toISOString() });
        if (curA?.status === "pending_owner") {
          if (isOwner) ownerDiscountWhilePending = true;
          else Object.assign(patch, { status: "draft", owner_approval_reason: null });
        }
      }
    }
    // The deposit the advisor asks for: none, a fixed amount, a share of the parts or of the total. Written down with who and when.
    if (h.deposit_mode !== undefined || h.deposit_value !== undefined) {
      const { data: curQ } = await admin.from("quotations").select("deposit_mode, deposit_value, number, version").eq("id", q.id).maybeSingle();
      const mode = h.deposit_mode === undefined ? ((curQ?.deposit_mode as string | null) ?? "none") : ["none", "aed", "percent_parts", "percent_total"].includes(String(h.deposit_mode)) ? String(h.deposit_mode) : "none";
      const raw = h.deposit_value === undefined ? (curQ?.deposit_value === null || curQ?.deposit_value === undefined ? null : Number(curQ.deposit_value)) : n(h.deposit_value);
      const value = mode === "none" ? null : raw === null ? null : Math.max(0, mode === "aed" ? raw : Math.min(100, raw));
      Object.assign(patch, { deposit_mode: mode, deposit_value: value, deposit_set_by: staff.id, deposit_set_at: new Date().toISOString(), ...(mode !== "none" ? { deposit_skipped_at: null, deposit_skipped_by: null } : {}) });
      if (h.deposit_mode !== undefined && h.deposit_mode !== curQ?.deposit_mode) await logQuoteEvent(q.id, q.job_id, staff.id, "deposit_set", `${curQ?.number ?? ""} v${curQ?.version ?? ""}: deposit ${mode === "none" ? "switched off" : mode === "aed" ? `AED ${value ?? 0}` : `${value ?? 0}% of ${mode === "percent_parts" ? "parts" : "total"}`} by ${staff.display_name}`);
    }
    // What the discount comes off: our labour only (default), or labour and our own services as well.
    if (h.discount_scope !== undefined) patch.discount_scope = h.discount_scope === "labour_services" ? "labour_services" : "labour";
    // Commission goes through saveCommission in quotes/actions.ts (the owner's approval), never through this route.
    if (h.materials_cost_aed !== undefined) patch.materials_cost_aed = Math.max(0, n(h.materials_cost_aed) ?? 0);
    if (h.customer_note !== undefined) {
      const note = h.customer_note ? String(h.customer_note).trim() : "";
      if (note.length > LINE_TEXT_MAX) return NextResponse.json({ error: tooLongWords(note.length) }, { status: 400 });
      patch.customer_note = note || null;
    }
    if (h.validity_days !== undefined) patch.validity_days = Math.max(1, Math.round(n(h.validity_days) ?? 7));
    if (h.payment_by_card !== undefined) patch.payment_by_card = !!h.payment_by_card;
    if (h.film_rolls_est !== undefined) {
      // Section 7: the film rolls for THIS job's package estimate - the owner's call.
      if (!isOwner) return NextResponse.json({ error: "Only the owner changes the film rolls for a job." }, { status: 403 });
      const rolls = h.film_rolls_est === null || h.film_rolls_est === "" ? null : Math.min(9, Math.max(0.5, Number(h.film_rolls_est) || 0));
      patch.film_rolls_est = rolls;
    }
    if (h.expected_payment_method !== undefined) {
      const m = String(h.expected_payment_method);
      if (!["card", "link", "cash", "cheque", "transfer", "not_sure"].includes(m)) return NextResponse.json({ error: "Choose how the customer will pay." }, { status: 400 });
      patch.expected_payment_method = m;
    }
    const { error } = await admin.from("quotations").update(patch).eq("id", q.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await refreshed();
    if (ownerDiscountWhilePending) {
      // The owner changed the discount on a quotation waiting for him: his discount is no longer a reason. Whatever
      // else is left (a large total, a line discount) stays in his box; with nothing left it goes back to the advisor.
      const b = await loadQuotation(q.id);
      if (b) {
        const left = approvalReasonsNow(b, settings, true);
        if (left.length) await admin.from("quotations").update({ owner_approval_reason: left.join("; "), updated_by: staff.id }).eq("id", q.id);
        else {
          await admin.from("quotations").update({ status: "draft", owner_approval_reason: null, updated_by: staff.id }).eq("id", q.id);
          await logQuoteEvent(q.id, b.quotation.job_id, staff.id, "quote_owner_approved", `${b.quotation.number} v${b.quotation.version}: the owner set the discount himself; nothing else needs his approval`);
          const to = [...new Set([b.quotation.created_by, ...(b.quotation.job_id ? await advisorsInCharge(b.quotation.job_id) : [])].filter((x): x is string => !!x && x !== staff.id))];
          if (to.length) await notifyStaff(to, { type: "quote_owner_approval", title: `Owner set the discount on ${b.quotation.number}: complete and send it`, body: "", jobId: b.quotation.job_id, href: b.quotation.job_id ? `/jobs/${b.quotation.job_id}/quote/${q.id}` : `/estimates/${q.id}` });
        }
      }
    }
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
}
