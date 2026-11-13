"use server";

import { revalidatePath } from "next/cache";
import { APPROVAL_KINDS } from "@/lib/approvals";
import { requireStaff } from "@/lib/auth";
import { dubaiToday, loadStandIn, saveStandIn, tellTeam } from "@/lib/standin";
import { standInActive } from "@/lib/standin-rules";
import { createAdminClient } from "@/lib/supabase/admin";

export type StandInAnswer = { ok?: boolean; error?: string; message?: string } | null;

const ownerOnly = async () => {
  const staff = await requireStaff();
  return staff.role_id === "owner" && !staff.viewingAs && !staff.actingAs ? staff : null;
};

/**
 * "Send my approvals to <person>" (13 November 2026, Section 15). Only the owner, signed in as himself. The team is
 * told once when a new stand-in (or a new end date) starts.
 */
export async function saveStandInAction(_prev: StandInAnswer, formData: FormData): Promise<StandInAnswer> {
  const owner = await ownerOnly();
  if (!owner) return { error: "Only the owner, signed in as himself, sends his approvals to someone." };
  const staffId = String(formData.get("staff_id") ?? "");
  const from = String(formData.get("from") ?? "").trim();
  const until = String(formData.get("until") ?? "").trim();
  const today = dubaiToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: "Pick the start and end dates." };
  if (until < from) return { error: "The end date is before the start date." };
  if (until < today) return { error: "The end date has already passed: pick a later day." };
  const { data: person } = await createAdminClient().from("staff").select("id, display_name, role_id, is_active").eq("id", staffId).maybeSingle();
  if (!person?.is_active || person.role_id === "owner") return { error: "Pick a person who works here (not yourself)." };
  const was = await loadStandIn();
  const next = { ...was, staffId: person.id as string, staffName: person.display_name as string, from, until, setBy: owner.id, setAt: new Date().toISOString(), endedAt: null, types: { ...was.types } };
  let any = false;
  for (const k of APPROVAL_KINDS) {
    const raw = String(formData.get(`limit_${k}`) ?? "").replace(/,/g, "").trim();
    const limit = raw === "" ? null : Number(raw);
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return { error: "A cost limit is not a number (leave it empty for no limit)." };
    const on = formData.get(`type_${k}`) === "on";
    if (on) any = true;
    next.types[k] = { on, limit };
  }
  if (!any) return { error: "Tick at least one type of approval to send to them." };
  const err = await saveStandIn(next);
  if (err) return { error: err };
  const changedWho = !standInActive(was, today) || was.staffId !== next.staffId || was.until !== next.until;
  if (changedWho && from <= today) await tellTeam(next).catch(() => null);
  revalidatePath("/settings/approvals");
  revalidatePath("/approvals");
  return { ok: true, message: `Your approvals go to ${next.staffName} from ${from} until ${until}.${changedWho && from <= today ? " The team was told." : ""}` };
}

/** One tap: the stand-in ends now (logged with the time). */
export async function endStandInAction(): Promise<StandInAnswer> {
  const owner = await ownerOnly();
  if (!owner) return { error: "Only the owner ends it." };
  const was = await loadStandIn();
  if (!was.staffId) return { error: "Nobody is approving for you." };
  const err = await saveStandIn({ ...was, endedAt: new Date().toISOString() });
  if (err) return { error: err };
  revalidatePath("/settings/approvals");
  revalidatePath("/approvals");
  return { ok: true, message: `Ended: your approvals come to you again (${was.staffName} no longer approves).` };
}
