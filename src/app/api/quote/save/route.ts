import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { LINE_TYPES, round2, type LineType } from "@/lib/quotes";
import { labourRateFor, minMarkupFor, refreshQuoteTotals } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

type LinePatch = { line_type?: string; title?: string; details?: string | null; group_label?: string | null; quantity?: number | string; unit_cost?: number | string | null; markup_percent?: number | string | null; unit_price?: number | string | null; hours?: number | string | null; discount_percent?: number | string; package_id?: string | null };
type Body = {
  quotationId?: string;
  addLine?: LinePatch & { afterId?: string | null };
  patchLine?: { id: string } & LinePatch;
  removeLine?: { id: string };
  reorder?: { ids: string[] };
  header?: { discount_percent?: number | string; promised_at?: string | null; customer_note?: string | null; validity_days?: number | string };
};

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : null;
};

/** Saves one change to a quotation as the advisor types. Every change is kept at once; nothing typed is lost. */
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
  if (!can(role, "editQuotes")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, kind, job_id, status, created_by, vehicle_id").eq("id", String(body.quotationId ?? "")).maybeSingle();
  if (!q) return NextResponse.json({ error: "Quotation not found." }, { status: 404 });
  if (role !== "owner" && q.created_by !== staff.id) {
    const { data: job } = q.job_id ? await admin.from("jobs").select("gated_in_by").eq("id", q.job_id).maybeSingle() : { data: null };
    const { data: appr } = q.job_id ? await admin.from("approval_requests").select("id").eq("job_id", q.job_id).eq("sent_by", staff.id).limit(1) : { data: [] };
    if (job?.gated_in_by !== staff.id && !(appr ?? []).length) return NextResponse.json({ error: "This is another advisor's quotation." }, { status: 403 });
  }
  if (q.status !== "draft" && q.status !== "pending_owner") return NextResponse.json({ error: "This version has been sent. Revise it to make changes." }, { status: 423 });
  const settings = await getSettings();
  const { data: vehicle } = q.vehicle_id ? await admin.from("vehicles").select("make:vehicle_makes(name)").eq("id", q.vehicle_id).maybeSingle() : { data: null };
  const minMarkup = minMarkupFor(settings, (vehicle?.make as unknown as { name: string } | null)?.name ?? null);
  const stamp = { updated_by: staff.id };

  const cleanPatch = (p: LinePatch, current?: { line_type: string }): Record<string, unknown> | string => {
    const out: Record<string, unknown> = {};
    const type = (p.line_type ?? current?.line_type) as LineType | undefined;
    if (p.line_type !== undefined) {
      if (!LINE_TYPES.some((t) => t.value === p.line_type)) return "Bad line type.";
      out.line_type = p.line_type;
    }
    if (p.title !== undefined) {
      const t = String(p.title).trim().slice(0, 200);
      if (!t) return "The line needs a name.";
      out.title = t;
    }
    if (p.details !== undefined) out.details = p.details ? String(p.details).trim().slice(0, 1000) : null;
    if (p.group_label !== undefined) out.group_label = p.group_label ? String(p.group_label).trim().slice(0, 200) : null;
    if (p.quantity !== undefined) out.quantity = Math.max(0.01, n(p.quantity) ?? 1);
    if (p.unit_cost !== undefined) out.unit_cost = n(p.unit_cost);
    if (p.unit_price !== undefined) out.unit_price = n(p.unit_price);
    if (p.hours !== undefined) out.hours = n(p.hours);
    if (p.markup_percent !== undefined) {
      const m = n(p.markup_percent);
      if (type === "part" && m !== null && m < minMarkup) return `The markup cannot be below the minimum of ${minMarkup}% for this make.`;
      out.markup_percent = m;
    }
    if (p.discount_percent !== undefined) out.discount_percent = Math.min(100, Math.max(0, n(p.discount_percent) ?? 0));
    if (p.package_id !== undefined) out.package_id = p.package_id || null;
    return out;
  };

  if (body.addLine) {
    const patch = cleanPatch({ title: "New line", ...body.addLine });
    if (typeof patch === "string") return NextResponse.json({ error: patch }, { status: 400 });
    const { data: last } = await admin.from("quotation_lines").select("position").eq("quotation_id", q.id).eq("is_active", true).order("position", { ascending: false }).limit(1).maybeSingle();
    const type = (patch.line_type as LineType | undefined) ?? "labour";
    const { data: job } = q.job_id ? await admin.from("jobs").select("department").eq("id", q.job_id).maybeSingle() : { data: null };
    const row: Record<string, unknown> = { quotation_id: q.id, position: (Number(last?.position) || 0) + 1, line_type: type, source_type: patch.package_id ? "package" : "manual", created_by: staff.id, ...stamp, ...patch };
    if (type === "labour" && row.labour_rate === undefined) row.labour_rate = labourRateFor(settings, job?.department ?? null);
    if (type === "part" && row.markup_percent === undefined) row.markup_percent = minMarkup;
    if (patch.package_id) {
      const { data: pkg } = await admin.from("packages").select("name, price_aed, description").eq("id", String(patch.package_id)).maybeSingle();
      if (pkg) Object.assign(row, { title: pkg.name, unit_price: Number(pkg.price_aed), details: pkg.description ?? null, line_type: "package" });
    }
    const { data: created, error } = await admin.from("quotation_lines").insert(row).select("id").single();
    if (error || !created) return NextResponse.json({ error: error?.message ?? "Could not add the line." }, { status: 500 });
    await refreshQuoteTotals(q.id, settings, staff.id);
    return NextResponse.json({ ok: true, id: created.id });
  }
  if (body.patchLine) {
    const { data: cur } = await admin.from("quotation_lines").select("id, line_type, part_item_id").eq("id", body.patchLine.id).eq("quotation_id", q.id).maybeSingle();
    if (!cur) return NextResponse.json({ error: "Line not found." }, { status: 404 });
    const patch = cleanPatch(body.patchLine, cur);
    if (typeof patch === "string") return NextResponse.json({ error: patch }, { status: 400 });
    if (cur.part_item_id && "unit_cost" in patch) delete patch.unit_cost; // The cost of a listed part comes from Parts.
    const { error } = await admin.from("quotation_lines").update({ ...patch, ...stamp }).eq("id", cur.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await refreshQuoteTotals(q.id, settings, staff.id);
    return NextResponse.json({ ok: true });
  }
  if (body.removeLine) {
    const { error } = await admin.from("quotation_lines").update({ is_active: false, ...stamp }).eq("id", body.removeLine.id).eq("quotation_id", q.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await refreshQuoteTotals(q.id, settings, staff.id);
    return NextResponse.json({ ok: true });
  }
  if (body.reorder) {
    let position = 0;
    for (const id of body.reorder.ids) await admin.from("quotation_lines").update({ position: position++, ...stamp }).eq("id", id).eq("quotation_id", q.id);
    return NextResponse.json({ ok: true });
  }
  if (body.header) {
    const h = body.header;
    const patch: Record<string, unknown> = { ...stamp };
    if (h.discount_percent !== undefined) patch.discount_percent = Math.min(100, Math.max(0, n(h.discount_percent) ?? 0));
    if (h.promised_at !== undefined) patch.promised_at = h.promised_at && /^\d{4}-\d{2}-\d{2}$/.test(h.promised_at) ? h.promised_at : null;
    if (h.customer_note !== undefined) patch.customer_note = h.customer_note ? String(h.customer_note).trim().slice(0, 2000) : null;
    if (h.validity_days !== undefined) patch.validity_days = Math.max(1, Math.round(n(h.validity_days) ?? 7));
    const { error } = await admin.from("quotations").update(patch).eq("id", q.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await refreshQuoteTotals(q.id, settings, staff.id);
    return NextResponse.json({ ok: true, rounded: round2(0) });
  }
  return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
}
