import "server-only";
import { createAdminClient } from "./supabase/admin";
import { notifyStaff } from "./notifications";
import { ownerIds } from "./passkey-server";
import { SUMMARY_HOUR, dubaiClock } from "./password-alert-rules";
import { listLineFacts } from "./quote-list-data";
import { loadQuoteSummaries } from "./quote-data";
import { quoteLeadIds } from "./quote-lead";
import { READY_REMIND_DAYS, readyReminderDue, readyToSend, type ListFacts } from "./quote-list-rules";

/*
 * READY TO SEND FOR 2 DAYS (13 November 2026, Section 6). An estimate or a job's quotation that is ready to send (a draft
 * with something on it, nothing waiting on the parts desk, not waiting for the owner) and untouched for 2 days reminds
 * its advisor in charge, at most every 2 days (logged as a `ready_to_send_reminder` event). Once a day, in the evening,
 * the owner gets one count of them.
 */
type Q = { id: string; number: string; kind: string; status: string; job_id: string | null; created_by: string | null; created_at: string; sent_at: string | null; responded_at: string | null; updated_at: string | null; carried_job_id: string | null; total_aed: number | string | null };

export async function readyToSendWaiting(nowMs = Date.now()): Promise<{ q: Q; facts: ListFacts; last: string | null }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("quotations").select("id, number, kind, status, job_id, created_by, created_at, sent_at, responded_at, updated_at, carried_job_id, total_aed").eq("is_active", true).eq("status", "draft").is("carried_job_id", null).limit(1000);
  let qs = (data ?? []) as Q[];
  const jobIds = Array.from(new Set(qs.map((q) => q.job_id).filter((x): x is string => !!x)));
  if (jobIds.length) {
    const { data: open } = await admin.from("jobs").select("id").in("id", jobIds).eq("is_open", true);
    const openIds = new Set((open ?? []).map((j) => j.id as string));
    qs = qs.filter((q) => !q.job_id || openIds.has(q.job_id));
  }
  if (!qs.length) return [];
  const [facts, summaries, { data: events }] = await Promise.all([
    listLineFacts(qs.map((q) => q.id)),
    loadQuoteSummaries(Array.from(new Set(qs.map((q) => q.job_id).filter((x): x is string => !!x)))),
    admin.from("quotation_events").select("quotation_id, created_at").in("quotation_id", qs.map((q) => q.id)).eq("event_type", "ready_to_send_reminder").order("created_at", { ascending: false }),
  ]);
  const last = new Map<string, string>();
  for (const e of (events ?? []) as { quotation_id: string; created_at: string }[]) if (!last.has(e.quotation_id)) last.set(e.quotation_id, e.created_at);
  return qs
    .map((q) => {
      const lf = facts.get(q.id) ?? { lineCount: 0, withDesk: 0 };
      const s = q.job_id ? summaries.get(q.job_id) : null;
      const f: ListFacts = { status: q.status, carried: false, handback: false, withDesk: q.job_id ? (s?.waitingPrices ?? 0) + (s?.openRequests ?? 0) : lf.withDesk, lineCount: lf.lineCount, total: Number(q.total_aed) || 0, createdAt: q.created_at, sentAt: q.sent_at, respondedAt: q.responded_at, updatedAt: q.updated_at };
      return { q, facts: f, last: last.get(q.id) ?? null };
    })
    .filter((x) => readyToSend(x.facts) && nowMs - Date.parse(x.facts.updatedAt ?? x.facts.createdAt) >= READY_REMIND_DAYS * 86_400_000);
}

/** The hourly step: remind each advisor once per 2 days; the owner's evening count once a day. Returns the reminders sent. */
export async function readyToSendHourly(nowMs = Date.now()): Promise<number> {
  const admin = createAdminClient();
  const waiting = await readyToSendWaiting(nowMs);
  let sent = 0;
  for (const w of waiting) {
    if (!readyReminderDue(w.facts, w.last, nowMs)) continue;
    const leads = await quoteLeadIds({ kind: w.q.kind, number: w.q.number, job_id: w.q.job_id, created_by: w.q.created_by }).catch(() => (w.q.created_by ? [w.q.created_by] : []));
    if (!leads.length) continue;
    const href = w.q.kind === "estimate" ? `/estimates/${w.q.id}` : `/jobs/${w.q.job_id}/quote/${w.q.id}`;
    const days = Math.floor((nowMs - Date.parse(w.facts.updatedAt ?? w.facts.createdAt)) / 86_400_000);
    await notifyStaff(leads, { type: "ready_to_send", title: `Ready to send for ${days} days · ${w.q.number}`, body: `${w.q.number} is ready and has not gone to the customer. Send it, or mark it Not going ahead.`, href });
    await admin.from("quotation_events").insert({ quotation_id: w.q.id, event_type: "ready_to_send_reminder", note: `Ready to send for ${days} days: the advisor was reminded.` });
    sent++;
  }
  // The owner's evening count, once a day.
  const { hour, dayStartIso } = dubaiClock(nowMs);
  if (hour >= SUMMARY_HOUR && waiting.length) {
    const owners = await ownerIds();
    const { count } = owners.length ? await admin.from("notifications").select("id", { count: "exact", head: true }).eq("type", "ready_to_send_count").in("staff_id", owners).gte("created_at", dayStartIso) : { count: 1 };
    if (owners.length && !(count ?? 0)) {
      const est = waiting.filter((w) => w.q.kind === "estimate").length;
      const quo = waiting.length - est;
      const words = [est ? `${est} estimate${est === 1 ? "" : "s"}` : null, quo ? `${quo} quotation${quo === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ");
      await notifyStaff(owners, { type: "ready_to_send_count", title: `${words} ready to send for 2+ days`, body: `Ready, but not sent to the customer: ${waiting.map((w) => w.q.number).slice(0, 12).join(", ")}${waiting.length > 12 ? "…" : ""}. The advisors are reminded.`, href: "/estimates" });
    }
  }
  return sent;
}
