import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { logAppError } from "./app-errors";
import { notifyRoles } from "./notifications";
import { newUuid } from "./uuid";
import { addDays, dubaiDay, dueTag, laterDays, receiptNumberProblem, reminderDue, reminderWords, sameNumber, daysBetween } from "./receipt-rules";

/*
 * THE SUPPLIER'S INVOICE NUMBER AT RECEIVING (13 November 2026, URGENT). Every delivery received is a receipt
 * (part_receipts): what arrived, when, who, and the supplier's invoice number. The number is compulsory, unless the
 * supplier is marked "Invoice later allowed" (owner or accounts, at most 5 days): the receipt is then "INVOICE DUE BY
 * <date>" with the delivery paper's photo or "No paper came", and the parts desk and accounts are reminded on day 3,
 * day 5 and every day while overdue. Files are never deleted: a retake adds a new file, the old one keeps who replaced it.
 * Accounts still scan and check the invoice on Supplier invoices (the number typed here pre-fills it).
 */

export const RECEIPTS_BUCKET = "job-files";
export type Staffish = { id: string; display_name: string; role_id: string };

export async function receiptsReady(): Promise<boolean> {
  return (await schemaReady("part_receipts", "id, invoice_number, invoice_later, invoice_due_date, lines")) && (await schemaReady("receipt_files", "id, receipt_id, kind, path"));
}

export type SupplierFacts = { supplierId: string | null; name: string; laterAllowed: boolean; laterDays: number };
/** The supplier of an LPO and whether its invoice may come later. */
export async function supplierOfPo(poId: string): Promise<SupplierFacts | null> {
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("supplier_id, supplier_name").eq("id", poId).maybeSingle();
  if (!po) return null;
  let laterAllowed = false;
  let days = 5;
  if (po.supplier_id && (await receiptsReady())) {
    const { data: s } = await admin.from("suppliers").select("invoice_later_allowed, invoice_later_days").eq("id", String(po.supplier_id)).maybeSingle();
    laterAllowed = !!s?.invoice_later_allowed;
    days = laterDays(s?.invoice_later_days as number | null | undefined);
  }
  return { supplierId: (po.supplier_id as string | null) ?? null, name: String(po.supplier_name ?? ""), laterAllowed, laterDays: days };
}

/** Other LPOs of this supplier already carrying this invoice number ("Same invoice as LPO-…?"). */
export async function lposWithNumber(supplierId: string | null, supplierName: string, number: string, exceptPoIds: string[]): Promise<string[]> {
  if (!number.trim()) return [];
  const admin = createAdminClient();
  const out = new Set<string>();
  const compact = number.replace(/[^A-Za-z0-9]/g, "");
  const like = `%${compact.slice(-6)}%`;
  const [{ data: pos }, { data: recs }] = await Promise.all([
    supplierId
      ? admin.from("purchase_orders").select("id, number, supplier_invoice_number").eq("supplier_id", supplierId).ilike("supplier_invoice_number", like).eq("is_active", true)
      : admin.from("purchase_orders").select("id, number, supplier_invoice_number").ilike("supplier_name", supplierName).ilike("supplier_invoice_number", like).eq("is_active", true),
    (await receiptsReady()) ? admin.from("part_receipts").select("po_id, invoice_number, supplier_id, supplier_name").ilike("invoice_number", like).eq("is_active", true) : Promise.resolve({ data: [] as { po_id: string; invoice_number: string; supplier_id: string | null; supplier_name: string | null }[] }),
  ]);
  for (const p of (pos ?? []) as { id: string; number: string; supplier_invoice_number: string | null }[]) if (!exceptPoIds.includes(p.id) && sameNumber(p.supplier_invoice_number, number)) out.add(p.number);
  const recPoIds = ((recs ?? []) as { po_id: string; invoice_number: string; supplier_id: string | null; supplier_name: string | null }[])
    .filter((r) => !exceptPoIds.includes(r.po_id) && sameNumber(r.invoice_number, number) && (supplierId ? r.supplier_id === supplierId : (r.supplier_name ?? "").toLowerCase() === supplierName.toLowerCase()))
    .map((r) => r.po_id);
  if (recPoIds.length) {
    const { data: rp } = await admin.from("purchase_orders").select("number").in("id", recPoIds);
    for (const p of (rp ?? []) as { number: string }[]) out.add(p.number);
  }
  return Array.from(out).sort();
}

export type ReceiptInput = { number: string; later: boolean; noPaper: boolean; paper: File | null; sameOk: boolean };
/** Reads the receipt fields of a receive form (the ONE box, ReceiptInvoiceFields). */
export function receiptInputFrom(formData: FormData): ReceiptInput {
  const f = formData.get("receipt_paper");
  return {
    number: String(formData.get("receipt_invoice_number") ?? "").trim(),
    later: formData.get("receipt_invoice_later") === "1",
    noPaper: formData.get("receipt_no_paper") === "on" || formData.get("receipt_no_paper") === "1",
    paper: f instanceof File && f.size > 0 ? f : null,
    sameOk: formData.get("receipt_same_ok") === "on" || formData.get("receipt_same_ok") === "1",
  };
}

/** THE check before anything is received: a number, or the exception with its paper (or "No paper came"). */
export async function checkReceipt(input: ReceiptInput, poIds: string[]): Promise<{ error?: string; supplier?: SupplierFacts; due?: string | null }> {
  if (!(await receiptsReady())) return {};
  const firstPo = poIds[0];
  if (!firstPo) return {};
  const sups = await Promise.all(poIds.map((id) => supplierOfPo(id)));
  const s = sups[0];
  if (!s) return { error: "That LPO was not found." };
  if (sups.some((x) => (x?.supplierId ?? x?.name) !== (s.supplierId ?? s.name))) return { error: "Receive one supplier at a time: each supplier's paper has its own invoice number." };
  if (input.later) {
    if (!s.laterAllowed) return { error: `${s.name} is not marked "Invoice later allowed": type the supplier's invoice number (ask accounts or the owner to mark the supplier).` };
    if (!input.paper && !input.noPaper) return { error: "Invoice comes later: add a photo of the delivery paper that came with the part, or tick \"No paper came\"." };
    return { supplier: s, due: addDays(dubaiDay(Date.now()), s.laterDays) };
  }
  const bad = receiptNumberProblem(input.number);
  if (bad) return { error: `Not received: ${bad}${s.laterAllowed ? ` Or press "Invoice comes later" (${s.name} may send it within ${s.laterDays} day${s.laterDays === 1 ? "" : "s"}).` : ""}` };
  const others = await lposWithNumber(s.supplierId, s.name, input.number, poIds);
  if (others.length && !input.sameOk) return { error: `Invoice ${input.number} is already on ${others.join(", ")} for ${s.name}. Same invoice as ${others[0]}? Tick "Same invoice" and save again.` };
  return { supplier: s, due: null };
}

async function storeFile(receiptId: string, kind: "paper" | "invoice", file: File, by: string): Promise<string | null> {
  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `receipts/${receiptId}/${kind}-${newUuid()}.${ext}`;
  const { error } = await admin.storage.from(RECEIPTS_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) {
    logAppError("receipts.upload", error, { staffId: by, detail: { receiptId, kind } });
    return null;
  }
  const { error: rowErr } = await admin.from("receipt_files").insert({ receipt_id: receiptId, kind, path, content_type: file.type || null, created_by: by, updated_by: by });
  if (rowErr) {
    logAppError("receipts.file-row", rowErr, { staffId: by, detail: { receiptId, kind } });
    return null;
  }
  return path;
}

/** Saves one receipt per LPO received now (the same number on each when one paper covered several LPOs). */
export async function saveReceipts(input: ReceiptInput, checked: { supplier?: SupplierFacts; due?: string | null }, perPo: { poId: string; jobId: string | null; lines: { line_id: string | null; part_item_id: string | null; description: string; qty: number }[] }[], by: Staffish): Promise<string[]> {
  if (!(await receiptsReady()) || !checked.supplier) return [];
  const admin = createAdminClient();
  const ids: string[] = [];
  const now = new Date().toISOString();
  let paperDone = false;
  for (const p of perPo) {
    if (!p.lines.length) continue;
    const others = !input.later && input.sameOk ? await lposWithNumber(checked.supplier.supplierId, checked.supplier.name, input.number, [p.poId]) : [];
    let samePo: string | null = null;
    if (others.length) {
      const { data } = await admin.from("purchase_orders").select("id").eq("number", others[0]).maybeSingle();
      samePo = (data?.id as string | undefined) ?? null;
    }
    const { data: r, error } = await admin.from("part_receipts").insert({
      po_id: p.poId, job_id: p.jobId, supplier_id: checked.supplier.supplierId, supplier_name: checked.supplier.name, lines: p.lines, received_at: now, received_by: by.id,
      invoice_number: input.later ? null : input.number, invoice_later: input.later, invoice_due_date: input.later ? checked.due ?? null : null, no_paper: input.later && input.noPaper,
      same_invoice_po_id: samePo, invoice_entered_at: input.later ? null : now, invoice_entered_by: input.later ? null : by.id, created_by: by.id, updated_by: by.id,
    }).select("id").single();
    if (error || !r) {
      logAppError("receipts.save", error ?? new Error("no row"), { staffId: by.id, detail: { poId: p.poId } });
      continue;
    }
    ids.push(String(r.id));
    if (input.paper && !paperDone) {
      await storeFile(String(r.id), "paper", input.paper, by.id);
      paperDone = true;
    }
  }
  return ids;
}

export type ReceiptFile = { id: string; kind: "paper" | "invoice"; url: string | null; contentType: string | null; at: string; by: string | null; replacedAt: string | null; replacedBy: string | null };
export type ReceiptView = {
  id: string; poId: string; poNumber: string; jobId: string | null; supplierName: string; lines: { description: string; qty: number }[];
  receivedAt: string; receivedBy: string | null; number: string | null; later: boolean; due: string | null; tag: string | null; overdue: boolean; noPaper: boolean;
  history: { old: string | null; new: string; by_name: string; at: string }[];
  retakeAsked: { at: string; by: string | null; note: string | null } | null; retakeDone: string | null;
  files: ReceiptFile[]; invoiceChecked: boolean;
};

/** The receipts of some LPOs (the LPO page, the Supplier invoices card), newest first, with their files and history. */
export async function loadReceipts(poIds: string[]): Promise<ReceiptView[]> {
  if (!poIds.length || !(await receiptsReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("part_receipts").select("*").in("po_id", poIds).eq("is_active", true).order("received_at", { ascending: false });
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];
  const [{ data: files }, { data: pos }] = await Promise.all([
    admin.from("receipt_files").select("id, receipt_id, kind, path, content_type, created_at, created_by, replaced_at, replaced_by").in("receipt_id", rows.map((r) => String(r.id))).eq("is_active", true).order("created_at", { ascending: false }),
    admin.from("purchase_orders").select("id, number, supplier_invoice_checked_at").in("id", poIds),
  ]);
  const fs = (files ?? []) as { id: string; receipt_id: string; kind: "paper" | "invoice"; path: string; content_type: string | null; created_at: string; created_by: string | null; replaced_at: string | null; replaced_by: string | null }[];
  const staffIds = Array.from(new Set([...rows.flatMap((r) => [r.received_by, r.retake_asked_by]), ...fs.flatMap((f) => [f.created_by, f.replaced_by])].filter((x): x is string => typeof x === "string")));
  const { data: staff } = staffIds.length ? await admin.from("staff").select("id, display_name").in("id", staffIds) : { data: [] };
  const name = new Map(((staff ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const signed = new Map<string, string>();
  if (fs.length) {
    const { data: urls } = await admin.storage.from(RECEIPTS_BUCKET).createSignedUrls(fs.map((f) => f.path), 3600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const poOf = new Map(((pos ?? []) as { id: string; number: string; supplier_invoice_checked_at: string | null }[]).map((p) => [p.id, p]));
  const today = dubaiDay(Date.now());
  return rows.map((r) => {
    const po = poOf.get(String(r.po_id));
    const due = (r.invoice_due_date as string | null) ?? null;
    const number = (r.invoice_number as string | null) ?? null;
    return {
      id: String(r.id), poId: String(r.po_id), poNumber: po?.number ?? "", jobId: (r.job_id as string | null) ?? null, supplierName: String(r.supplier_name ?? ""),
      lines: ((r.lines as { description: string; qty: number }[] | null) ?? []).map((l) => ({ description: String(l.description ?? ""), qty: Number(l.qty) || 0 })),
      receivedAt: String(r.received_at), receivedBy: r.received_by ? name.get(String(r.received_by)) ?? null : null,
      number, later: !!r.invoice_later, due, tag: !number && r.invoice_later ? dueTag(due) : null, overdue: !number && !!due && today > due, noPaper: !!r.no_paper,
      history: ((r.number_history as ReceiptView["history"] | null) ?? []),
      retakeAsked: r.retake_asked_at ? { at: String(r.retake_asked_at), by: r.retake_asked_by ? name.get(String(r.retake_asked_by)) ?? null : null, note: (r.retake_note as string | null) ?? null } : null,
      retakeDone: (r.retake_done_at as string | null) ?? null,
      files: fs.filter((f) => f.receipt_id === r.id).map((f) => ({ id: f.id, kind: f.kind, url: signed.get(f.path) ?? null, contentType: f.content_type, at: f.created_at, by: f.created_by ? name.get(f.created_by) ?? null : null, replacedAt: f.replaced_at, replacedBy: f.replaced_by ? name.get(f.replaced_by) ?? null : null })),
      invoiceChecked: !!po?.supplier_invoice_checked_at,
    };
  });
}

/** The number typed later (clears the reminders), or corrected by accounts (logged old → new). */
export async function setReceiptNumber(receiptId: string, number: string, sameOk: boolean, by: Staffish): Promise<{ error?: string; ok?: boolean; words?: string }> {
  const { mayCorrectNumber, mayTypeMissingNumber } = await import("./receipt-rules");
  const admin = createAdminClient();
  const { data: r } = await admin.from("part_receipts").select("id, po_id, supplier_id, supplier_name, invoice_number, number_history").eq("id", receiptId).eq("is_active", true).maybeSingle();
  if (!r) return { error: "That receipt was not found." };
  const old = (r.invoice_number as string | null) ?? null;
  if (old ? !mayCorrectNumber(by.role_id) : !mayTypeMissingNumber(by.role_id)) return { error: old ? "Only accounts or the owner can correct an invoice number." : "Only the parts desk, accounts or the owner can type the invoice number." };
  const bad = receiptNumberProblem(number);
  if (bad) return { error: bad };
  if (old && sameNumber(old, number)) return { ok: true, words: "Nothing changed." };
  const others = await lposWithNumber((r.supplier_id as string | null) ?? null, String(r.supplier_name ?? ""), number, [String(r.po_id)]);
  if (others.length && !sameOk) return { error: `Invoice ${number.trim()} is already on ${others.join(", ")} for ${r.supplier_name}. Same invoice as ${others[0]}? Tick "Same invoice" and save again.` };
  const now = new Date().toISOString();
  const history = [...(((r.number_history as unknown[]) ?? []) as unknown[]), { old, new: number.trim(), by: by.id, by_name: by.display_name, at: now }];
  const { error } = await admin.from("part_receipts").update({ invoice_number: number.trim(), invoice_entered_at: now, invoice_entered_by: by.id, number_history: history, updated_by: by.id }).eq("id", receiptId);
  if (error) {
    logAppError("receipts.number", error, { staffId: by.id });
    return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  }
  return { ok: true, words: old ? `Invoice number corrected: ${old} → ${number.trim()} (${by.display_name}).` : `Invoice number ${number.trim()} saved: the reminders stop.` };
}

/** "Retake photo" / "Scan again": a new file; the old one stays in the history with who replaced it and when. */
export async function replaceReceiptFile(receiptId: string, kind: "paper" | "invoice", file: File, by: Staffish): Promise<{ error?: string; ok?: boolean; words?: string }> {
  const { mayReplaceFile } = await import("./receipt-rules");
  const admin = createAdminClient();
  const { data: r } = await admin.from("part_receipts").select("id, po_id, retake_asked_at, retake_done_at").eq("id", receiptId).eq("is_active", true).maybeSingle();
  if (!r) return { error: "That receipt was not found." };
  const { data: po } = await admin.from("purchase_orders").select("supplier_invoice_checked_at").eq("id", String(r.po_id)).maybeSingle();
  if (!mayReplaceFile(by.role_id, kind, !!po?.supplier_invoice_checked_at)) return { error: by.role_id === "parts" ? "Accounts have checked this invoice: only accounts or the owner can replace the photo now." : "Only accounts or the owner can replace this file." };
  if (!file.size) return { error: "Take or choose the photo first." };
  const now = new Date().toISOString();
  const { data: before } = await admin.from("receipt_files").select("id").eq("receipt_id", receiptId).eq("kind", kind).is("replaced_at", null).eq("is_active", true);
  const path = await storeFile(receiptId, kind, file, by.id);
  if (!path) return { error: "Couldn't save the photo – nothing was changed. Try again." };
  const oldIds = ((before ?? []) as { id: string }[]).map((b) => b.id);
  if (oldIds.length) await admin.from("receipt_files").update({ replaced_at: now, replaced_by: by.id, updated_by: by.id }).in("id", oldIds);
  if (kind === "paper" && r.retake_asked_at && !r.retake_done_at) await admin.from("part_receipts").update({ retake_done_at: now, updated_by: by.id }).eq("id", receiptId);
  return { ok: true, words: `${kind === "paper" ? "Delivery paper" : "Invoice"} replaced by ${by.display_name}. The old file stays in the history.` };
}

/** "Photo unclear - ask Parts to retake": back to the parts desk with a note (it shows on their dashboard until done). */
export async function askRetake(receiptId: string, note: string, by: Staffish): Promise<{ error?: string; ok?: boolean; words?: string }> {
  if (by.role_id !== "owner" && by.role_id !== "accounts") return { error: "Only accounts or the owner can send a photo back." };
  const admin = createAdminClient();
  const { data: r } = await admin.from("part_receipts").select("id, po_id, supplier_name").eq("id", receiptId).maybeSingle();
  if (!r) return { error: "That receipt was not found." };
  const { error } = await admin.from("part_receipts").update({ retake_asked_at: new Date().toISOString(), retake_asked_by: by.id, retake_note: note.trim() || null, retake_done_at: null, updated_by: by.id }).eq("id", receiptId);
  if (error) return { error: "Couldn't save – nothing was recorded. Try again." };
  const { data: po } = await admin.from("purchase_orders").select("number, job_id").eq("id", String(r.po_id)).maybeSingle();
  await notifyRoles(["parts"], { type: "supplier_invoice_missing", title: `Retake the delivery photo · ${po?.number ?? ""}`, body: `${by.display_name}: the photo is unclear${note.trim() ? ` (${note.trim()})` : ""}. Take it again on the LPO.`, jobId: (po?.job_id as string | null) ?? null, href: `/parts/orders/${r.po_id}#receipts` });
  return { ok: true, words: "Sent back to the parts desk: it shows on their dashboard until they retake it." };
}

export type OpenReceipt = { id: string; poId: string; poNumber: string; supplierName: string; receivedAt: string; due: string | null; tag: string; overdue: boolean; daysLate: number };
/** "Invoices not received (n)": invoice-later receipts with no number yet, oldest first, overdue marked. */
export async function invoicesNotReceived(): Promise<OpenReceipt[]> {
  if (!(await receiptsReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("part_receipts").select("id, po_id, supplier_name, received_at, invoice_due_date").is("invoice_number", null).eq("invoice_later", true).eq("is_active", true).order("received_at");
  const rows = (data ?? []) as { id: string; po_id: string; supplier_name: string | null; received_at: string; invoice_due_date: string | null }[];
  if (!rows.length) return [];
  const { data: pos } = await admin.from("purchase_orders").select("id, number").in("id", rows.map((r) => r.po_id));
  const num = new Map(((pos ?? []) as { id: string; number: string }[]).map((p) => [p.id, p.number]));
  const today = dubaiDay(Date.now());
  return rows.map((r) => ({ id: r.id, poId: r.po_id, poNumber: num.get(r.po_id) ?? "", supplierName: r.supplier_name ?? "", receivedAt: r.received_at, due: r.invoice_due_date, tag: dueTag(r.invoice_due_date), overdue: !!r.invoice_due_date && today > r.invoice_due_date, daysLate: r.invoice_due_date ? Math.max(0, daysBetween(r.invoice_due_date, today)) : 0 }));
}

/** "Older receipts without an invoice (n)": LPOs received before receipts existed, still with no invoice - never reminded. */
export async function olderWithoutInvoice(): Promise<{ poId: string; poNumber: string; supplierName: string; receivedAt: string | null }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("purchase_orders").select("id, number, supplier_name, received_at, status").in("status", ["received", "partly_received"]).neq("supplier_invoice_status", "received").eq("is_active", true).order("received_at");
  const rows = (data ?? []) as { id: string; number: string; supplier_name: string | null; received_at: string | null }[];
  if (!rows.length) return [];
  if (!(await receiptsReady())) return rows.map((r) => ({ poId: r.id, poNumber: r.number, supplierName: r.supplier_name ?? "", receivedAt: r.received_at }));
  const { data: recs } = await admin.from("part_receipts").select("po_id").in("po_id", rows.map((r) => r.id)).eq("is_active", true);
  const withReceipt = new Set(((recs ?? []) as { po_id: string }[]).map((r) => r.po_id));
  return rows.filter((r) => !withReceipt.has(r.id)).map((r) => ({ poId: r.id, poNumber: r.number, supplierName: r.supplier_name ?? "", receivedAt: r.received_at }));
}

/** "Photos to retake (n)" for the parts desk. */
export async function retakesAsked(): Promise<{ id: string; poId: string; poNumber: string; note: string | null; at: string }[]> {
  if (!(await receiptsReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("part_receipts").select("id, po_id, retake_note, retake_asked_at").not("retake_asked_at", "is", null).is("retake_done_at", null).eq("is_active", true).order("retake_asked_at");
  const rows = (data ?? []) as { id: string; po_id: string; retake_note: string | null; retake_asked_at: string }[];
  if (!rows.length) return [];
  const { data: pos } = await admin.from("purchase_orders").select("id, number").in("id", rows.map((r) => r.po_id));
  const num = new Map(((pos ?? []) as { id: string; number: string }[]).map((p) => [p.id, p.number]));
  return rows.map((r) => ({ id: r.id, poId: r.po_id, poNumber: num.get(r.po_id) ?? "", note: r.retake_note, at: r.retake_asked_at }));
}

/** The reminders (hourly job): day 3, day 5, then every day while overdue - the parts desk and accounts. `today` lets a test move the date. */
export async function receiptReminders(today = dubaiDay(Date.now())): Promise<number> {
  if (!(await receiptsReady())) return 0;
  const admin = createAdminClient();
  const { data } = await admin.from("part_receipts").select("id, po_id, job_id, supplier_name, received_at, invoice_due_date, invoice_number, invoice_later, reminded_day3_at, reminded_day5_at, last_reminded_on, is_active").is("invoice_number", null).eq("invoice_later", true).eq("is_active", true);
  let n = 0;
  for (const r of (data ?? []) as { id: string; po_id: string; job_id: string | null; supplier_name: string | null; received_at: string; invoice_due_date: string | null; invoice_number: string | null; invoice_later: boolean; reminded_day3_at: string | null; reminded_day5_at: string | null; last_reminded_on: string | null; is_active: boolean }[]) {
    const step = reminderDue(r, today);
    if (!step) continue;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { last_reminded_on: today };
    if (step === "day3") patch.reminded_day3_at = now;
    if (step === "day5") patch.reminded_day5_at = now;
    const { data: claimed } = await admin.from("part_receipts").update(patch).eq("id", r.id).is("invoice_number", null).select("id");
    if (!(claimed ?? []).length) continue;
    const { data: po } = await admin.from("purchase_orders").select("number").eq("id", r.po_id).maybeSingle();
    const w = reminderWords(step, r.supplier_name ?? "The supplier", String(po?.number ?? ""), r.invoice_due_date, today);
    await notifyRoles(["parts", "accounts"], { type: "supplier_invoice_missing", title: w.title, body: w.body, jobId: r.job_id, href: `/parts/orders/${r.po_id}#receipts` });
    n++;
  }
  return n;
}

/** For the receive forms: per LPO, its supplier and the day an "invoice later" would be due (null until the update). */
export async function receiptPropsFor(poIds: string[]): Promise<Record<string, { supplier: SupplierFacts; dueOn: string | null }> | null> {
  if (!(await receiptsReady())) return null;
  const out: Record<string, { supplier: SupplierFacts; dueOn: string | null }> = {};
  const today = dubaiDay(Date.now());
  for (const id of Array.from(new Set(poIds))) {
    const s = await supplierOfPo(id);
    if (!s) continue;
    const due = addDays(today, s.laterDays);
    out[id] = { supplier: s, dueOn: s.laterAllowed ? new Date(`${due}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null };
  }
  return out;
}
