import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { LINE_TYPES, aed, floorPrice, floorProblem, isHidden, lineTotal, parseHours, round2, type LineType, type QuoteLine } from "@/lib/quotes";
import { LINE_SELECT, SERVICE_SELECT, labourRateFor, minMarkupFor, refreshQuoteTotals, toLine } from "@/lib/quote-data";
import { notifyRoles } from "@/lib/notifications";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

type LinePatch = { line_type?: string; title?: string; details?: string | null; group_label?: string | null; quantity?: number | string; unit_cost?: number | string | null; markup_percent?: number | string | null; unit_price?: number | string | null; hours?: number | string | null; labour_rate?: number | string | null; discount_percent?: number | string; discount_reason?: string | null; visible_to_customer?: boolean; urgency?: string | null; chosen?: boolean; recovery_trips?: number | string | null; recovery_provider?: string | null };
type Body = {
  quotationId?: string;
  addLine?: LinePatch & { service_id?: string | null; dummyPart?: boolean };
  patchLine?: { id: string } & LinePatch;
  removeLine?: { id: string };
  reorder?: { ids: string[] };
  header?: { discount_percent?: number | string; promised_at?: string | null; customer_note?: string | null; validity_days?: number | string; payment_by_card?: boolean };
  /** An advisor's part: description and quantity only; it goes to the Parts desk to be priced. */
  requestPart?: { description: string; quantity?: number | string };
};

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : null;
};

/**
 * Saves one change to a quotation as the advisor types. Every change is kept at once; nothing typed
 * is lost. The rules live here too: advisors cannot discount parts or type part costs, a listed part
 * keeps the name, quantity and cost that Parts gave it (the advisor only sets the markup, never below
 * the minimum), a part's net price never drops below cost plus the minimum markup, hours are one
 * decimal place from 0.1, the automatic bank charge line cannot be touched, and any change after
 * "Quotation complete" reopens the quotation.
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
  const { data: q } = await admin.from("quotations").select("id, kind, job_id, number, status, created_by, vehicle_id").eq("id", String(body.quotationId ?? "")).maybeSingle();
  if (!q) return NextResponse.json({ error: "Quotation not found." }, { status: 404 });
  if (!isOwner && q.created_by !== staff.id) {
    const { data: job } = q.job_id ? await admin.from("jobs").select("gated_in_by").eq("id", q.job_id).maybeSingle() : { data: null };
    const { data: appr } = q.job_id ? await admin.from("approval_requests").select("id").eq("job_id", q.job_id).eq("sent_by", staff.id).limit(1) : { data: [] };
    if (job?.gated_in_by !== staff.id && !(appr ?? []).length) return NextResponse.json({ error: "This is another advisor's quotation." }, { status: 403 });
  }
  if (q.status !== "draft" && q.status !== "pending_owner") return NextResponse.json({ error: "This version has been sent. Revise it to make changes." }, { status: 423 });
  const settings = await getSettings();
  const { data: vehicle } = q.vehicle_id ? await admin.from("vehicles").select("make:vehicle_makes(name)").eq("id", q.vehicle_id).maybeSingle() : { data: null };
  const minMarkup = minMarkupFor(settings, (vehicle?.make as unknown as { name: string } | null)?.name ?? null);
  const { data: job } = q.job_id ? await admin.from("jobs").select("department, job_number").eq("id", q.job_id).maybeSingle() : { data: null };
  const labourRate = labourRateFor(settings, job?.department ?? null, (vehicle?.make as unknown as { name: string } | null)?.name ?? null);
  const stamp = { updated_by: staff.id };
  const refreshed = () => refreshQuoteTotals(q.id, settings, staff.id, { reopen: true });

  const cleanPatch = (p: LinePatch, current: Partial<QuoteLine> | null): Record<string, unknown> | string => {
    const out: Record<string, unknown> = {};
    if (current?.fee_kind) return "The bank charge line is automatic; it cannot be changed.";
    const type = (p.line_type ?? current?.line_type) as LineType | undefined;
    if (p.line_type !== undefined) {
      if (!LINE_TYPES.some((t) => t.value === p.line_type)) return "Bad line type.";
      if (current?.part_item_id) return "A listed part keeps its type.";
      out.line_type = p.line_type;
    }
    if (p.title !== undefined) {
      if (current?.part_item_id && !isOwner) return "A listed part keeps the name Parts gave it. Ask Parts to change it.";
      const t = String(p.title).trim().slice(0, 200);
      if (!t) return "The line needs a name.";
      out.title = t;
    }
    if (p.details !== undefined) out.details = p.details ? String(p.details).trim().slice(0, 1000) : null;
    if (p.group_label !== undefined) out.group_label = p.group_label ? String(p.group_label).trim().slice(0, 200) : null;
    if (p.quantity !== undefined) out.quantity = Math.max(0.01, n(p.quantity) ?? 1);
    if (p.unit_cost !== undefined) {
      if (type === "part" && !isOwner && !current?.advisor_added) return "Only Parts (or the owner) can enter a part's cost. Add the part through the Parts desk.";
      out.unit_cost = n(p.unit_cost);
    }
    if (p.unit_price !== undefined) out.unit_price = n(p.unit_price);
    if (p.hours !== undefined) out.hours = parseHours(p.hours);
    if (p.labour_rate !== undefined) {
      // The advisor can raise the hourly rate, never set it below the standard rate for this car. Only the owner can go lower.
      const rate = n(p.labour_rate);
      if (rate === null || rate < 0) return "Enter the hourly rate.";
      if (!isOwner && rate + 0.005 < labourRate) return `The rate cannot be below the standard rate of AED ${labourRate} per hour for this car. Only the owner can go lower.`;
      out.labour_rate = rate;
    }
    if (p.markup_percent !== undefined) {
      const m = n(p.markup_percent);
      // The markup on a part starts at the minimum and only goes up; the owner may go lower (the floor still applies to the net price).
      if (type === "part" && !isOwner && m !== null && m < minMarkup) return `The markup on a part cannot be below ${minMarkup}%.`;
      out.markup_percent = m;
    }
    if (p.discount_percent !== undefined) {
      const d = Math.min(100, Math.max(0, n(p.discount_percent) ?? 0));
      const costed = (type === "part" || type === "other") && (p.unit_cost !== undefined ? out.unit_cost !== null : current?.unit_cost !== null && current?.unit_cost !== undefined);
      if (costed && d > 0) {
        if (!isOwner) return "Advisors cannot discount a part. Ask the owner.";
        if (!(p.discount_reason ?? current?.discount_reason)) return "Write the reason for the part discount; it is logged.";
      }
      out.discount_percent = d;
    }
    if (p.discount_reason !== undefined) out.discount_reason = p.discount_reason ? String(p.discount_reason).trim().slice(0, 300) : null;
    if (p.visible_to_customer !== undefined) {
      if (type !== "recovery" && type !== "other") return "Only Recovery and Other lines can be hidden from the customer.";
      out.visible_to_customer = !!p.visible_to_customer;
    }
    if (p.urgency !== undefined) {
      if (p.urgency !== null && p.urgency !== "urgent" && p.urgency !== "recommended") return "Mark the line Urgent or Recommended.";
      if (current?.dangerous && p.urgency !== "urgent") return "A dangerous finding is always Urgent.";
      out.urgency = p.urgency;
    }
    if (p.chosen !== undefined) {
      if (!current?.option_group) return "This part has no other option to choose between.";
      out.chosen = !!p.chosen;
    }
    if (p.recovery_trips !== undefined) out.recovery_trips = n(p.recovery_trips);
    if (p.recovery_provider !== undefined) out.recovery_provider = p.recovery_provider ? String(p.recovery_provider).trim().slice(0, 120) : null;
    return out;
  };

  /** After a change, a line with a cost must still clear the floor. */
  const checkFloor = (merged: QuoteLine) => {
    const problem = floorProblem(merged, minMarkup);
    if (problem) return `Blocked: ${problem}. The minimum markup is a floor on the final price, after every discount.`;
    if (merged.unit_cost !== null && merged.unit_cost !== undefined && (merged.line_type === "part" || merged.line_type === "other") && !isHidden(merged) && lineTotal(merged) + 0.005 < round2(merged.unit_cost * (merged.quantity || 1))) return "Blocked: that would sell the part below its cost.";
    return null;
  };

  if (body.requestPart) {
    if (!q.job_id) return NextResponse.json({ error: "An estimate has no job for Parts to price. Type the part as a line instead." }, { status: 400 });
    const description = String(body.requestPart.description ?? "").trim().slice(0, 200);
    if (!description) return NextResponse.json({ error: "Describe the part." }, { status: 400 });
    const qty = Math.max(0.01, n(body.requestPart.quantity) ?? 1);
    const key = `${q.id}:${Date.now()}`;
    const { error } = await admin.from("part_requests").insert({ job_id: q.job_id, source_type: "manual", source_key: key, label: description, requested_text: `Quantity ${qty} · added by ${staff.display_name} on ${q.number}`, quantity: qty, created_by: staff.id, ...stamp });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await notifyRoles(["parts"], { type: "parts_request", title: `Part to price · ${job?.job_number ?? ""}`, body: `${description} × ${qty}, asked by ${staff.display_name} on ${q.number}.`, jobId: q.job_id, href: `/parts/${q.job_id}` });
    await refreshed();
    return NextResponse.json({ ok: true });
  }

  if (body.addLine) {
    const a = body.addLine;
    let type = ((a.line_type as LineType | undefined) ?? "labour") as LineType;
    if (type === "fee" && !isOwner) return NextResponse.json({ error: "Only the owner adds a fee line." }, { status: 403 });
    const row: Record<string, unknown> = { quotation_id: q.id, line_type: type, source_type: "manual", created_by: staff.id, ...stamp, title: String(a.title ?? "New line").trim().slice(0, 200) || "New line", group_label: a.group_label ? String(a.group_label).slice(0, 200) : null };
    // Parts a service asks for; they go to the Parts desk once the line is safely in.
    let linked: { rows: Record<string, unknown>[]; name: string } | null = null;
    if (a.service_id) {
      const { data: svc } = await admin.from("services").select(SERVICE_SELECT).eq("id", String(a.service_id)).maybeSingle();
      if (!svc) return NextResponse.json({ error: "Service not found." }, { status: 404 });
      type = svc.price_aed !== null ? "package" : "labour";
      Object.assign(row, { line_type: type, title: svc.name, details: svc.description ?? null, service_id: svc.id, source_type: "package", unit_price: svc.price_aed !== null ? Number(svc.price_aed) : null, hours: svc.default_hours !== null ? Number(svc.default_hours) : null, labour_rate: labourRate });
      if (q.job_id && Array.isArray(svc.parts_requests) && svc.parts_requests.length) {
        linked = { name: svc.name, rows: (svc.parts_requests as string[]).map((label, i) => ({ job_id: q.job_id, source_type: "manual", source_key: `${svc.id}:${Date.now()}:${i}`, label, requested_text: `For ${svc.name}, added by ${staff.display_name} on ${q.number}`, created_by: staff.id, ...stamp })) };
      }
    } else if (type === "part") {
      if (!isOwner && q.kind === "quotation") {
        // The one "small part" an advisor may add himself, with cost and selling price.
        if (!a.dummyPart) return NextResponse.json({ error: "Parts go through the Parts desk. Use \"Parts price it\" or the one small part allowed per quotation." }, { status: 400 });
        const { data: existing } = await admin.from("quotation_lines").select("id").eq("quotation_id", q.id).eq("is_active", true).eq("advisor_added", true);
        if ((existing ?? []).length >= 1) return NextResponse.json({ error: "One small part per quotation. A second must go through the Parts desk." }, { status: 400 });
        const cost = n(a.unit_cost);
        const price = n(a.unit_price);
        if (cost === null || cost < 1) return NextResponse.json({ error: "The cost must be at least AED 1." }, { status: 400 });
        const qty = Math.max(0.01, n(a.quantity) ?? 1);
        const floor = floorPrice({ unit_cost: cost, quantity: qty }, minMarkup);
        if (price === null || price * qty + 0.005 < floor) return NextResponse.json({ error: `The selling price must be at least cost plus the minimum markup of ${minMarkup}%: ${aed(floor / qty)} each.` }, { status: 400 });
        const markup = round2(((price - cost) / cost) * 100);
        Object.assign(row, { quantity: qty, unit_cost: cost, markup_percent: markup, advisor_added: true });
      } else {
        Object.assign(row, { unit_cost: isOwner ? n(a.unit_cost) : null, markup_percent: n(a.markup_percent) ?? minMarkup, quantity: Math.max(0.01, n(a.quantity) ?? 1) });
      }
    } else {
      const patch = cleanPatch(a, null);
      if (typeof patch === "string") return NextResponse.json({ error: patch }, { status: 400 });
      Object.assign(row, patch);
      if (type === "labour" && row.labour_rate === undefined) row.labour_rate = labourRate;
      if ((type === "other" || type === "recovery") && row.markup_percent === undefined) row.markup_percent = minMarkup;
      if (type === "recovery" && row.recovery_trips === undefined) row.recovery_trips = row.quantity ?? 1;
    }
    const { data: last } = await admin.from("quotation_lines").select("position").eq("quotation_id", q.id).eq("is_active", true).neq("line_type", "fee").order("position", { ascending: false }).limit(1).maybeSingle();
    row.position = (Number(last?.position) || 0) + 1;
    const { data: created, error } = await admin.from("quotation_lines").insert(row).select("id").single();
    if (error || !created) return NextResponse.json({ error: error?.message ?? "Could not add the line." }, { status: 500 });
    if (linked) {
      await admin.from("part_requests").insert(linked.rows);
      await notifyRoles(["parts"], { type: "parts_request", title: `Parts to price · ${job?.job_number ?? ""}`, body: `${linked.rows.map((r) => r.label).join(", ")} for ${linked.name}.`, jobId: q.job_id, href: `/parts/${q.job_id}` });
    }
    if (row.advisor_added) await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: q.job_id, event_type: "advisor_part", note: `${staff.display_name} added a part himself: ${row.title} at ${aed(Number(row.unit_cost))} cost`, created_by: staff.id });
    await refreshed();
    return NextResponse.json({ ok: true, id: created.id });
  }
  if (body.patchLine) {
    const { data: curRaw } = await admin.from("quotation_lines").select(LINE_SELECT).eq("id", body.patchLine.id).eq("quotation_id", q.id).maybeSingle();
    if (!curRaw) return NextResponse.json({ error: "Line not found." }, { status: 404 });
    const cur = toLine(curRaw as Record<string, unknown>);
    const patch = cleanPatch(body.patchLine, cur);
    if (typeof patch === "string") return NextResponse.json({ error: patch }, { status: 400 });
    if (cur.part_item_id && "unit_cost" in patch) delete patch.unit_cost; // The cost of a listed part comes from Parts.
    if (cur.part_item_id && "quantity" in patch) delete patch.quantity; // And its quantity from the technician.
    const merged = { ...cur, ...patch } as QuoteLine;
    const floorError = checkFloor(merged);
    if (floorError) return NextResponse.json({ error: floorError }, { status: 400 });
    if ("labour_rate" in patch && Number(patch.labour_rate) !== Number(cur.labour_rate ?? 0)) {
      await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: q.job_id, event_type: "labour_rate", note: `${staff.display_name} changed the hourly rate on ${cur.title} from AED ${Number(cur.labour_rate ?? 0)} to AED ${Number(patch.labour_rate)} (standard AED ${labourRate})`, created_by: staff.id });
    }
    if ("discount_percent" in patch && (cur.line_type === "part" || (cur.line_type === "other" && cur.unit_cost !== null)) && Number(patch.discount_percent) > 0 && Number(patch.discount_percent) !== Number(cur.discount_percent ?? 0)) {
      await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: q.job_id, event_type: "part_discount", note: `${staff.display_name} gave a ${patch.discount_percent}% discount on ${cur.title}: ${merged.discount_reason ?? ""}`, created_by: staff.id });
    }
    const { error } = await admin.from("quotation_lines").update({ ...patch, ...stamp }).eq("id", cur.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // One option used per group: choosing this one puts the others aside.
    if (patch.chosen === true && cur.option_group) await admin.from("quotation_lines").update({ chosen: false, ...stamp }).eq("quotation_id", q.id).eq("option_group", cur.option_group).neq("id", cur.id);
    await refreshed();
    return NextResponse.json({ ok: true });
  }
  if (body.removeLine) {
    const { data: cur } = await admin.from("quotation_lines").select("id, fee_kind").eq("id", body.removeLine.id).eq("quotation_id", q.id).maybeSingle();
    if (!cur) return NextResponse.json({ error: "Line not found." }, { status: 404 });
    if (cur.fee_kind) return NextResponse.json({ error: "The bank charge line is automatic; it cannot be removed." }, { status: 400 });
    const { error } = await admin.from("quotation_lines").update({ is_active: false, ...stamp }).eq("id", cur.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await refreshed();
    return NextResponse.json({ ok: true });
  }
  if (body.reorder) {
    let position = 0;
    for (const id of body.reorder.ids) await admin.from("quotation_lines").update({ position: position++, ...stamp }).eq("id", id).eq("quotation_id", q.id).is("fee_kind", null);
    return NextResponse.json({ ok: true });
  }
  if (body.header) {
    const h = body.header;
    const patch: Record<string, unknown> = { ...stamp };
    if (h.discount_percent !== undefined) patch.discount_percent = Math.min(100, Math.max(0, n(h.discount_percent) ?? 0));
    if (h.promised_at !== undefined) patch.promised_at = h.promised_at && /^\d{4}-\d{2}-\d{2}$/.test(h.promised_at) ? h.promised_at : null;
    if (h.customer_note !== undefined) patch.customer_note = h.customer_note ? String(h.customer_note).trim().slice(0, 2000) : null;
    if (h.validity_days !== undefined) patch.validity_days = Math.max(1, Math.round(n(h.validity_days) ?? 7));
    if (h.payment_by_card !== undefined) patch.payment_by_card = !!h.payment_by_card;
    const { error } = await admin.from("quotations").update(patch).eq("id", q.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await refreshed();
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
}
