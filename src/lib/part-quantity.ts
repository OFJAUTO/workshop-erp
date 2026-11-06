import { dbWords } from "@/lib/app-errors";
import "server-only";
import { jobAdvisorIds, notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { askerOfRequest, checkQuantity, cleanUnit, qtyWithUnit, quantityChangeWords, whoOfRole, type PartUnit, type QtyWho } from "./part-units";
import { holdForSend } from "./parts-pricing";
import { partUnitsReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";

/*
 * THE quantity rule on the server (section 9, 3 November 2026). Who may change a part's quantity and unit, the one
 * check (checkQuantity: above zero, pieces and sets whole), the one wording ("Advisor asked 1, Parts changed to 8 L")
 * and who is told. Used by the Parts table's save (a job's parts), the estimate desk's save (an estimate's parts) and
 * the quotation editor (the advisor changes a job part's quantity, which used to be dropped silently).
 */

export type QtyStaff = { id: string; display_name: string; role_id: string };

/**
 * Who asked for a job part (THE rule is askerOfRequest in part-units.ts): a request from the inspection or from the
 * technician's additional work is the technician's - whoever approved it onto the list -, any other request its
 * maker's (the advisor's "+ Add a part", Parts), a part with no request whoever added it.
 */
export async function askerOfPart(p: { part_request_id: string | null; added_by_role?: string | null; quantity_changed_by?: string | null }): Promise<QtyWho> {
  const admin = createAdminClient();
  if (!p.part_request_id) return askerOfRequest(null, null, p.added_by_role);
  const { data: req } = await admin.from("part_requests").select("created_by, inspection_id, source_key").eq("id", p.part_request_id).maybeSingle();
  if (!req) return "technician";
  const { data: who } = req.created_by && !req.inspection_id ? await admin.from("staff").select("role_id").eq("id", req.created_by).maybeSingle() : { data: null };
  return askerOfRequest(req as { inspection_id: string | null; source_key: string | null }, (who?.role_id as string | undefined) ?? null);
}

type JobForQty = { id: string; job_number: string; department: string | null; status: string; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null };

/**
 * A job part's quantity changed: written on the job's history in the one wording, and told. A change by Parts goes to
 * the advisors in charge (held back while a send is expected: the "Pricing done – send to advisor" notification folds
 * it in) and to the department's manager; a change by the advisor or the owner goes to Parts.
 */
export async function logPartQuantity(job: JobForQty, a: { name: string; asked: number; askedBy: QtyWho; askedUnit?: PartUnit | null; now: number; unit: PartUnit | null; by: QtyStaff; /** desk = the Parts table; quotation = the advisor or the owner on the quotation. */ from: "desk" | "quotation" }): Promise<string> {
  const changedBy = whoOfRole(a.by.role_id);
  const words = `${a.name.toUpperCase()}: ${quantityChangeWords({ askedBy: a.askedBy, asked: a.asked, askedUnit: a.askedUnit, changedBy, now: a.now, unit: a.unit })}`;
  const admin = createAdminClient();
  await admin.from("job_events").insert({ job_id: job.id, event_type: "parts_quantity", note: `${words} (${a.by.display_name})`, created_by: a.by.id });
  if (a.from === "desk") {
    const n = { type: "parts_priced", title: `Parts changed a quantity · ${job.job_number}`, body: `${words}.`, jobId: job.id, href: `/parts/${job.id}` };
    if (!(await holdForSend(job, a.by.id))) await notifyStaff(await jobAdvisorIds(job.id), { ...n, href: `/jobs/${job.id}` });
    await notifyManagers(job.department ?? null, n);
  } else {
    await notifyRoles(["parts"], { type: "parts_request", title: `Quantity changed · ${job.job_number}`, body: `${words} (${a.by.display_name}).`, jobId: job.id, href: `/parts/${job.id}` });
  }
  return words;
}

/**
 * The advisor (or the owner) changes a job part's quantity or unit from the quotation (3 November 2026: the editor used
 * to drop it). Refused in words once the part is ordered; otherwise the part takes it (confirmed quantity, unit, who and
 * when), the job's history and Parts are told, and the quotation line follows its part.
 */
export async function setJobPartQuantity(jobId: string, partId: string, input: { qty: number | null; unit?: string | null }, by: QtyStaff): Promise<{ error?: string; changed?: boolean; words?: string }> {
  const admin = createAdminClient();
  const unitsReady = await partUnitsReady();
  const { data: raw } = await admin.from("part_items").select(`id, job_id, description, quantity, confirmed_quantity, order_status, is_active, part_request_id, added_by_role, quantity_changed_by${unitsReady ? ", unit" : ""}`).eq("id", partId).eq("job_id", jobId).maybeSingle();
  const p = raw as unknown as { id: string; description: string; quantity: number | string; confirmed_quantity: number | string | null; order_status: string; is_active: boolean; part_request_id: string | null; added_by_role: string | null; quantity_changed_by: string | null; unit?: string | null } | null;
  if (!p || !p.is_active) return { error: "That part is no longer on the job." };
  const name = String(p.description).toUpperCase();
  if (p.order_status !== "none") return { error: `${name} is already ${p.order_status === "to_order" ? "approved for ordering" : "ordered"}: ask Parts to change the quantity.` };
  const curUnit: PartUnit = cleanUnit(p.unit) ?? "pc";
  const unit: PartUnit = unitsReady && input.unit !== undefined && input.unit !== null ? (cleanUnit(input.unit) ?? curUnit) : curUnit;
  const qty = input.qty ?? (Number(p.confirmed_quantity ?? p.quantity) || 1);
  // Before the units database change every part is in pieces on screen with no unit to choose, so the check is as
  // lenient as the Parts table's and the estimate desk's (6.5 of an oil is accepted, never "change the unit to L").
  const problem = checkQuantity(qty, unitsReady ? unit : "l");
  if (problem) return { error: `${name}: ${problem}` };
  const cur = Number(p.confirmed_quantity ?? p.quantity) || 1;
  if (Math.abs(cur - qty) < 0.005 && unit === curUnit) return { changed: false };
  const now = new Date().toISOString();
  const { error } = await admin.from("part_items").update({ confirmed_quantity: qty, quantity_changed_at: now, quantity_changed_by: by.id, ...(unitsReady ? { unit } : {}), updated_by: by.id }).eq("id", p.id).eq("order_status", "none");
  if (error) return { error: dbWords(error, "lib/part-quantity") };
  // Who set the quantity it had: the last person who changed it, else whoever asked for the part.
  let askedBy: QtyWho = await askerOfPart(p);
  if (p.quantity_changed_by) {
    const { data: who } = await admin.from("staff").select("role_id").eq("id", p.quantity_changed_by).maybeSingle();
    if (who?.role_id) askedBy = whoOfRole(who.role_id as string);
  }
  const { data: job } = await admin.from("jobs").select("id, job_number, department, status, parts_pricing_done_at, parts_pricing_reopened_at").eq("id", jobId).maybeSingle();
  const words = job ? await logPartQuantity(job as JobForQty, { name: p.description, asked: cur, askedBy, askedUnit: curUnit, now: qty, unit, by, from: "quotation" }) : `${name}: ${qtyWithUnit(qty, unit)}`;
  // The quotation line follows its part (the open draft, the quantity and the unit).
  const { syncPartLine } = await import("./quote-versions");
  await syncPartLine(jobId, p.id, by.id);
  return { changed: true, words };
}
