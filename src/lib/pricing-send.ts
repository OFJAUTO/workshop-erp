import "server-only";
import { formatDateTime } from "./format";
import type { FormState } from "./form-state";
import { jobAdvisorIds, notifyStaff } from "./notifications";
import { loadPricingRows } from "./parts-pricing";
import { rowMissing } from "./parts-rows";
import { awaitingSend, pricingDoneBody, pricingDoneTitle, pricingProgress, pricingSent } from "./pricing-done";
import { createAdminClient } from "./supabase/admin";

/*
 * THE send of a job's prices to the advisor (section 10, 3 November 2026; moved out of parts/actions.ts by the review
 * of the same day so the customer's approval and the hourly clean-up can send what was held). "Pricing done – send to
 * advisor" and the release below both come here, so the advisor always gets the same ONE notification.
 */

/** The job events folded into the one notification: what Parts changed while pricing (instead of one notice each). */
export const FOLDED_EVENTS = ["parts_quantity", "parts_unavailable", "part_removed", "parts_split", "parts_request_closed", "parts_price_changed"];

type SendJob = { id: string; job_number: string; status: string; is_open: boolean; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null };
const JOB_SELECT = "id, job_number, status, is_open, parts_pricing_done_at, parts_pricing_reopened_at";

/**
 * Send the job's prices: ONE notification to the advisors in charge ("All parts priced on J-00970", "Prices updated on
 * …" after Edit, "Parts changes on …" when it goes out by itself), with what changed while pricing folded in, a
 * quotation already with the customer pointed out and a new version the changes made opened to send. The car leaves the
 * parts desk's list (lines still open stay under To price). With a line not priced yet nothing is sent unless `force`
 * ("Send what you have"). Sent already and nothing changed: nothing is sent again (a second tap, an old tab). Opened
 * again (Edit) and nothing changed: closed without a message.
 */
export async function sendJobPricing(jobId: string, a: { by: { id: string | null; display_name: string }; force: boolean; auto?: boolean }): Promise<FormState> {
  const admin = createAdminClient();
  const { data } = await admin.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  const job = data as SendJob | null;
  if (!job || !job.is_open) return { error: "This job is closed." };
  if (pricingSent(job)) return { success: `Already sent to the advisor ${formatDateTime(job.parts_pricing_done_at!)}. Nothing changed since.` };
  // The same rows and the same state function as the table on the screen (src/lib/parts-pricing.ts): Priced, Not
  // available and Removed never hold anything; only Not finished and Waiting for owner approval do.
  const { rows, summary } = await loadPricingRows(jobId);
  const progress = pricingProgress(rows.map((r) => ({ key: r.key, name: r.name, state: r.state, missing: rowMissing(r.values).map((m) => m.long) })));
  if (!rows.length) return { error: "There are no parts on this car to send." };
  if (progress.open && !a.force && !a.auto) {
    const first = progress.openLines.slice(0, 3).map((l) => `${l.name.toUpperCase()}${l.missing.length ? ` (${l.missing.join(", ")})` : l.state === "waiting_approval" ? " (waiting for the owner's approval)" : ""}`).join("; ");
    return { error: `${progress.open} part${progress.open === 1 ? " is" : "s are"} not priced yet: ${first}${progress.open > 3 ? "; and more" : ""}. Finish ${progress.open === 1 ? "it" : "them"}, or choose Send what you have.` };
  }
  const since = job.parts_pricing_done_at ?? null;
  // "Send updated prices": sent before and opened again since (Edit, a new part).
  const again = !!since && !!job.parts_pricing_reopened_at;
  // What changed while pricing, in the words already on the job's history (folded in, never sent one by one).
  let eq = admin.from("job_events").select("note, event_type, created_at").eq("job_id", jobId).in("event_type", FOLDED_EVENTS).order("created_at", { ascending: false }).limit(20);
  if (since) eq = eq.gt("created_at", since);
  const { data: evs } = await eq;
  const changes = ((evs ?? []) as { note: string | null }[]).map((e) => String(e.note ?? "").trim()).filter(Boolean).reverse();
  const { data: qs } = await admin.from("quotations").select("id, number, version, status, created_at").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).order("version", { ascending: false });
  const quotes = (qs ?? []) as { id: string; number: string; version: number; status: string; created_at: string }[];
  const sentQuotes = quotes.filter((q) => ["sent", "opened", "approved", "urgent_requested", "pending_owner"].includes(q.status)).map((q) => q.number);
  // A new version the changes made (Parts changed prices after the quotation went out): the notification opens it to send.
  const revised = quotes.find((q) => q.status === "draft" && Number(q.version) > 1 && (!since || q.created_at > since)) ?? null;
  // A part priced (or priced again) since the last send: the send has something new to say.
  const { data: newer } = since ? await admin.from("part_items").select("id").eq("job_id", jobId).eq("is_active", true).gt("priced_at", since).limit(1) : { data: [] as { id: string }[] };
  const pricedSince = (newer ?? []).length > 0;
  const now = new Date().toISOString();
  const { data: stamped } = await admin.from("jobs").update({ parts_pricing_done_at: now, parts_pricing_done_by: a.by.id, parts_pricing_reopened_at: null, parts_pricing_reopened_by: null, ...(a.by.id ? { updated_by: a.by.id } : {}) }).eq("id", jobId).select("id");
  if (!(stamped ?? []).length) return { error: "Could not save. Try again." };
  // Opened again and nothing changed: closed without telling the advisor anything new.
  if (again && !changes.length && !revised && !pricedSince) {
    await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_pricing_done", note: `Pricing closed again by ${a.by.display_name}: nothing changed since it was sent ${formatDateTime(since!)}`, created_by: a.by.id });
    return { success: `Nothing changed since you sent it ${formatDateTime(since!)}: the advisor already has these prices.` };
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_pricing_done", note: `${a.auto ? "Held parts changes sent by themselves at the customer's approval" : again ? "Updated prices sent" : "Pricing done"} by ${a.by.display_name}: ${progress.words}${progress.detail ? ` (${progress.detail})` : ""} (${summary.text})`, created_by: a.by.id });
  const ids = await jobAdvisorIds(jobId);
  const title = pricingDoneTitle(job.job_number, progress, again, !!a.auto);
  await notifyStaff(ids, { type: "parts_priced", title, body: pricingDoneBody({ by: a.by.display_name, p: progress, changes, sentQuotes: Array.from(new Set(sentQuotes)), revised: revised ? `${revised.number} version ${revised.version}` : null, auto: !!a.auto }), jobId, href: revised ? `/jobs/${jobId}/quote/${revised.id}?send=1` : `/jobs/${jobId}` });
  const { data: people } = ids.length ? await admin.from("staff").select("display_name").in("id", ids) : { data: [] as { display_name: string }[] };
  const names = (people ?? []).map((p) => p.display_name as string);
  return { success: `${title} – sent to ${names.length ? names.join(", ") : "the advisor"}.` };
}

/**
 * The customer approved (or the car otherwise left the pricing phase) while changes were still held for a send nobody
 * pressed: they go to the advisor now, by themselves, in the same ONE notification, so a held notice is never lost
 * (review of 3 November 2026). Nothing happens while a send is still expected (the bar and the lists ask for it).
 */
export async function releaseHeldPricing(jobId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  const job = data as SendJob | null;
  if (!job || !job.is_open || !job.parts_pricing_reopened_at || awaitingSend(job)) return false;
  const r = await sendJobPricing(jobId, { by: { id: null, display_name: "the parts desk" }, force: true, auto: true });
  if (r.error) {
    // Nothing on the car to send (every row gone): the mark is cleared so it is not tried again.
    await admin.from("jobs").update({ parts_pricing_reopened_at: null, parts_pricing_reopened_by: null }).eq("id", jobId).not("parts_pricing_reopened_at", "is", null);
  }
  return !r.error;
}

/** The hourly safety net (cron step 28): every open car in planning with changes still held is released. */
export async function releaseHeldPricingHourly(): Promise<number> {
  const { data } = await createAdminClient().from("jobs").select("id").eq("is_open", true).in("status", ["approved", "waiting_parts"]).not("parts_pricing_reopened_at", "is", null).limit(200);
  let n = 0;
  for (const j of (data ?? []) as { id: string }[]) if (await releaseHeldPricing(j.id)) n++;
  return n;
}
