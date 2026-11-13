import "server-only";
import { APPROVAL_KINDS, loadApprovals, type ApprovalItem } from "./approvals";
import type { CurrentStaff } from "./auth";
import { notifyStaff } from "./notifications";
import { STANDIN_KEY, STANDIN_LOG_KEY, readStandIn, standInActive, standInMay, standInNotice, summaryWords, type StandIn, type StandInLogRow } from "./standin-rules";
import { createAdminClient } from "./supabase/admin";

/**
 * APPROVALS STAND-IN, server side (13 November 2026, Section 15): the stored choice (a settings row), the one-tap end,
 * the decisions log, what the stand-in may decide, and the hourly step (the stand-in's "n waiting" bell, the owner's
 * one daily summary). The decisions themselves run through THE one decision door (approvals/actions.ts).
 */
export const dubaiToday = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

export async function loadStandIn(): Promise<StandIn> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", STANDIN_KEY).abortSignal(new AbortController().signal).maybeSingle();
  return readStandIn(data?.value ?? null, APPROVAL_KINDS);
}

export async function saveStandIn(s: StandIn): Promise<string | null> {
  const { error } = await createAdminClient().from("settings").upsert({ key: STANDIN_KEY, value: s, label: "Approvals stand-in (who approves for the owner, until when, which types)" }, { onConflict: "key" });
  return error ? "Couldn't save – nothing was changed. Try again." : null;
}

/** The team is told once: "Approvals go to Peter until 20 Nov" (the stand-in gets their own words). */
export async function tellTeam(s: StandIn): Promise<void> {
  if (!s.staffId || !s.staffName || !s.until) return;
  const { data } = await createAdminClient().from("staff").select("id, role_id").eq("is_active", true);
  const everyone = ((data ?? []) as { id: string; role_id: string }[]).filter((x) => x.role_id !== "owner" && x.id !== s.staffId).map((x) => x.id);
  await notifyStaff(everyone, { type: "approval_standin", title: standInNotice(s.staffName, s.until), body: "Requests that need the owner's yes go to them (within the limits he set).", href: "/home" });
  await notifyStaff([s.staffId], { type: "approval_standin", title: `You approve for the owner until ${s.until}`, body: "Open Approvals in the menu. You never approve your own requests; anything above your limit still waits for the owner.", href: "/approvals" });
}

/** The active stand-in config when this person is the stand-in today, else null. */
export async function standInFor(staff: { id: string } | null): Promise<StandIn | null> {
  if (!staff) return null;
  const s = await loadStandIn();
  return standInActive(s, dubaiToday()) && s.staffId === staff.id ? s : null;
}

/** The waiting items this stand-in may decide. */
export async function standInItems(s: StandIn, staff: CurrentStaff, items?: ApprovalItem[]): Promise<ApprovalItem[]> {
  const all = items ?? (await loadApprovals());
  const today = dubaiToday();
  return all.filter((i) => standInMay(s, i, staff, today).ok);
}

export async function loadStandInLog(): Promise<StandInLogRow[]> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", STANDIN_LOG_KEY).abortSignal(new AbortController().signal).maybeSingle();
  const v = data?.value as { rows?: StandInLogRow[] } | null;
  return Array.isArray(v?.rows) ? v!.rows! : [];
}

async function saveLog(rows: StandInLogRow[], extra: Record<string, unknown> = {}) {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", STANDIN_LOG_KEY).maybeSingle();
  const was = (data?.value ?? {}) as Record<string, unknown>;
  await createAdminClient().from("settings").upsert({ key: STANDIN_LOG_KEY, value: { ...was, ...extra, rows: rows.slice(-300) }, label: "Approvals stand-in: decisions made on behalf of the owner" }, { onConflict: "key" });
}

/** Every decision the stand-in makes is kept for the owner's daily summary (the item's own history says it too). */
export async function logStandInDecision(by: string, item: ApprovalItem, decision: "approved" | "refused"): Promise<void> {
  const rows = await loadStandInLog();
  rows.push({ at: new Date().toISOString(), by, kind: item.kind, title: item.title, decision, money: item.money });
  await saveLog(rows);
}

/**
 * Hourly (cron): the stand-in hears when more requests wait for them; once a day after 20:00 the owner gets one
 * summary of the day's decisions; after the end date the stand-in simply stops (nothing to switch off).
 */
export async function standInHourly(nowMs = Date.now(), opts: { force?: boolean } = {}): Promise<string | null> {
  const s = await loadStandIn();
  const today = new Date(nowMs + 4 * 3600000).toISOString().slice(0, 10);
  const words: string[] = [];
  const { data } = await createAdminClient().from("settings").select("value").eq("key", STANDIN_LOG_KEY).maybeSingle();
  const state = (data?.value ?? {}) as { rows?: StandInLogRow[]; lastCount?: number; summaryDay?: string };
  const rows = Array.isArray(state.rows) ? state.rows : [];
  if (standInActive(s, today) && s.staffId) {
    const { data: who } = await createAdminClient().from("staff").select("id, display_name, full_name").eq("id", s.staffId).maybeSingle();
    if (who) {
      const items = (await loadApprovals()).filter((i) => standInMay(s, i, who as { id: string; display_name: string; full_name: string | null }, today).ok);
      if (items.length > (state.lastCount ?? 0)) {
        await notifyStaff([s.staffId], { type: "approval_standin", title: `${items.length} approval${items.length === 1 ? "" : "s"} waiting for you (on behalf of the owner)`, body: items.slice(0, 5).map((i) => i.title).join("\n"), href: "/approvals" });
        words.push(`stand-in told: ${items.length} waiting`);
      }
      await saveLog(rows, { lastCount: items.length });
    }
  }
  const hour = new Date(nowMs + 4 * 3600000).getUTCHours();
  if ((hour >= 20 || opts.force) && state.summaryDay !== today) {
    const dayStart = new Date(`${today}T00:00:00+04:00`).toISOString();
    const todays = rows.filter((r) => r.at >= dayStart);
    if (todays.length) {
      const { data: owners } = await createAdminClient().from("staff").select("id").eq("role_id", "owner").eq("is_active", true);
      const name = todays[0].by.replace(/ on behalf of the owner$/, "");
      await notifyStaff((owners ?? []).map((o) => String(o.id)), { type: "approval_standin_summary", title: summaryWords(name, todays), body: todays.slice(0, 10).map((r) => `${r.decision === "approved" ? "Approved" : "Refused"}: ${r.title}${r.money ? ` · ${r.money}` : ""}`).join("\n"), href: "/approvals#stand-in" });
      words.push(summaryWords(name, todays));
    }
    const { data: again } = await createAdminClient().from("settings").select("value").eq("key", STANDIN_LOG_KEY).maybeSingle();
    await createAdminClient().from("settings").upsert({ key: STANDIN_LOG_KEY, value: { ...((again?.value ?? {}) as Record<string, unknown>), summaryDay: today }, label: "Approvals stand-in: decisions made on behalf of the owner" }, { onConflict: "key" });
  }
  return words.length ? words.join(" · ") : null;
}
