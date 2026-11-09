import "server-only";
import { createAdminClient } from "./supabase/admin";
import { getSettings } from "./settings";
import { notifyRoles, notifyStaff, jobAdvisorIds } from "./notifications";
import { lineUnitPrice, type QuoteLine } from "./quotes";
import { cleanUnit, type PartUnit } from "./part-units";
import { REDUCED_MARK, overpaidWords, reduceLineWords, reducedBy } from "./qty-after-approval-rules";
import { logAppError } from "./app-errors";

/*
 * Section 1 of 9 November 2026: a part's quantity went DOWN after the customer's approval. The advisor's card on the
 * quotation ("Reduce the customer's price to match", the default) makes the next version with the lower quantities and
 * approves it at once, marked "Reduced after approval – no customer approval needed"; the customer gets it by WhatsApp
 * as information. Keeping the old price needs the owner, with a reason (an advisor asks him from the same card).
 * Decisions live in quotation_events (no table): qty_keep_price "[keep:<lineId>:<qty>]" and qty_keep_asked
 * "[ask:<lineId>:<qty>]" on the approved version.
 */

export type ReduceLine = { lineId: string; partId: string; title: string; quoted: number; now: number; unit: PartUnit | null; unitPrice: number; save: number; words: string; asked: boolean };

const LINE_COLS = "id, quotation_id, title, quantity, part_item_id, line_type, unit_cost, markup_percent, markup_mode, markup_aed, unit_price, labour_rate, visible_to_customer, customer_approved, is_active";

type Approved = { id: string; number: string; version: number; job_id: string; token: string | null };

async function approvedQuotes(jobId: string): Promise<Approved[]> {
  const { data } = await createAdminClient().from("quotations").select("id, number, version, job_id, token").eq("job_id", jobId).eq("kind", "quotation").eq("status", "approved").eq("is_active", true);
  return (data ?? []) as Approved[];
}

/** The approved quotation line that charges a part (newest approved version of its number). */
export async function approvedLineOfPart(jobId: string, partId: string): Promise<{ quotationId: string; number: string; lineId: string; quantity: number; unitPrice: number } | null> {
  const quotes = await approvedQuotes(jobId);
  if (!quotes.length) return null;
  const { data } = await createAdminClient().from("quotation_lines").select(LINE_COLS).in("quotation_id", quotes.map((q) => q.id)).eq("part_item_id", partId).eq("is_active", true).limit(1).maybeSingle();
  if (!data) return null;
  const q = quotes.find((x) => x.id === data.quotation_id)!;
  return { quotationId: q.id, number: q.number, lineId: data.id as string, quantity: Number(data.quantity) || 0, unitPrice: lineUnitPrice(data as unknown as QuoteLine) };
}

/** What a credit note for the difference comes to before VAT (the tax invoice's own unit price of the part). */
export async function creditNoteFor(jobId: string, partId: string, was: number, now: number): Promise<number | null> {
  const admin = createAdminClient();
  const { data: inv } = await admin.from("invoices").select("id").eq("job_id", jobId).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).is("deposit_for_quotation_id", null);
  const ids = ((inv ?? []) as { id: string }[]).map((x) => x.id);
  if (!ids.length) return null;
  const { data: l } = await admin.from("invoice_lines").select("amount_aed, quantity").in("invoice_id", ids).eq("part_item_id", partId).eq("is_active", true).limit(1).maybeSingle();
  if (!l) return null;
  const qty = Number(l.quantity) || was;
  const unit = qty ? Number(l.amount_aed) / qty : 0;
  return reducedBy(unit, was, now) || null;
}

const keyOf = (lineId: string, qty: number) => `${lineId}:${qty}`;
const marks = (rows: { note: string | null }[], tag: "keep" | "ask") => new Set(rows.flatMap((r) => Array.from(String(r.note ?? "").matchAll(new RegExp(`\\[${tag}:([0-9a-f-]{36}):([0-9.]+)\\]`, "g"))).map((m) => keyOf(m[1], Number(m[2])))));

/** The lines of one approved quotation whose part now needs fewer than the customer approved, still to decide. */
export async function reduceLinesOf(quotationId: string): Promise<ReduceLine[]> {
  const admin = createAdminClient();
  const { data: lines } = await admin.from("quotation_lines").select(LINE_COLS).eq("quotation_id", quotationId).eq("is_active", true).not("part_item_id", "is", null);
  const rows = (lines ?? []) as unknown as (QuoteLine & { quotation_id: string; part_item_id: string })[];
  if (!rows.length) return [];
  const { data: parts } = await admin.from("part_items").select("id, quantity, confirmed_quantity, is_active, removed_at, disposition, unit").in("id", rows.map((r) => r.part_item_id));
  const byId = new Map(((parts ?? []) as { id: string; quantity: number | string; confirmed_quantity: number | string | null; is_active: boolean; removed_at: string | null; disposition: string | null; unit?: string | null }[]).map((p) => [p.id, p]));
  const { data: ev } = await admin.from("quotation_events").select("note, event_type").eq("quotation_id", quotationId).in("event_type", ["qty_keep_price", "qty_keep_asked"]);
  const evs = (ev ?? []) as { note: string | null; event_type: string }[];
  const kept = marks(evs.filter((e) => e.event_type === "qty_keep_price"), "keep");
  const asked = marks(evs.filter((e) => e.event_type === "qty_keep_asked"), "ask");
  const out: ReduceLine[] = [];
  for (const l of rows) {
    const p = byId.get(l.part_item_id);
    if (!p || !p.is_active || p.removed_at || p.disposition) continue;
    const now = Number(p.confirmed_quantity ?? p.quantity) || 0;
    const quoted = Number(l.quantity) || 0;
    if (!(now > 0) || now >= quoted - 1e-9) continue;
    if (kept.has(keyOf(l.id, now))) continue;
    const unit = cleanUnit(p.unit ?? null);
    const unitPrice = lineUnitPrice(l);
    out.push({ lineId: l.id, partId: l.part_item_id, title: l.title, quoted, now, unit, unitPrice, save: reducedBy(unitPrice, quoted, now), words: reduceLineWords({ title: l.title, quoted, now, unit, unitPrice }), asked: asked.has(keyOf(l.id, now)) });
  }
  return out;
}

/** Every approved quotation of the job with lines to reduce (the job card's and the advisor's waiting list). */
export async function reduceWaitingFor(jobId: string): Promise<{ quotationId: string; number: string; lines: ReduceLine[] }[]> {
  const out: { quotationId: string; number: string; lines: ReduceLine[] }[] = [];
  for (const q of await approvedQuotes(jobId)) {
    const lines = await reduceLinesOf(q.id);
    if (lines.length) out.push({ quotationId: q.id, number: q.number, lines });
  }
  return out;
}

type Actor = { id: string; display_name: string; role_id: string };

/**
 * "Reduce the customer's price to match": the next version with every waiting line at its part's quantity, approved
 * at once (marked REDUCED_MARK), the proforma rebuilt from it with every payment carried, the work order moved to the
 * new lines. When anything else changed since the approval (a part added, a price up), the version stays a draft for
 * the normal send instead: the customer must approve an increase.
 */
export async function reduceAfterApproval(quotationId: string, by: Actor): Promise<{ error?: string; ok?: boolean; newId?: string; words?: string; message?: string; phoneDigits?: string; overpaid?: string | null; draft?: boolean }> {
  if (!["owner", "service_advisor", "parts"].includes(by.role_id)) return { error: "Only the advisor or the owner can reduce the customer's price." };
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, number, version, job_id, status, total_aed, kind").eq("id", quotationId).maybeSingle();
  if (!q || q.status !== "approved" || q.kind !== "quotation" || !q.job_id) return { error: "This quotation is no longer the approved version: open the newest one." };
  const jobId = q.job_id as string;
  const { liveTaxInvoiceOf } = await import("./qty-after-approval");
  const tax = await liveTaxInvoiceOf(jobId);
  if (tax) return { error: `${tax.number} is already issued: give a credit note for the difference instead.` };
  const lines = await reduceLinesOf(quotationId);
  if (!lines.length) return { error: "Nothing to reduce: every part matches the approved quantity." };

  const { createNextVersion } = await import("./quote-versions");
  const made = await createNextVersion(quotationId, { id: by.id, display_name: by.display_name }, { reason: REDUCED_MARK, quietBelow: true });
  if ("error" in made) return { error: made.error };
  const { data: newLines } = await admin.from("quotation_lines").select("id, revised_from_line_id, line_total, fee_kind").eq("quotation_id", made.id).eq("is_active", true);
  const { data: oldLines } = await admin.from("quotation_lines").select("id, line_total, customer_approved").eq("quotation_id", quotationId).eq("is_active", true);
  const old = new Map(((oldLines ?? []) as { id: string; line_total: number | string; customer_approved: boolean | null }[]).map((l) => [l.id, l]));
  const nl = (newLines ?? []) as { id: string; revised_from_line_id: string | null; line_total: number | string; fee_kind: string | null }[];
  const added = nl.filter((l) => !l.revised_from_line_id && !l.fee_kind);
  const raised = nl.filter((l) => l.revised_from_line_id && !l.fee_kind && Number(l.line_total) > Number(old.get(l.revised_from_line_id)?.line_total ?? 0) + 0.004);
  const { data: fresh } = await admin.from("quotations").select("total_aed, token").eq("id", made.id).maybeSingle();
  const newTotal = Number(fresh?.total_aed) || 0;
  if (added.length || raised.length || newTotal > Number(q.total_aed) + 0.004) {
    await admin.from("quotation_events").insert({ quotation_id: made.id, job_id: jobId, event_type: "qty_reduce_draft", note: `${q.number} v${made.version}: other parts changed since the approval as well (${added.length} added, ${raised.length} up), so this version needs the customer's approval`, created_by: by.id });
    return { ok: true, draft: true, newId: made.id, words: `Other parts changed since the approval too (${added.length} added, ${raised.length} up): ${q.number} v${made.version} is ready to send for the customer's approval.` };
  }

  const now = new Date().toISOString();
  for (const l of nl) {
    const was = l.revised_from_line_id ? old.get(l.revised_from_line_id) : null;
    await admin.from("quotation_lines").update({ customer_approved: was ? (was.customer_approved ?? true) : true }).eq("id", l.id);
  }
  const { error: apErr } = await admin.from("quotations").update({ status: "approved", responded_at: now, opened_at: now, approver_name: `${by.display_name} (${REDUCED_MARK.toLowerCase()})`, updated_by: by.id }).eq("id", made.id);
  if (apErr) return { error: "Couldn't approve the reduced version – nothing was sent. Try again or tell the owner." };
  await admin.from("quotations").update({ status: "superseded", updated_by: by.id }).eq("number", q.number).eq("kind", "quotation").lt("version", made.version).eq("is_active", true).neq("status", "superseded");
  const words = lines.map((l) => l.words).join("; ");
  const { logQuoteEvent } = await import("./quote-data");
  await logQuoteEvent(made.id, jobId, by.id, "reduced_after_approval", `${REDUCED_MARK}: ${q.number} v${made.version} by ${by.display_name} – ${words}`);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "quote_reduced", note: `${q.number} v${made.version}: ${REDUCED_MARK} – ${words} (${by.display_name})`, created_by: by.id });

  const settings = await getSettings();
  try {
    const { replaceProformaAfterRevision } = await import("./invoice-flow");
    await replaceProformaAfterRevision(jobId, by.id, settings);
    const { ensureWorkLines } = await import("./work-data");
    await ensureWorkLines(jobId, by.id);
  } catch (e) {
    await logAppError("qty-reduce: proforma", e, { staffId: by.id, jobId });
  }
  const { jobMoneyOf } = await import("./customer-money");
  const money = await jobMoneyOf(jobId, settings).catch(() => null);
  const overpaid = money && money.total !== null ? overpaidWords(money.paid, money.total) : null;
  if (overpaid) await notifyRoles(["accounts"], { type: "qty_reduced", title: `Advance or refund · ${q.number}`, body: `${REDUCED_MARK}. ${overpaid}`, jobId, href: `/jobs/${jobId}/invoice` });

  const { quoteMessageFor } = await import("./quote-message");
  const msg = await quoteMessageFor(made.id, by.display_name);
  const save = lines.reduce((a, l) => a + l.save, 0);
  const message = msg
    ? `Dear ${msg.parts.name},\n\nGood news on your ${msg.parts.car}${msg.parts.plate ? ` (${msg.parts.plate})` : ""}: we needed fewer parts than quoted (${lines.map((l) => `${l.title.toUpperCase()} ${l.now} instead of ${l.quoted}`).join(", ")}), so your price is AED ${save.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lower before VAT.\n\nThe updated quotation is here for your information – no approval is needed:\n${msg.parts.link}\n\n${by.display_name}\nOFJ Automotive`
    : "";
  return { ok: true, newId: made.id, words: `${q.number} v${made.version} approved: ${REDUCED_MARK}.`, message, phoneDigits: msg?.phoneDigits ?? "", overpaid };
}

/** Keep the approved price although fewer pieces are used: the owner, with a reason (written on the quotation). */
export async function keepPriceAfterApproval(quotationId: string, reason: string, by: Actor): Promise<{ error?: string; ok?: boolean; asked?: boolean }> {
  const why = reason.trim();
  if (why.length < 5) return { error: "Give the reason (at least 5 characters)." };
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, number, job_id, status").eq("id", quotationId).maybeSingle();
  if (!q || q.status !== "approved") return { error: "This quotation is no longer the approved version." };
  const lines = await reduceLinesOf(quotationId);
  if (!lines.length) return { error: "Nothing waiting: every part matches the approved quantity." };
  if (by.role_id !== "owner") {
    const fresh = lines.filter((l) => !l.asked);
    if (!fresh.length) return { error: "The owner has already been asked." };
    await admin.from("quotation_events").insert({ quotation_id: quotationId, job_id: q.job_id, event_type: "qty_keep_asked", note: `${by.display_name} asks to keep the approved price: ${why} ${fresh.map((l) => `[ask:${l.lineId}:${l.now}]`).join(" ")}`, created_by: by.id });
    await notifyRoles(["owner"], { type: "qty_keep_price", title: `Keep the price? · ${q.number}`, body: `${by.display_name}: fewer parts used (${fresh.map((l) => l.words).join("; ")}) but asks to keep the approved price – ${why}`, jobId: q.job_id, href: `/jobs/${q.job_id}/quote/${quotationId}#qty-reduce` });
    return { ok: true, asked: true };
  }
  await admin.from("quotation_events").insert({ quotation_id: quotationId, job_id: q.job_id, event_type: "qty_keep_price", note: `Approved price kept by ${by.display_name}: ${why} ${lines.map((l) => `[keep:${l.lineId}:${l.now}]`).join(" ")}`, created_by: by.id });
  await admin.from("job_events").insert({ job_id: q.job_id, event_type: "quote_price_kept", note: `${q.number}: approved price kept although fewer parts were used (${lines.map((l) => l.words).join("; ")}) – ${why} (${by.display_name})`, created_by: by.id });
  if (q.job_id) await notifyStaff(await jobAdvisorIds(q.job_id), { type: "qty_keep_price", title: `Price kept · ${q.number}`, body: `The owner kept the approved price: ${why}`, jobId: q.job_id, href: `/jobs/${q.job_id}/quote/${quotationId}` });
  return { ok: true };
}
