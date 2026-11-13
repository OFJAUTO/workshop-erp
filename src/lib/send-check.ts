import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { logAppError } from "./app-errors";
import { boughtPrices } from "./part-cost-history";
import { compactPartNumber } from "./price-import";
import { realPartNumber } from "./parts-rows";
import { flagsOf, type SendLine } from "./send-check-rules";

/*
 * CHECK BEFORE YOU SEND (13 November 2026): the facts each part is checked against (the last price we paid for its part
 * number, what the customer's quote said) and the log of each confirmation (who, when, which flags were showing).
 */

export type SendKind = "prices" | "lpo_approval" | "lpo_supplier" | "receipt";

export async function sendChecksReady(): Promise<boolean> {
  return schemaReady("send_checks", "id, kind, flags, part_ids");
}

/** The lines of some parts with every fact the flags need, and their flags. */
export async function sendLinesFor(partIds: string[], opts: { supplierOf?: Record<string, string | null> } = {}): Promise<{ lines: SendLine[]; flags: Record<string, string[]> }> {
  const ids = Array.from(new Set(partIds.filter(Boolean)));
  if (!ids.length) return { lines: [], flags: {} };
  const admin = createAdminClient();
  const [{ data: parts }, { data: qlines }, bought] = await Promise.all([
    admin.from("part_items").select("id, description, part_number, quantity, confirmed_quantity, cost_aed, supplier").in("id", ids),
    admin.from("quotation_lines").select("part_item_id, quantity, unit_cost, line_total, left_off, quotation:quotations(status, version)").in("part_item_id", ids).eq("is_active", true),
    boughtPrices().catch(() => new Map()),
  ]);
  type Q = { part_item_id: string; quantity: number | string; unit_cost: number | string | null; line_total: number | string | null; left_off: boolean | null; quotation: { status: string; version: number } | null };
  const quoteOf = new Map<string, Q>();
  for (const q of (qlines ?? []) as unknown as Q[]) {
    if (q.left_off || !q.quotation || !["approved", "urgent_requested", "sent", "opened", "draft", "pending_owner"].includes(q.quotation.status)) continue;
    const cur = quoteOf.get(q.part_item_id);
    const rank = (x: Q) => (["approved", "urgent_requested"].includes(x.quotation!.status) ? 1000 : 0) + x.quotation!.version;
    if (!cur || rank(q) > rank(cur)) quoteOf.set(q.part_item_id, q);
  }
  const lines: SendLine[] = ((parts ?? []) as { id: string; description: string; part_number: string | null; quantity: number | string; confirmed_quantity: number | string | null; cost_aed: number | string | null; supplier: string | null }[]).map((p) => {
    const q = quoteOf.get(p.id);
    const pn = realPartNumber(p.part_number);
    const k = pn ? compactPartNumber(pn) : "";
    const last = k ? ((bought.get(k) ?? []) as { cost: number }[]).find((b) => b.cost > 1)?.cost ?? null : null;
    return {
      key: p.id,
      name: p.description,
      partNumber: p.part_number,
      noNumberTicked: String(p.part_number ?? "").trim().toUpperCase() === "NO NUMBER",
      qty: Number(p.confirmed_quantity ?? p.quantity) || 1,
      price: p.cost_aed === null ? null : Number(p.cost_aed),
      supplier: opts.supplierOf?.[p.id] ?? p.supplier,
      pricedSupplier: opts.supplierOf?.[p.id] !== undefined ? p.supplier : null,
      lastPrice: last,
      quotedQty: q ? Number(q.quantity) || null : null,
      quotedCost: q && q.unit_cost !== null ? Number(q.unit_cost) : null,
      quotedSell: q && q.line_total !== null ? Number(q.line_total) : null,
    };
  });
  return { lines, flags: flagsOf(lines) };
}

/** The log of one confirmation. Never stops a send (a failed log is logged). */
export async function logSendCheck(kind: SendKind, refs: { jobId?: string | null; poId?: string | null; partIds?: string[] }, flags: { key: string; name: string; flags: string[] }[], by: { id: string }): Promise<void> {
  if (!(await sendChecksReady())) return;
  const { error } = await createAdminClient().from("send_checks").insert({ kind, job_id: refs.jobId ?? null, po_id: refs.poId ?? null, part_ids: refs.partIds ?? [], flags, flag_count: flags.reduce((a, f) => a + f.flags.length, 0), created_by: by.id, updated_by: by.id });
  if (error) logAppError("send-check.log", error, { staffId: by.id });
}

export type SendCheckSeen = { kind: SendKind; at: string; by: string | null; flags: { key: string; name: string; flags: string[] }[] };
/** What the parts desk saw when it sent an LPO for approval (the approver sees the same flags). */
export async function sendCheckForPo(poId: string, partIds: string[]): Promise<SendCheckSeen | null> {
  if (!(await sendChecksReady())) return null;
  const admin = createAdminClient();
  const { data: byPo } = await admin.from("send_checks").select("kind, created_at, created_by, flags").eq("po_id", poId).order("created_at", { ascending: false }).limit(1);
  let row = (byPo ?? [])[0] as { kind: SendKind; created_at: string; created_by: string | null; flags: SendCheckSeen["flags"] } | undefined;
  if (!row && partIds.length) {
    const { data: byParts } = await admin.from("send_checks").select("kind, created_at, created_by, flags").eq("kind", "lpo_approval").overlaps("part_ids", partIds).order("created_at", { ascending: false }).limit(1);
    row = (byParts ?? [])[0] as unknown as typeof row;
  }
  if (!row) return null;
  const { data: s } = row.created_by ? await admin.from("staff").select("display_name").eq("id", row.created_by).maybeSingle() : { data: null };
  return { kind: row.kind, at: row.created_at, by: (s?.display_name as string | undefined) ?? null, flags: row.flags ?? [] };
}

/** Per part: its part number (as typed), its delivery and its flags - what the window shows for a list of parts. */
export async function sendChecksRecord(partIds: string[], opts: { supplierOf?: Record<string, string | null> } = {}): Promise<Record<string, { partNumber: string | null; delivery: string | null; flags: string[] }>> {
  const ids = Array.from(new Set(partIds.filter(Boolean)));
  if (!ids.length) return {};
  const [{ lines, flags }, { data }] = await Promise.all([sendLinesFor(ids, opts), createAdminClient().from("part_items").select("id, availability, delivery_date, expected_date").in("id", ids)]);
  const when = new Map(((data ?? []) as { id: string; availability: string | null; delivery_date: string | null; expected_date: string | null }[]).map((p) => {
    const d = (p.expected_date ?? p.delivery_date)?.slice(0, 10) ?? null;
    return [p.id, p.availability === "in_stock" ? "In stock" : d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null];
  }));
  return Object.fromEntries(lines.map((l) => [l.key, { partNumber: l.partNumber, delivery: when.get(l.key) ?? null, flags: flags[l.key] ?? [] }]));
}

/** For the Parts table: per part, what the quote said and the last price paid (the flags are worked out on screen). */
export async function sendFactsFor(partIds: string[]): Promise<Record<string, { lastPrice: number | null; quotedQty: number | null; quotedCost: number | null; quotedSell: number | null }>> {
  const { lines } = await sendLinesFor(partIds);
  return Object.fromEntries(lines.map((l) => [l.key, { lastPrice: l.lastPrice ?? null, quotedQty: l.quotedQty ?? null, quotedCost: l.quotedCost ?? null, quotedSell: l.quotedSell ?? null }]));
}
