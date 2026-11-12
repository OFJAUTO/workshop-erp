"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { approveWaitingNow, loadAutoConfig, saveAutoConfig, dubaiToday } from "@/lib/auto-approve";
import { AUTO_TYPES, isActive } from "@/lib/auto-approve-rules";

export type AutoAnswer = { ok?: boolean; error?: string; message?: string } | null;

/**
 * The owner's auto-approve switches (12 November 2026). Server side: only the owner himself (never View as or Act as)
 * may change them. Saving while ON approves the ticked types already waiting, the same way.
 */
export async function saveAutoApproveAction(_prev: AutoAnswer, formData: FormData): Promise<AutoAnswer> {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs || staff.actingAs) return { error: "Only the owner, signed in as himself, changes auto-approve." };
  const cfg = await loadAutoConfig();
  const on = formData.get("master") === "on";
  const until = String(formData.get("until") ?? "").trim();
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: "The end date is not a date." };
  if (on && until && until < dubaiToday()) return { error: "The end date has already passed: pick a later day, or leave it empty." };
  for (const t of AUTO_TYPES) {
    const raw = String(formData.get(`limit_${t.key}`) ?? "").replace(/,/g, "").trim();
    const limit = raw === "" ? null : Number(raw);
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return { error: `The cost limit for "${t.label}" is not a number (leave it empty for no limit).` };
    cfg.types[t.key] = { on: formData.get(`type_${t.key}`) === "on", limit };
  }
  cfg.on = on;
  cfg.until = until || null;
  const err = await saveAutoConfig(cfg, staff);
  if (err) return { error: err };
  let approved = 0;
  if (isActive(cfg, dubaiToday())) approved = await approveWaitingNow(await getSettings());
  revalidatePath("/settings/approvals");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: on
      ? `Auto-approve is ON${cfg.until ? ` until ${cfg.until}` : ""}.${approved ? ` ${approved} waiting request${approved === 1 ? " was" : "s were"} approved now.` : ""}`
      : "Auto-approve is OFF: everything comes to you again. Nothing already approved was undone.",
  };
}
