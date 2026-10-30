import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "./auth";
import { createAdminClient } from "./supabase/admin";

/**
 * THE refusal (30 October 2026, batch 2 section 3.4). A page that cannot show what was asked never just says "Not here":
 * it says WHY and offers the next step, and every refusal is written down for the owner (Settings > Refusals).
 * The reasons and their words live in refusal-words.ts (pure, shared with the page).
 */
export type RefusalCode = "missing" | "booking_cancelled" | "car_left" | "no_customer_access" | "no_permission" | "not_on_car" | "estimate_gone";

export async function logRefusal(code: RefusalCode, ctx: { path?: string | null; recordKind?: string | null; recordId?: string | null; detail?: string | null } = {}): Promise<void> {
  try {
    const staff = await getCurrentStaff();
    const h = await headers();
    const path = ctx.path ?? h.get("x-erp-path") ?? null;
    await createAdminClient().from("access_refusals").insert({ staff_id: staff?.id ?? null, role_id: staff?.role_id ?? null, code, path, record_kind: ctx.recordKind ?? null, record_id: ctx.recordId ?? null, detail: ctx.detail ?? null });
  } catch {
    // A refusal is never made worse by a failed note of it.
  }
}

/** Logs the refusal and shows the reason with the next step (`next`: e.g. the car's history page). */
export async function refuse(code: RefusalCode, ctx: { path?: string | null; recordKind?: string | null; recordId?: string | null; detail?: string | null; next?: string | null } = {}): Promise<never> {
  await logRefusal(code, ctx);
  const q = new URLSearchParams({ r: code });
  if (ctx.next) q.set("next", ctx.next);
  if (ctx.detail) q.set("d", ctx.detail.slice(0, 120));
  redirect(`/not-here?${q.toString()}`);
}

/**
 * A page could not load its record for this person: find out why with the master key and refuse with that reason -
 * missing, a cancelled booking, a car that has left (the next step is its history), an estimate no longer open, or no
 * access for this role. ONE place for every page (calendar, job card, quotation, estimate, car, customer, invoice).
 */
export async function refuseRecord(kind: "job" | "booking" | "vehicle" | "customer" | "estimate" | "quotation" | "invoice", id: string): Promise<never> {
  const admin = createAdminClient();
  const staff = await getCurrentStaff();
  const role = staff?.role_id ?? "";
  const base = { recordKind: kind, recordId: id };
  if (kind === "booking") {
    const { data } = await admin.from("appointments").select("is_active, status").eq("id", id).maybeSingle();
    if (!data) return refuse("missing", base);
    if (!data.is_active || data.status === "cancelled") return refuse("booking_cancelled", { ...base, next: "/calendar" });
    return refuse("no_permission", { ...base, detail: "This booking is not available to your role." });
  }
  if (kind === "job") {
    const { data } = await admin.from("jobs").select("is_open, vehicle_id, job_number").eq("id", id).maybeSingle();
    if (!data) return refuse("missing", base);
    if (!data.is_open) return refuse("car_left", { ...base, detail: data.job_number as string, next: data.vehicle_id ? `/vehicles/${data.vehicle_id}` : null });
    return refuse(["technician", "team_leader", "qc_inspector"].includes(role) ? "not_on_car" : "no_permission", { ...base, detail: data.job_number as string, next: "/my-jobs" });
  }
  if (kind === "customer") {
    const { data } = await admin.from("customers").select("id").eq("id", id).maybeSingle();
    if (!data) return refuse("missing", base);
    return refuse("no_customer_access", base);
  }
  if (kind === "estimate" || kind === "quotation") {
    const { data } = await admin.from("quotations").select("kind, number, vehicle_id, deleted_at, carried_job_id, is_active").eq("id", id).maybeSingle();
    if (!data) return refuse("missing", base);
    if (data.deleted_at || !data.is_active || data.carried_job_id) return refuse("estimate_gone", { ...base, detail: data.number as string, next: data.vehicle_id ? `/vehicles/${data.vehicle_id}` : null });
    return refuse("no_permission", { ...base, detail: data.number as string });
  }
  if (kind === "vehicle") {
    const { data } = await admin.from("vehicles").select("id").eq("id", id).maybeSingle();
    return refuse(data ? "no_permission" : "missing", base);
  }
  const { data } = await admin.from("invoices").select("number").eq("id", id).maybeSingle();
  return refuse(data ? "no_permission" : "missing", { ...base, detail: (data?.number as string | undefined) ?? null });
}
