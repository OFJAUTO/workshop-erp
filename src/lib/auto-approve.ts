import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError } from "./app-errors";
import { compLinesOf } from "./complimentary";
import { quoteTotals } from "./quotes";
import { compCostForBundle, loadQuotation, approvalReasonsNow, roundingByOwnerOf, type QuoteBundle } from "./quote-data";
import { handBack } from "./quote-lead";
import { notifyStaff } from "./notifications";
import type { Settings } from "./settings";
import { AUTO_EVENT, AUTO_SETTING_KEY, AUTO_WORDS, autoLogNote, costFromNote, freeChargeType, isActive, quoteAutoDecision, readConfig, summaryWords, typeAllows, type AutoConfig } from "./auto-approve-rules";

/**
 * AUTO-APPROVE WHILE THE OWNER IS AWAY (12 November 2026). The switch lives in one settings row (`auto_approve`),
 * read fresh on every request (never the cached settings), and changed by the owner only (settings/approvals). A request
 * of a ticked type is approved where it is asked (sending a quotation, adding a free charge), logged in the job's or the
 * quotation's history as "AUTO-APPROVED (OWNER AWAY)", and never rings the owner's bell. No database change needed.
 */

export const dubaiToday = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

export type Owner = { id: string; display_name: string };

export async function loadAutoConfig(): Promise<AutoConfig> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", AUTO_SETTING_KEY).abortSignal(new AbortController().signal).maybeSingle();
  return readConfig(data?.value ?? null);
}

/** On right now, with the owner the approvals are recorded under (the one who switched it on, else the first owner). */
export async function autoNow(): Promise<{ cfg: AutoConfig; active: boolean; owner: Owner | null }> {
  const cfg = await loadAutoConfig();
  const active = isActive(cfg, dubaiToday());
  if (!active) return { cfg, active, owner: null };
  const admin = createAdminClient();
  const { data } = cfg.setBy
    ? await admin.from("staff").select("id, display_name, role_id").eq("id", cfg.setBy).maybeSingle()
    : await admin.from("staff").select("id, display_name, role_id").eq("role_id", "owner").eq("is_active", true).order("created_at").limit(1).maybeSingle();
  const owner = data && data.role_id === "owner" ? { id: String(data.id), display_name: String(data.display_name) } : null;
  return { cfg, active: !!owner, owner };
}

export async function saveAutoConfig(cfg: AutoConfig, by: { id: string | null }): Promise<string | null> {
  const value = { ...cfg, setBy: by.id ?? cfg.setBy, setAt: new Date().toISOString() };
  const { error } = await createAdminClient().from("settings").upsert({ key: AUTO_SETTING_KEY, value, label: "Auto-approve while the owner is away", updated_by: by.id ?? null, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) {
    logAppError("auto-approve.save", error);
    return "Couldn't save – nothing was changed. Try again.";
  }
  return null;
}

type Asker = { id: string; display_name: string };

/** The figures a quotation's reasons are measured with (the same calculation as the owner's box). */
async function quoteFigures(bundle: QuoteBundle, settings: Settings) {
  const q = bundle.quotation;
  const totals = quoteTotals(bundle.lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const comp = await compCostForBundle(bundle, settings);
  const free = compLinesOf(bundle.lines, q);
  return {
    discount: Math.max(0, Number(totals.discount) || 0),
    roundDown: Math.max(0, -(Number(totals.rounding) || 0)),
    total: Number(totals.total) || 0,
    compCost: comp?.cost.cost ?? 0,
    compReason: (q.comp_reason as string | null | undefined) ?? null,
    compAllRecovery: free.length > 0 && free.every((l) => l.line_type === "recovery"),
  };
}

/**
 * A quotation that needs the owner (sending it, or one already waiting): approved by itself when every reason is a
 * ticked type within its limit. Writes exactly what the owner's Approve writes (owner_approved_*, the complimentary
 * stamp) under the owner's name, and logs who asked and what it costs. True when approved.
 */
export async function tryAutoApproveQuote(bundle: QuoteBundle, reasons: string[], asker: Asker, settings: Settings): Promise<boolean> {
  try {
    const now = await autoNow();
    if (!now.active || !now.owner || !reasons.length) return false;
    const f = await quoteFigures(bundle, settings);
    const d = quoteAutoDecision(now.cfg, reasons, f);
    if (!d.ok) return false;
    const q = bundle.quotation;
    const at = new Date().toISOString();
    const admin = createAdminClient();
    const patch: Record<string, unknown> = { owner_approved_by: now.owner.id, owner_approved_at: at, owner_approval_reason: reasons.join("; "), updated_by: asker.id };
    if (q.status === "pending_owner") patch.status = "draft";
    const { error } = await admin.from("quotations").update(patch).eq("id", q.id);
    if (error) throw error;
    const comp = await compCostForBundle(bundle, settings);
    if (comp && q.comp_reason !== undefined) {
      await admin.from("quotations").update({ comp_status: "approved", comp_decided_by: now.owner.id, comp_decided_at: at, comp_decision_note: AUTO_WORDS, comp_normal_aed: comp.cost.normal, comp_cost_aed: comp.cost.cost, comp_cost_detail: comp.cost.detail || null }).eq("id", q.id);
    }
    const cost = Math.round((f.compCost + (d.types.includes("quote_discount") ? f.discount : 0) + (d.types.includes("quote_roundoff") ? f.roundDown : 0)) * 100) / 100;
    await admin.from("quotation_events").insert({ quotation_id: q.id, job_id: q.job_id ?? null, event_type: AUTO_EVENT, note: autoLogNote(`${q.number} v${q.version} – ${reasons.join("; ")}`, asker.display_name, cost), created_by: asker.id });
    return true;
  } catch (e) {
    logAppError("auto-approve.quote", e, { staffId: asker.id });
    return false;
  }
}

/** A free charge being added: approved by itself when its type is ticked and within its limit. */
export async function autoAllowsFreeCharge(kind: string, cost: number): Promise<boolean> {
  const now = await autoNow();
  return now.active && !!now.owner && typeAllows(now.cfg, freeChargeType(kind), cost);
}

/** The log line of an auto-approved free charge (in the job's history). */
export async function logFreeChargeAuto(jobId: string, line: { description: string; cost_aed: number; kind: string }, asker: Asker): Promise<void> {
  const { error } = await createAdminClient().from("job_events").insert({ job_id: jobId, event_type: AUTO_EVENT, note: autoLogNote(`free ${line.kind} charge – ${line.description}`, asker.display_name, line.cost_aed), created_by: asker.id });
  if (error) logAppError("auto-approve.charge-log", error, { jobId });
}

/**
 * Switched on (or saved while on): requests of ticked types already waiting are approved the same way. Returns how many.
 * A quotation is handed back to its advisor ("approved: send it"), exactly as after the owner's own Approve.
 */
export async function approveWaitingNow(settings: Settings): Promise<number> {
  const now = await autoNow();
  if (!now.active || !now.owner) return 0;
  const admin = createAdminClient();
  let n = 0;
  const { data: waiting } = await admin.from("quotations").select("id, completed_by, created_by").eq("status", "pending_owner").eq("is_active", true);
  for (const w of (waiting ?? []) as { id: string; completed_by: string | null; created_by: string | null }[]) {
    const bundle = await loadQuotation(w.id);
    if (!bundle) continue;
    const q = bundle.quotation;
    const setter = q.discount_set_by ?? null;
    const { data: setterRow } = setter ? await admin.from("staff").select("role_id").eq("id", setter).maybeSingle() : { data: null };
    const reasons = approvalReasonsNow(bundle, settings, { discount: setterRow?.role_id === "owner", rounding: await roundingByOwnerOf(q.id, q.rounded_total_aed !== null && q.rounded_total_aed !== undefined) });
    const askerId = w.completed_by ?? w.created_by;
    const { data: asker } = askerId ? await admin.from("staff").select("id, display_name").eq("id", askerId).maybeSingle() : { data: null };
    const who = asker ? { id: String(asker.id), display_name: String(asker.display_name) } : { id: now.owner.id, display_name: "someone" };
    if (await tryAutoApproveQuote(bundle, reasons, who, settings)) {
      n += 1;
      await handBack(q.id, "approved", now.owner).catch(() => null);
      if (asker) await notifyStaff([String(asker.id)], { type: "quote_owner_approval", title: `${AUTO_WORDS}: ${q.number} – send it`, body: reasons.join("; "), jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}` }).catch(() => null);
    }
  }
  const { data: frees } = await admin.from("charge_lines").select("id, job_id, kind, description, cost_aed, created_by").eq("free_status", "pending_owner").eq("is_active", true).not("job_id", "is", null);
  for (const l of (frees ?? []) as { id: string; job_id: string; kind: string; description: string; cost_aed: number; created_by: string | null }[]) {
    if (!typeAllows(now.cfg, freeChargeType(l.kind), Number(l.cost_aed) || 0)) continue;
    const { data: done } = await admin.from("charge_lines").update({ free_status: "approved", updated_by: now.owner.id }).eq("id", l.id).eq("free_status", "pending_owner").select("id");
    if (!done?.length) continue;
    const { data: asker } = l.created_by ? await admin.from("staff").select("id, display_name").eq("id", l.created_by).maybeSingle() : { data: null };
    await logFreeChargeAuto(l.job_id, { description: l.description, cost_aed: Number(l.cost_aed) || 0, kind: l.kind }, asker ? { id: String(asker.id), display_name: String(asker.display_name) } : { id: now.owner.id, display_name: "someone" });
    n += 1;
  }
  return n;
}

export type AutoRow = { at: string; note: string; cost: number; jobId: string | null; jobNumber: string | null; href: string };

/** Every auto-approval, newest first (the Approvals page's list and the daily summary). */
export async function autoApprovedList(opts: { since?: string; limit?: number } = {}): Promise<AutoRow[]> {
  const admin = createAdminClient();
  const limit = opts.limit ?? 200;
  let qe = admin.from("quotation_events").select("quotation_id, job_id, note, created_at").eq("event_type", AUTO_EVENT).order("created_at", { ascending: false }).limit(limit);
  let je = admin.from("job_events").select("job_id, note, created_at").eq("event_type", AUTO_EVENT).order("created_at", { ascending: false }).limit(limit);
  if (opts.since) {
    qe = qe.gte("created_at", opts.since);
    je = je.gte("created_at", opts.since);
  }
  const [{ data: qr }, { data: jr }] = await Promise.all([qe, je]);
  const jobIds = Array.from(new Set([...(qr ?? []), ...(jr ?? [])].map((r) => r.job_id).filter(Boolean) as string[]));
  const { data: jobs } = jobIds.length ? await admin.from("jobs").select("id, job_number").in("id", jobIds) : { data: [] };
  const num = new Map((jobs ?? []).map((j) => [String(j.id), String(j.job_number)]));
  const rows: AutoRow[] = [
    ...((qr ?? []) as { quotation_id: string; job_id: string | null; note: string; created_at: string }[]).map((r) => ({ at: r.created_at, note: r.note, cost: costFromNote(r.note), jobId: r.job_id, jobNumber: r.job_id ? num.get(r.job_id) ?? null : null, href: r.job_id ? `/jobs/${r.job_id}/quote/${r.quotation_id}` : `/estimates/${r.quotation_id}` })),
    ...((jr ?? []) as { job_id: string; note: string; created_at: string }[]).map((r) => ({ at: r.created_at, note: r.note, cost: costFromNote(r.note), jobId: r.job_id, jobNumber: num.get(r.job_id) ?? null, href: `/jobs/${r.job_id}#charges` })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

const SUMMARY_KEY = "auto_approve_summary_day";

/**
 * Hourly (housekeeping): from 20:00 Dubai, ONE bell to the owner with today's auto-approvals, once a day and only when
 * there were some. Also switches the master switch off once its end date has passed. Returns what it did, in words.
 */
export async function autoApproveHourly(nowMs = Date.now(), opts: { force?: boolean } = {}): Promise<string | null> {
  const admin = createAdminClient();
  const cfg = await loadAutoConfig();
  const today = new Date(nowMs + 4 * 3600000).toISOString().slice(0, 10);
  let words: string[] = [];
  if (cfg.on && cfg.until && today > cfg.until) {
    await saveAutoConfig({ ...cfg, on: false }, { id: null }).catch(() => null);
    words.push("auto-approve switched off (end date passed)");
  }
  const hour = new Date(nowMs + 4 * 3600000).getUTCHours();
  if (hour < 20 && !opts.force) return words.length ? words.join(" · ") : null;
  const { data: sent } = await admin.from("settings").select("value").eq("key", SUMMARY_KEY).maybeSingle();
  if (sent?.value === today && !opts.force) return words.length ? words.join(" · ") : null;
  const dayStart = new Date(`${today}T00:00:00+04:00`).toISOString();
  const rows = await autoApprovedList({ since: dayStart, limit: 500 });
  if (rows.length) {
    const cost = rows.reduce((a, r) => a + r.cost, 0);
    const { data: owners } = await admin.from("staff").select("id").eq("role_id", "owner").eq("is_active", true);
    await notifyStaff((owners ?? []).map((o) => String(o.id)), { type: "auto_approved_summary", title: summaryWords(rows.length, cost), body: rows.slice(0, 8).map((r) => r.note.replace(`${AUTO_WORDS}: `, "")).join("\n"), href: "/approvals#auto-approved" });
    words.push(summaryWords(rows.length, cost));
  }
  await admin.from("settings").upsert({ key: SUMMARY_KEY, value: today, label: "Auto-approve: last daily summary" }, { onConflict: "key" });
  words = words.filter(Boolean);
  return words.length ? words.join(" · ") : null;
}
