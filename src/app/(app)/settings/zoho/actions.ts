"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZOHO_REAL_ORG_ID, disconnectZoho, mirrorRealIntoTest } from "@/lib/zoho";

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
