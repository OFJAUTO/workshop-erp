import "server-only";
import { replaceWord } from "./spell-rules";
import { createAdminClient } from "./supabase/admin";

/**
 * What the customer will read in a document, as checkable texts with a key that says where each one is stored
 * (so a one-tap fix can change it there): the quotation or estimate lines and note, the inspection report's
 * remarks, dangerous reasons, bodyshop remarks and the workshop note, the invoice lines and note.
 */
export type SpellSource = { kind: "quotation"; id: string } | { kind: "report"; jobId: string } | { kind: "invoice"; token: string };
export type DocText = { key: string; label: string; text: string };

export async function documentTexts(source: SpellSource): Promise<DocText[]> {
  const admin = createAdminClient();
  const out: DocText[] = [];
  if (source.kind === "quotation") {
    const [{ data: q }, { data: lines }] = await Promise.all([
      admin.from("quotations").select("id, customer_note").eq("id", source.id).maybeSingle(),
      admin.from("quotation_lines").select("id, title, details, visible_to_customer, fee_kind").eq("quotation_id", source.id).eq("is_active", true).order("position"),
    ]);
    for (const l of lines ?? []) {
      if (l.visible_to_customer === false || l.fee_kind) continue;
      if (l.title) out.push({ key: `ql:${l.id}:title`, label: "Line", text: l.title });
      if (l.details) out.push({ key: `ql:${l.id}:details`, label: "Line note", text: l.details });
    }
    if (q?.customer_note) out.push({ key: `q:${q.id}:customer_note`, label: "Note to the customer", text: q.customer_note });
  } else if (source.kind === "report") {
    const { data: insp } = await admin.from("inspections").select("id, manager_note").eq("job_id", source.jobId).eq("path", "mechanical").eq("is_active", true).maybeSingle();
    if (insp) {
      const [{ data: items }, { data: body }] = await Promise.all([
        admin.from("inspection_items").select("id, item_label, remarks, dangerous_reason, status, merged_into").eq("inspection_id", insp.id).is("merged_into", null).order("position"),
        admin.from("bodyshop_findings").select("id, panel, remark").eq("inspection_id", insp.id).eq("is_active", true),
      ]);
      for (const i of items ?? []) {
        if (i.remarks?.trim()) out.push({ key: `ii:${i.id}:remarks`, label: i.item_label, text: i.remarks });
        if (i.dangerous_reason?.trim()) out.push({ key: `ii:${i.id}:dangerous_reason`, label: `${i.item_label} (dangerous)`, text: i.dangerous_reason });
      }
      for (const f of body ?? []) if (f.remark?.trim()) out.push({ key: `bf:${f.id}:remark`, label: "Bodyshop finding", text: f.remark });
      if (insp.manager_note?.trim()) out.push({ key: `insp:${insp.id}:manager_note`, label: "Workshop note", text: insp.manager_note });
    }
  } else if (source.kind === "invoice") {
    const { data: inv } = await admin.from("invoices").select("id, notes").eq("token", source.token).maybeSingle();
    if (inv) {
      const { data: lines } = await admin.from("invoice_lines").select("id, description, details").eq("invoice_id", inv.id).eq("is_active", true).order("position");
      for (const l of lines ?? []) {
        if (l.description) out.push({ key: `il:${l.id}:description`, label: "Line", text: l.description });
        if (l.details) out.push({ key: `il:${l.id}:details`, label: "Line note", text: l.details });
      }
      if (inv.notes?.trim()) out.push({ key: `inv:${inv.id}:notes`, label: "Note", text: inv.notes });
    }
  }
  return out;
}

// Where a key's text lives: the table, and the fields that may be changed by a fix.
const TARGETS: Record<string, { table: string; fields: string[] }> = {
  ql: { table: "quotation_lines", fields: ["title", "details"] },
  q: { table: "quotations", fields: ["customer_note"] },
  ii: { table: "inspection_items", fields: ["remarks", "dangerous_reason"] },
  bf: { table: "bodyshop_findings", fields: ["remark"] },
  insp: { table: "inspections", fields: ["manager_note"] },
  il: { table: "invoice_lines", fields: ["description", "details"] },
  inv: { table: "invoices", fields: ["notes"] },
};

/** The one-tap fix: the word replaced in the stored text. A locked document (an approved quotation) refuses, kindly. */
export async function applySpellFix(key: string, word: string, replacement: string, by: string): Promise<{ error?: string; text?: string }> {
  const [kind, id, field] = key.split(":");
  const target = TARGETS[kind];
  if (!target || !id || !target.fields.includes(field)) return { error: "This text cannot be changed from here." };
  const admin = createAdminClient();
  const { data: row } = await admin.from(target.table).select(`id, ${field}`).eq("id", id).maybeSingle();
  const current = (row as Record<string, unknown> | null)?.[field];
  if (typeof current !== "string") return { error: "The text was not found." };
  let next = replaceWord(current, word, replacement);
  if (!replacement) next = next.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim();
  if (next === current) return { text: current };
  const { error } = await admin.from(target.table).update({ [field]: next, updated_by: by }).eq("id", id);
  if (error) return { error: /lock|approved/i.test(error.message) ? "This document is locked (approved), so the text cannot be changed here. Keep it, or change it through a revision." : error.message };
  return { text: next };
}
