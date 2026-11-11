import { createAdminClient } from "@/lib/supabase/admin";
import { schemaReady } from "@/lib/schema-ready";
import { jobQuotesFrom, partQuoteOf, requestQuoteOf, type JobQuote } from "@/lib/part-quote";

/**
 * The server side of "which quotation a part belongs to" (11 November 2026, Section 2). One read per job: the job's
 * quotations (one per number), each part's stored quotation and the quotations whose live lines carry it.
 */
export async function partQuoteReady(): Promise<boolean> {
  return schemaReady("part_items", "for_quote");
}

export type PartQuoteMap = {
  ready: boolean;
  quotes: JobQuote[];
  /** Part id → the quotation number it belongs to (null = none yet). */
  partOf: Map<string, string | null>;
  /** Request id → the quotation number it belongs to. */
  requestOf: Map<string, string | null>;
  /** Part id → the stored tag and the numbers of quotations whose live lines carry it. */
  partFacts: Map<string, { tag: string | null; lineNumbers: string[] }>;
};

export async function partQuoteMap(jobId: string): Promise<PartQuoteMap> {
  const admin = createAdminClient();
  const ready = await partQuoteReady();
  const [{ data: qRows }, { data: partRows }, { data: reqRows }] = await Promise.all([
    admin.from("quotations").select("id, number, version, status, created_at").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).neq("status", "cancelled"),
    admin.from("part_items").select(ready ? "id, part_request_id, for_quote" : "id, part_request_id").eq("job_id", jobId),
    admin.from("part_requests").select(ready ? "id, for_quote" : "id").eq("job_id", jobId),
  ]);
  const quotes = jobQuotesFrom(((qRows ?? []) as { id: string; number: string; version: number; status: string; created_at: string }[]).map((r) => ({ ...r, version: Number(r.version) })));
  const qIds = ((qRows ?? []) as { id: string }[]).map((r) => r.id);
  const numberOfQ = new Map(((qRows ?? []) as { id: string; number: string }[]).map((r) => [r.id, r.number]));
  const { data: lineRows } = qIds.length ? await admin.from("quotation_lines").select("quotation_id, part_item_id").in("quotation_id", qIds).eq("is_active", true).not("part_item_id", "is", null) : { data: [] };
  // Only the NEWEST version of each number counts as carrying a part (an older version's line is history).
  const newestIds = new Set(quotes.map((q) => q.newestId));
  const lineNums = new Map<string, string[]>();
  for (const l of (lineRows ?? []) as { quotation_id: string; part_item_id: string }[]) {
    if (!newestIds.has(l.quotation_id)) continue;
    const n = numberOfQ.get(l.quotation_id);
    if (n) lineNums.set(l.part_item_id, Array.from(new Set([...(lineNums.get(l.part_item_id) ?? []), n])));
  }
  const reqTag = new Map(((reqRows ?? []) as unknown as { id: string; for_quote?: string | null }[]).map((r) => [r.id, r.for_quote ?? null]));
  const partFacts = new Map<string, { tag: string | null; lineNumbers: string[] }>();
  const partOf = new Map<string, string | null>();
  for (const p of (partRows ?? []) as unknown as { id: string; part_request_id: string | null; for_quote?: string | null }[]) {
    const facts = { tag: p.for_quote ?? (p.part_request_id ? reqTag.get(p.part_request_id) ?? null : null), lineNumbers: lineNums.get(p.id) ?? [] };
    partFacts.set(p.id, facts);
    partOf.set(p.id, partQuoteOf(facts, quotes));
  }
  const requestOf = new Map<string, string | null>();
  for (const [id, tag] of reqTag) requestOf.set(id, requestQuoteOf(tag, quotes));
  return { ready, quotes, partOf, requestOf, partFacts };
}
