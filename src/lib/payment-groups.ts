import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { getSettings, type Settings } from "./settings";
import { schemaReady } from "./schema-ready";
import { paymentChoices } from "./customer-money";
import { checkShares, partOfWords, payWhat, splitPayment, type OpenDoc, type Share } from "./combined-pay-rules";
import { round2 } from "./money";

/*
 * One payment for several cars (9 November 2026, Section 3). THE step is receiveCombined: one payment group (CP-) with
 * the one amount and its cheque/transfer details; each open proforma or invoice it pays gets its own receipt (through
 * recordPaymentCore, so every rule of a single payment holds) saying "Part of cheque 019383 (AED 4,368.00 total)";
 * what is left over is an advance on the customer's account. A cheque or transfer group clears or bounces as ONE
 * (bank-posting.ts expands any one share to its whole group). "Replace with combined payment" voids the receipts it
 * replaces first, with the reason, and the group keeps which ones they were.
 */

export const groupsReady = () => schemaReady("payments", "group_id");

export type CombinedInput = {
  method: string;
  amount: number;
  reference?: string | null;
  authCode?: string | null;
  cheque?: { number: string | null; bank: string | null; date: string | null } | null;
  shares: Share[];
  clientKey: string;
  replace?: { paymentIds: string[]; reason: string } | null;
};
type Actor = { id: string; display_name: string; role_id: string; is_head_accountant?: boolean };

/** The customer's open proformas and invoices (the money each still needs), oldest first. */
export async function openDocsOfCustomer(customerId: string, settings?: Settings, opts: { /** Receipts being replaced: their money no longer counts as waiting. */ ignore?: string[] } = {}): Promise<(OpenDoc & { title: string; jobId: string | null; isProforma: boolean })[]> {
  const s = settings ?? (await getSettings());
  const choices = await paymentChoices({ customerId }, s);
  if (!choices) return [];
  const docs = choices.targets.filter((t) => t.kind === "invoice" && t.invoiceId && (t.balance ?? 0) > 0.004);
  const admin = createAdminClient();
  const { data } = docs.length ? await admin.from("invoices").select("id, issued_at").in("id", docs.map((d) => d.invoiceId!)) : { data: [] };
  const issued = new Map(((data ?? []) as { id: string; issued_at: string | null }[]).map((r) => [r.id, r.issued_at]));
  // Money already waiting for the bank on a document (a cheque not cleared) is not owed again.
  const { data: waiting } = docs.length ? await admin.from("payments").select("id, invoice_id, amount_aed").in("invoice_id", docs.map((d) => d.invoiceId!)).eq("is_active", true).eq("status", "recorded").in("method", ["cheque", "transfer"]).eq("cheque_status", "pending") : { data: [] };
  const pendingOn = new Map<string, number>();
  for (const w of ((waiting ?? []) as { id: string; invoice_id: string; amount_aed: number | string }[]).filter((x) => !opts.ignore?.includes(x.id))) pendingOn.set(w.invoice_id, round2((pendingOn.get(w.invoice_id) ?? 0) + Number(w.amount_aed)));
  return docs
    .map((t) => ({ invoiceId: t.invoiceId!, number: t.invoiceNumber ?? "", issuedAt: issued.get(t.invoiceId!) ?? null, due: round2(Math.max(0, (t.balance ?? 0) - (pendingOn.get(t.invoiceId!) ?? 0))), title: t.title, jobId: t.jobId, isProforma: t.isProforma }))
    .filter((d) => d.due > 0.004)
    .sort((a, b) => String(a.issuedAt ?? "").localeCompare(String(b.issuedAt ?? "")));
}

async function nextGroupNumber(): Promise<string> {
  const { data } = await createAdminClient().from("payment_groups").select("number").like("number", "CP-%").order("number", { ascending: false }).limit(1);
  const last = Number(String((data?.[0] as { number: string } | undefined)?.number ?? "CP-0").slice(3)) || 0;
  return `CP-${String(last + 1).padStart(5, "0")}`;
}

export type CombinedResult = { error?: string; ok?: boolean; number?: string; words?: string; receipts?: string[] };

export async function receiveCombined(customerId: string, input: CombinedInput, actor: Actor): Promise<CombinedResult> {
  if (!(actor.role_id === "owner" || actor.role_id === "accounts")) return { error: "Only accounts or the owner record payments." };
  if (!(await groupsReady())) return { error: "Receiving one payment for several cars switches on with the database update of 9 November (WAITING FOR APPLY). Until then record each car's share on its own job." };
  const admin = createAdminClient();
  const settings = await getSettings();
  const method = String(input.method);
  if (!["cash", "card", "link", "cheque", "transfer"].includes(method)) return { error: "Pick how it was paid." };
  const amount = round2(Number(input.amount) || 0);
  const cheque = method === "cheque" ? { number: input.cheque?.number?.trim() || null, bank: input.cheque?.bank?.trim() || null, date: input.cheque?.date || null } : null;
  if (method === "cheque" && (!cheque?.number || !cheque.date)) return { error: "A cheque needs its number and date." };
  // The same tap twice: the group with this key is that payment.
  const { data: same } = await admin.from("payment_groups").select("id, number").eq("client_key", input.clientKey).maybeSingle();
  if (same) return { ok: true, number: same.number as string, words: `${same.number} was already recorded.` };

  // Replacing earlier receipts (the same cheque recorded on one car, or twice): they are voided first, with the reason.
  const replaced: { id: string; number: string }[] = [];
  if (input.replace?.paymentIds.length) {
    const reason = (input.replace.reason ?? "").trim();
    if (reason.length < 5) return { error: "Write why the earlier receipts are replaced (at least 5 characters)." };
    const { data: olds } = await admin.from("payments").select("id, number, customer_id, status, is_active").in("id", input.replace.paymentIds);
    const list = (olds ?? []) as { id: string; number: string; customer_id: string; status: string; is_active: boolean }[];
    if (list.some((p) => p.customer_id !== customerId)) return { error: "A receipt to replace belongs to another customer." };
    const { voidPayment } = await import("./payments");
    for (const p of list.filter((x) => x.status === "recorded" && x.is_active)) {
      const r = await voidPayment(p.id, { id: actor.id, display_name: actor.display_name, role_id: actor.role_id, is_head_accountant: actor.is_head_accountant }, `Replaced by a combined payment: ${reason}`);
      if (r.error) return { error: `${p.number} could not be voided: ${r.error}` };
      replaced.push({ id: p.id, number: p.number });
    }
  }

  const docs = await openDocsOfCustomer(customerId, settings);
  const shares = input.shares.length ? input.shares.map((s) => ({ invoiceId: s.invoiceId, amount: round2(Number(s.amount) || 0) })).filter((s) => s.amount > 0) : splitPayment(amount, docs).shares;
  const problem = checkShares(amount, shares, docs);
  if (problem) return { error: problem };
  const leftover = round2(amount - shares.reduce((a, s) => a + s.amount, 0));
  const words = partOfWords(method, amount, cheque?.number ?? null, input.reference ?? null);

  let number = await nextGroupNumber();
  let group: { id: string; number: string } | null = null;
  for (let i = 0; i < 2 && !group; i++) {
    const { data, error } = await admin.from("payment_groups").insert({ number, customer_id: customerId, method, amount_aed: amount, reference: input.reference ?? null, auth_code: input.authCode ?? null, cheque_number: cheque?.number ?? null, cheque_bank: cheque?.bank ?? null, cheque_date: cheque?.date ?? null, notes: words, replaced_payment_ids: replaced.map((r) => r.id), replace_reason: input.replace?.reason?.trim() || null, client_key: input.clientKey, created_by: actor.id, updated_by: actor.id }).select("id, number").single();
    if (data) group = data as { id: string; number: string };
    else if (error && /duplicate|unique/i.test(error.message)) number = await nextGroupNumber();
    else { await logAppError("payment-groups: insert", error ?? "no row", { staffId: actor.id }); return { error: SAVE_FAILED }; }
  }
  if (!group) return { error: SAVE_FAILED };

  const { recordPaymentCore } = await import("./payments");
  const receipts: string[] = [];
  const parts: { invoiceId: string | null; amount: number }[] = [...shares.map((s) => ({ invoiceId: s.invoiceId, amount: s.amount })), ...(leftover > 0.004 ? [{ invoiceId: null, amount: leftover }] : [])];
  for (const part of parts) {
    const r = await recordPaymentCore({ id: actor.id, display_name: actor.display_name, role_id: actor.role_id }, {
      invoiceId: part.invoiceId,
      jobId: null,
      method,
      amount: part.amount,
      reference: input.reference ?? null,
      authCode: input.authCode ?? null,
      cheque,
      // The whole group is ONE cheque: its full amount caps the shares (11 November 2026, Section 5).
      chequeTotal: method === "cheque" ? amount : null,
      notes: part.invoiceId ? `${words} · ${group.number}` : `Left over from ${group.number} (${payWhat(method, cheque?.number ?? null, input.reference ?? null)}): an advance on the account`,
      clientKey: `${input.clientKey}:${part.invoiceId ?? "advance"}`,
      unallocated: part.invoiceId ? null : { customerId },
      duplicateReason: `combined payment ${group.number}`,
    }, settings);
    if (r.error || !r.paymentId) {
      await logAppError("payment-groups: share", r.error ?? "no receipt", { staffId: actor.id, detail: { group: group.number, part } });
      return { error: `${group.number}: ${receipts.length ? `${receipts.join(", ")} recorded, but ` : ""}a share could not be recorded (${r.error ?? "try again"}). Tell the owner.`, number: group.number, receipts };
    }
    await admin.from("payments").update({ group_id: group.id }).eq("id", r.paymentId);
    receipts.push(r.number ?? "");
  }
  if (replaced.length) await admin.from("payment_groups").update({ notes: `${words} · replaces ${replaced.map((r) => r.number).join(", ")}` }).eq("id", group.id);
  // Zoho: ONE customer payment for the whole group (each share applies to its car's invoice from it).
  const { tryEnqueueZoho } = await import("./zoho-sync");
  await tryEnqueueZoho("paygroup", group.id, null, actor.id).catch(() => null);
  return { ok: true, number: group.number, receipts, words: `${group.number}: AED ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} by ${payWhat(method, cheque?.number ?? null, input.reference ?? null)} over ${shares.length} car${shares.length === 1 ? "" : "s"} (${receipts.join(", ")})${leftover > 0.004 ? `, AED ${leftover.toLocaleString("en-GB", { minimumFractionDigits: 2 })} as an advance` : ""}${replaced.length ? `. Replaced ${replaced.map((r) => r.number).join(", ")}` : ""}.` };
}

/** Every share of the same group (a combined cheque or transfer clears or bounces as ONE). */
export async function groupSiblings(paymentIds: string[]): Promise<string[]> {
  if (!paymentIds.length || !(await groupsReady())) return paymentIds;
  const admin = createAdminClient();
  const { data } = await admin.from("payments").select("group_id").in("id", paymentIds).not("group_id", "is", null);
  const groups = Array.from(new Set(((data ?? []) as { group_id: string }[]).map((r) => r.group_id)));
  if (!groups.length) return paymentIds;
  const { data: sib } = await admin.from("payments").select("id").in("group_id", groups).eq("is_active", true).eq("status", "recorded").eq("cheque_status", "pending");
  return Array.from(new Set([...paymentIds, ...((sib ?? []) as { id: string }[]).map((r) => r.id)]));
}

/** The group words for receipts ("Part of cheque 019383 (AED 4,368.00 total) · CP-00001"), by payment id. */
export async function groupWordsFor(paymentIds: string[]): Promise<Map<string, { number: string; words: string; amount: number; customerId: string }>> {
  const out = new Map<string, { number: string; words: string; amount: number; customerId: string }>();
  if (!paymentIds.length || !(await groupsReady())) return out;
  const admin = createAdminClient();
  const { data } = await admin.from("payments").select("id, group_id").in("id", paymentIds).not("group_id", "is", null);
  const rows = (data ?? []) as { id: string; group_id: string }[];
  if (!rows.length) return out;
  const { data: groups } = await admin.from("payment_groups").select("id, number, method, amount_aed, cheque_number, reference, customer_id").in("id", Array.from(new Set(rows.map((r) => r.group_id))));
  const byId = new Map(((groups ?? []) as { id: string; number: string; method: string; amount_aed: number | string; cheque_number: string | null; reference: string | null; customer_id: string }[]).map((g) => [g.id, g]));
  for (const r of rows) {
    const g = byId.get(r.group_id);
    if (g) out.set(r.id, { number: g.number, words: partOfWords(g.method, Number(g.amount_aed), g.cheque_number, g.reference), amount: Number(g.amount_aed), customerId: g.customer_id });
  }
  return out;
}
