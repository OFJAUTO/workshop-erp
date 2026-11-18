import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError } from "./app-errors";
import { loadApprovals, type ApprovalItem } from "./approvals";
import { notifyRoles } from "./notifications";
import { gmailConfigured, sendGmail } from "./gmail";
import { isTestEnvironment } from "./environment";
import { PRODUCTION_SITE_URL } from "./site";
import { ageOf, dailyReminderDue, dubaiDayOf, reminderTitle, remindAllowed } from "./approval-age";

/*
 * APPROVALS THAT WAIT TOO LONG (18 November 2026, Section 2). One daily email to the owner when anything has waited
 * more than 24 hours (outside the bell: the ERP's own Google Workspace email, no new paid service), and "Remind the
 * owner" for the person who asked, once a day per item. The last send and each item's last reminder are kept in
 * settings (no new table).
 */

const LAST_KEY = "approvals_reminder_last";
const ITEM_KEY = "approval_reminders";

export type ReminderLast = { day: string | null; at: string | null; ok: boolean; words: string; count: number };

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
async function writeSetting(key: string, label: string, value: unknown): Promise<void> {
  const { error } = await createAdminClient().from("settings").upsert({ key, value, label }, { onConflict: "key" });
  if (error) await logAppError(`approval-reminders: ${key}`, error);
}

export async function lastDailyReminder(): Promise<ReminderLast | null> {
  return readSetting<ReminderLast | null>(LAST_KEY, null);
}

/** The owners' sign-in emails (staff.id is the sign-in user). */
async function ownerEmails(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("staff").select("id").eq("role_id", "owner").eq("is_active", true);
  const out: string[] = [];
  for (const s of (data ?? []) as { id: string }[]) {
    const { data: u } = await admin.auth.admin.getUserById(s.id);
    if (u?.user?.email) out.push(u.user.email);
  }
  return out;
}

const fromAddress = async (): Promise<string> => {
  const v = await readSetting<string>("approvals_reminder_from_email", "");
  return String(v || (await readSetting<string>("supplier_lpo_from_email", "")) || "").trim();
};

function listText(items: ApprovalItem[], nowMs: number): string {
  return items
    .slice()
    .sort((a, b) => String(a.askedAt ?? "").localeCompare(String(b.askedAt ?? "")))
    .map((i) => `- ${i.title}${i.money ? ` · ${i.money}` : ""} · waiting ${ageOf(i.askedAt, nowMs)?.words ?? "?"}${i.askedBy ? ` · asked by ${i.askedBy}` : ""}`)
    .join("\n");
}

/** Sends the email; returns plain words for the record (never Google's raw text to a screen). */
async function sendEmail(subject: string, text: string): Promise<{ ok: boolean; words: string }> {
  // The test server never emails anyone (its staff may carry real sign-in addresses).
  if (isTestEnvironment()) return { ok: true, words: "Test server: the email is not sent (it would go to the owner on live)." };
  if (!gmailConfigured()) return { ok: false, words: "Email is not set up: the Google Workspace key is missing in Vercel. The bell still rang." };
  const from = await fromAddress();
  if (!from) return { ok: false, words: "No sending address: set the supplier LPO email in Settings. The bell still rang." };
  const to = await ownerEmails();
  if (!to.length) return { ok: false, words: "The owner's sign-in has no email address. The bell still rang." };
  try {
    for (const addr of to) await sendGmail({ from, fromName: "OFJ ERP", to: addr, subject, text });
    return { ok: true, words: `Email sent to the owner (${to.length}).` };
  } catch (e) {
    await logAppError("approval-reminders: email", e);
    return { ok: false, words: "Google refused to send the email (details in Settings → Problems). The bell still rang." };
  }
}

/** Hourly: the one daily reminder, from 9:00 Dubai, when something has waited more than 24 hours. */
export async function approvalsDailyReminder(nowMs = Date.now(), opts: { force?: boolean } = {}): Promise<ReminderLast | null> {
  const last = await lastDailyReminder();
  if (!opts.force && !dailyReminderDue(last?.day ?? null, nowMs)) return null;
  const items = await loadApprovals();
  const head = reminderTitle(items.map((i) => i.askedAt), nowMs);
  if (!head) return null;
  const link = `${PRODUCTION_SITE_URL}/approvals`;
  const text = `${head.title}\n\nOpen the Approvals page: ${link}\n\n${listText(items, nowMs)}\n\nOFJ ERP – one reminder a day while anything waits more than 24 hours.`;
  await notifyRoles(["owner"], { type: "approvals_waiting", title: head.title, body: "Open Approvals: the oldest first.", href: "/approvals" });
  const sent = await sendEmail(head.title, text);
  const rec: ReminderLast = { day: dubaiDayOf(nowMs), at: new Date(nowMs).toISOString(), ok: sent.ok, words: sent.words, count: head.count };
  await writeSetting(LAST_KEY, "The owner's daily approvals reminder (last send)", rec);
  return rec;
}

/** "Remind the owner" (the person who asked): once a day per item, a bell and an email. */
export async function remindOwner(key: string, by: { id: string; display_name: string }, nowMs = Date.now()): Promise<{ error?: string; words?: string }> {
  const item = (await loadApprovals()).find((i) => i.key === key);
  if (!item) return { error: "Already decided, or no longer waiting." };
  const map = await readSetting<Record<string, string>>(ITEM_KEY, {});
  if (!remindAllowed(map[key] ?? null, nowMs)) return { error: "Already reminded today – the owner gets one reminder a day." };
  const age = ageOf(item.askedAt, nowMs);
  const title = `REMINDER from ${by.display_name}: ${item.title}${age ? ` – waiting ${age.words}` : ""}`;
  await notifyRoles(["owner"], { type: "approvals_waiting", title, body: `${item.what}${item.money ? ` · ${item.money}` : ""}`, jobId: item.jobId, href: `/approvals#approval-${item.key}` });
  const sent = await sendEmail(title, `${title}\n\n${item.what}${item.money ? `\n${item.money}` : ""}\n\nOpen: ${PRODUCTION_SITE_URL}/approvals`);
  const next = { ...map, [key]: dubaiDayOf(nowMs) };
  // Old entries (items decided long ago) drop off after 30 days.
  for (const [k, d] of Object.entries(next)) if (d < dubaiDayOf(nowMs - 30 * 86400000)) delete next[k];
  await writeSetting(ITEM_KEY, "Remind the owner: the last day each approval was reminded", next);
  return { words: `The owner is reminded${sent.ok ? " (bell and email)" : " (bell)"}. Next reminder possible tomorrow.` };
}

/** Which items were reminded today (the button greys out for them). */
export async function remindedToday(nowMs = Date.now()): Promise<Set<string>> {
  const map = await readSetting<Record<string, string>>(ITEM_KEY, {});
  const today = dubaiDayOf(nowMs);
  return new Set(Object.entries(map).filter(([, d]) => d === today).map(([k]) => k));
}
