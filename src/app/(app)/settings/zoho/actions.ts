"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZOHO_REAL_ORG_ID, disconnectZoho, mirrorRealIntoTest, zohoLiveNow, zohoTestOrgId } from "@/lib/zoho";
import { goLiveChecklist } from "@/lib/zoho-golive";
import { enqueueBackfill } from "@/lib/zoho-sync";
import { notifyRoles } from "@/lib/notifications";

const back = (kind: "message" | "error", text: string): never => redirect(`/settings/zoho?${kind}=${encodeURIComponent(text)}`);

/** The owner hands the permission back to Zoho and closes the stored token. */
export async function disconnectZohoAction() {
  const staff = await requirePermission("manageSettings");
  if (staff.viewingAs) return back("error", "Viewing only.");
  await disconnectZoho(staff.id);
  return back("message", "Disconnected. Zoho Books no longer accepts the old permission.");
}

/** Picks which organization the sync may write to. Never the real one: that stays read-only until go-live. */
export async function setZohoTestOrg(formData: FormData) {
  const staff = await requirePermission("manageSettings");
  if (staff.viewingAs) return back("error", "Viewing only.");
  const id = String(formData.get("org_id") ?? "").trim();
  const name = String(formData.get("org_name") ?? "").trim();
  if (!/^\d{5,}$/.test(id)) return back("error", "That organization id does not look right.");
  if (id === ZOHO_REAL_ORG_ID) return back("error", "The REAL organization stays read-only until go-live. Pick OFJ TEST.");
  const admin = createAdminClient();
  await admin.from("settings").update({ value: id, updated_by: staff.id }).eq("key", "zoho_org_test");
  return back("message", `Writes now go to ${name || "the test organization"} (${id}). The REAL organization stays read-only.`);
}

/**
 * B4: OFJ TEST mirrors the REAL organization's taxes and chart of accounts (create missing only; REAL untouched).
 * Next's redirect works by throwing, so the redirect sits OUTSIDE the try: a catch around it swallowed the
 * success and showed staff "NEXT_REDIRECT" (26 October 2026).
 */
export async function mirrorZohoAction() {
  const staff = await requirePermission("manageSettings");
  if (staff.viewingAs) return back("error", "Viewing only.");
  let kind: "message" | "error";
  let words: string;
  try {
    const r = await mirrorRealIntoTest();
    const skipped = r.skipped.length ? ` · ${r.skipped.length} skipped: ${r.skipped.slice(0, 3).join("; ").slice(0, 260)}${r.skipped.length > 3 ? "…" : ""}` : "";
    kind = "message";
    words = `Mirrored: ${r.accountsCreated.length} account${r.accountsCreated.length === 1 ? "" : "s"}, ${r.taxesCreated.length} tax${r.taxesCreated.length === 1 ? "" : "es"} – already there: ${r.alreadyThere}${skipped}.`;
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    words = e instanceof Error ? e.message : "The mirror could not run.";
  }
  return back(kind, words);
}

/* ------------------------------------------------- phase 4: go-live ------------------------------------------------- */

/** The owner picks the first day the REAL book owns; anything dated earlier never posts. Fixed once live. */
export async function setGoLiveStartDate(formData: FormData) {
  const staff = await requirePermission("manageSettings");
  if (staff.role_id !== "owner" || staff.viewingAs || staff.actingAs) return back("error", "Only the owner sets the go-live start date.");
  // Once live the start date decides which documents ever reach the REAL book: it is fixed (flip back first).
  if (await zohoLiveNow()) return back("error", "The books are live: the start date is fixed. Flip back to OFJ TEST first if it really must change.");
  const date = String(formData.get("start_date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return back("error", "Pick the go-live start date.");
  const admin = createAdminClient();
  const { error } = await admin.from("settings").update({ value: date, updated_by: staff.id }).eq("key", "zoho_golive_start_date");
  if (error) return back("error", error.message);
  return back("message", `Go-live start date saved: documents from ${date} will post to the REAL book; anything earlier never posts. The switch unlocks on that day.`);
}

/** Appends one line to the go-live history (who, when, what). */
async function logGoLive(entry: Record<string, unknown>, by: string) {
  const admin = createAdminClient();
  const { data: logRow } = await admin.from("settings").select("value").eq("key", "zoho_golive_log").maybeSingle();
  const log = Array.isArray(logRow?.value) ? (logRow!.value as unknown[]) : [];
  await admin.from("settings").update({ value: [...log, entry], updated_by: by }).eq("key", "zoho_golive_log");
}

/** Plain words for what the replay queued. */
function replayWords(r: Awaited<ReturnType<typeof enqueueBackfill>>): string {
  const parts = [
    [r.invoices, "tax invoice"],
    [r.payments + r.deposits, "payment"],
    [r.creditnotes, "credit note"],
    [r.bills, "supplier bill"],
    [r.billpayments, "supplier payment"],
    [r.commissions, "commission"],
    [r.recoveries, "recovery month"],
    [r.vendorcredits, "supplier credit"],
    [r.cnrefunds, "customer refund"],
  ].filter(([n]) => Number(n) > 0) as [number, string][];
  return parts.length ? parts.map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`).join(", ") : "nothing";
}

/**
 * THE SWITCH: writes re-point from OFJ TEST to the REAL organization (942979945), from the start date only.
 * Owner only, "REAL" typed out, and every checklist item freshly green — checked again HERE, not just on screen.
 * The database moves in ONE transaction (zoho_switch_org): OFJ TEST's queue is archived, every stored Zoho id
 * (all of them OFJ TEST's) is cleared, the switch turns on. Then the documents dated from the start date are
 * queued again for the REAL book (the replay); everything earlier stays in OFJ TEST's history.
 */
export async function flipGoLive(formData: FormData) {
  const staff = await requirePermission("manageSettings");
  if (staff.role_id !== "owner" || staff.viewingAs || staff.actingAs) return back("error", "Only the owner flips the go-live switch.");
  if (String(formData.get("confirm") ?? "").trim() !== "REAL") return back("error", 'Type REAL exactly to confirm.');
  if (await zohoLiveNow()) return back("message", "The books are already live on the REAL organization.");
  const checklist = await goLiveChecklist({ checkReal: true });
  const red = checklist.items.filter((i) => !i.ok);
  if (red.length) return back("error", `Not yet: ${red.map((i) => i.label).join("; ")}. Every item must be green first.`);
  const testOrg = await zohoTestOrgId();
  if (!testOrg) return back("error", "OFJ TEST is not picked on this page, so its queue cannot be archived.");
  const admin = createAdminClient();
  const { data: moved, error } = await admin.rpc("zoho_switch_org", { p_from: testOrg, p_to: ZOHO_REAL_ORG_ID, p_live: true, p_by: staff.id });
  if (error) return back("error", `The switch did not happen: ${error.message}`);
  const now = new Date().toISOString();
  let replay = "";
  try {
    replay = replayWords(await enqueueBackfill(staff.id));
  } catch (e) {
    replay = `not queued yet (${e instanceof Error ? e.message : String(e)}) — press Backfill on the sync page`;
  }
  await logGoLive({ action: "live", by: staff.id, name: staff.display_name, at: now, start_date: checklist.startDate, moved, replay }, staff.id);
  await admin.from("audit_log").insert({ table_name: "settings", record_id: "zoho_live_enabled", action: "golive", new_data: { live: true, start_date: checklist.startDate, moved, replay }, changed_by: staff.id }).then(() => null, () => null);
  await notifyRoles(["owner", "accounts"], { type: "zoho_golive", title: "Zoho Books is LIVE on the REAL organization", body: `Flipped by ${staff.display_name}. Documents from ${checklist.startDate} now post to O F J AUTOMOTIVE WORKS LLC; OFJ TEST is closed to writes. Replayed: ${replay}.`, href: "/zoho" }).catch(() => null);
  return back("message", `LIVE. Writes now go to the REAL organization from ${checklist.startDate}; OFJ TEST is closed. Queued for the REAL book: ${replay}.`);
}

/** Flipping back needs the owner and a written reason, and is logged like the flip itself. */
export async function flipGoLiveBack(formData: FormData) {
  const staff = await requirePermission("manageSettings");
  if (staff.role_id !== "owner" || staff.viewingAs || staff.actingAs) return back("error", "Only the owner flips the switch back.");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (reason.length < 5) return back("error", "Write the reason for leaving the REAL book.");
  if (!(await zohoLiveNow())) return back("message", "The books are already on OFJ TEST.");
  const testOrg = await zohoTestOrgId();
  if (!testOrg) return back("error", "OFJ TEST is not picked on this page, so its queue cannot be put back.");
  const admin = createAdminClient();
  // The same move in reverse: the REAL queue is archived, OFJ TEST's own queue and ids come back.
  const { data: moved, error } = await admin.rpc("zoho_switch_org", { p_from: ZOHO_REAL_ORG_ID, p_to: testOrg, p_live: false, p_by: staff.id });
  if (error) return back("error", `The switch did not happen: ${error.message}`);
  const now = new Date().toISOString();
  // Documents made while live join OFJ TEST too (each adopts or posts once), so the test book stays complete.
  let replay = "";
  try {
    replay = replayWords(await enqueueBackfill(staff.id));
  } catch (e) {
    replay = `not queued yet (${e instanceof Error ? e.message : String(e)})`;
  }
  await logGoLive({ action: "back", by: staff.id, name: staff.display_name, at: now, reason, moved, replay }, staff.id);
  await admin.from("audit_log").insert({ table_name: "settings", record_id: "zoho_live_enabled", action: "golive_back", new_data: { live: false, reason, moved }, changed_by: staff.id }).then(() => null, () => null);
  await notifyRoles(["owner", "accounts"], { type: "zoho_golive", title: "Zoho Books went back to OFJ TEST", body: `${staff.display_name}: ${reason}`, href: "/zoho" }).catch(() => null);
  return back("message", "Back on OFJ TEST. The REAL organization is read-only again; what already posted there stays.");
}
