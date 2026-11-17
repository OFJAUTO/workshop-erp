import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { PoBundle, SupplierRow } from "./parts-data";
import { notifyRoles } from "./notifications";
import { workingHoursBetween } from "./working-time";
import { workingTimeOf } from "./jobs";
import type { Settings } from "./settings";

/*
 * SHARE AN LPO WITH THE SUPPLIER (17 November 2026, Section 5). Some suppliers need the LPO to check and confirm before
 * accounts or the owner approve it: the parts desk shares a DRAFT (the same supplier copy, the draft mark across it and in
 * its header); after approval the clean LPO is shared the same way. The real LPO is never shared before approval (its
 * PDF and email refuse a waiting LPO). Who shared what, and when, is kept in the change log and shown on the LPO page.
 */

export type ShareStamp = { kind: "draft" | "sent"; supplier: string; method: string; by: string; at: string };

/** The supplier row for a draft (by name: a main LPO waiting for approval holds several suppliers). */
export async function draftSupplierRow(name: string): Promise<SupplierRow | null> {
  const n = name.trim();
  if (!n) return null;
  const { data } = await createAdminClient().from("suppliers").select("id, name, trn, vat_registered, phone, email, address, payment_terms").ilike("name", n).eq("is_active", true).limit(1).maybeSingle();
  return (data as SupplierRow | null) ?? null;
}

/** The suppliers on a waiting LPO, each with its phone and email (one draft per supplier). */
export async function draftSuppliersOf(bundle: PoBundle): Promise<{ name: string; phone: string | null; email: string | null; lines: number }[]> {
  const count = new Map<string, number>();
  for (const l of bundle.lines) {
    const p = l.part_item_id ? bundle.parts.find((x) => x.id === l.part_item_id) : null;
    const name = (p?.supplier ?? bundle.po.supplier_name ?? "").trim();
    if (!name || /^our stock$/i.test(name)) continue;
    count.set(name, (count.get(name) ?? 0) + 1);
  }
  const out = [];
  for (const [name, lines] of count) {
    const s = await draftSupplierRow(name);
    out.push({ name, phone: s?.phone ?? null, email: s?.email ?? null, lines });
  }
  return out;
}

/** Keeps "Draft shared with <supplier> <date, time, who>" (the change log; the job's history too). */
export async function recordDraftShare(poId: string, supplier: string, method: "whatsapp" | "email" | "pdf", by: { id: string; display_name: string }): Promise<void> {
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("number, job_id").eq("id", poId).maybeSingle();
  const at = new Date().toISOString();
  await admin.from("audit_log").insert({ table_name: "purchase_orders", record_id: poId, action: "update", old_data: {}, new_data: { draft_shared: { supplier, method, by: by.display_name, at } }, changed_by: by.id });
  if (po?.job_id) await admin.from("job_events").insert({ job_id: po.job_id, event_type: "lpo_draft_shared", note: `Draft of ${po.number} shared with ${supplier} (${method === "whatsapp" ? "WhatsApp" : method === "email" ? "email" : "PDF"}) by ${by.display_name}: for price and availability only, not an order until approved.`, created_by: by.id });
}

/** Every draft shared and the LPO's own send, oldest first, for the LPO page. */
export async function lpoShareStamps(poIds: string[]): Promise<ShareStamp[]> {
  if (!poIds.length) return [];
  const admin = createAdminClient();
  const [{ data: logs }, { data: pos }] = await Promise.all([
    admin.from("audit_log").select("new_data").eq("table_name", "purchase_orders").in("record_id", poIds).not("new_data->draft_shared", "is", null).order("changed_at"),
    admin.from("purchase_orders").select("supplier_name, sent_at, sent_by, sent_method, emailed_at, emailed_by").in("id", poIds),
  ]);
  const out: ShareStamp[] = [];
  for (const l of (logs ?? []) as { new_data: { draft_shared?: { supplier: string; method: string; by: string; at: string } } }[]) {
    const d = l.new_data?.draft_shared;
    if (d) out.push({ kind: "draft", supplier: d.supplier, method: d.method, by: d.by, at: d.at });
  }
  const rows = (pos ?? []) as { supplier_name: string; sent_at: string | null; sent_by: string | null; sent_method: string | null; emailed_at: string | null; emailed_by: string | null }[];
  const ids = Array.from(new Set(rows.flatMap((r) => [r.sent_by, r.emailed_by]).filter((x): x is string => !!x)));
  const { data: ppl } = ids.length ? await admin.from("staff").select("id, display_name").in("id", ids) : { data: [] };
  const name = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  for (const r of rows) {
    if (r.sent_at) out.push({ kind: "sent", supplier: r.supplier_name, method: r.sent_method ?? "", by: r.sent_by ? name.get(r.sent_by) ?? "" : "", at: r.sent_at });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The nudge (hourly): an approved supplier LPO not sent after 2 working hours tells the parts desk once. Returns how
 * many were nudged now.
 */
export async function approvedNotSentHourly(settings: Settings, now = new Date()): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from("purchase_orders").select("id, number, supplier_name, job_id, approved_at, parent_id").eq("status", "approved").eq("is_active", true).neq("kind", "main").is("sent_at", null).is("emailed_at", null);
  const rows = (data ?? []) as { id: string; number: string; supplier_name: string; job_id: string | null; approved_at: string | null; parent_id: string | null }[];
  if (!rows.length) return 0;
  const parents = Array.from(new Set(rows.filter((r) => !r.approved_at && r.parent_id).map((r) => r.parent_id as string)));
  const { data: ps } = parents.length ? await admin.from("purchase_orders").select("id, approved_at").in("id", parents) : { data: [] };
  const parentAt = new Map(((ps ?? []) as { id: string; approved_at: string | null }[]).map((p) => [p.id, p.approved_at]));
  const wt = workingTimeOf(settings as unknown as Parameters<typeof workingTimeOf>[0]);
  let n = 0;
  for (const r of rows) {
    const at = r.approved_at ?? (r.parent_id ? parentAt.get(r.parent_id) ?? null : null);
    if (!at || workingHoursBetween(at, now, wt) < 2) continue;
    const href = `/parts/orders/${r.id}`;
    const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("type", "lpo_not_sent").eq("href", href);
    if ((count ?? 0) > 0) continue;
    await notifyRoles(["parts"], { type: "lpo_not_sent", title: `Approved, not sent yet · ${r.number}`, body: `${r.number} to ${r.supplier_name} was approved more than 2 working hours ago and has not been sent. Send it now (Share → WhatsApp or email).`, href, jobId: r.job_id });
    n += 1;
  }
  return n;
}
