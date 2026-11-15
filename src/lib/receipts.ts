import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { logAppError } from "./app-errors";
import { notifyRoles } from "./notifications";
import { newUuid } from "./uuid";
import { dubaiDay, dueTag, laterDays, receiptNumberProblem, reminderDue, reminderWords, sameNumber, daysBetween } from "./receipt-rules";
import { countingNumber, paperworkBlock, paperworkDue, pendingTag, refCounts, refLabel, refNumberProblem, refTypesOf, refsOfRow, type Ref, type RefType } from "./receipt-refs";
import { getSettings } from "./settings";

/** 15 November 2026: the reference types (Invoice / Pre-payment parts invoice / WIP and any added), from Settings. */
export async function receiptRefTypes(): Promise<RefType[]> {
  return refTypesOf((await getSettings()).supplier_ref_types);
}
/** The columns for several references on a receipt (dormant until the database change is applied). */
export async function refsReady(): Promise<boolean> {
  return schemaReady("part_receipts", "refs, paperwork_pending");
}

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
  // Narrow by the last run of digits ("INV-E2E-1002" -> 1002), then compare as people type them (sameNumber).
  const digits = (number.match(/[0-9]+/g) ?? []).pop() ?? number.trim();
  const like = `%${digits}%`;
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

/**
 * `later` = "Arrived - paperwork pending" (no reference typed): any supplier since 15 November 2026 - the part is
 * recorded and handed over at once, the paperwork is due the same day (or within the supplier's "invoice later" days).
 */
export type ReceiptInput = { number: string; refType: string; later: boolean; noPaper: boolean; paper: File | null; sameOk: boolean };
/** Reads the receipt fields of a receive form (the ONE box, ReceiptInvoiceFields). */
export function receiptInputFrom(formData: FormData): ReceiptInput {
  const f = formData.get("receipt_paper");
  return {
    refType: String(formData.get("receipt_ref_type") ?? "invoice").trim() || "invoice",
    number: String(formData.get("receipt_invoice_number") ?? "").trim(),
    later: formData.get("receipt_invoice_later") === "1",
    noPaper: formData.get("receipt_no_paper") === "on" || formData.get("receipt_no_paper") === "1",
    paper: f instanceof File && f.size > 0 ? f : null,
    sameOk: formData.get("receipt_same_ok") === "on" || formData.get("receipt_same_ok") === "1",
  };
}

/** THE check before anything is received: a number, or the exception with its paper (or "No paper came"). */
export type ReceiptCheck = { error?: string; supplier?: SupplierFacts; due?: string | null; /** The reference saved (null = paperwork pending). */ ref?: Ref | null; /** It counts as the supplier's invoice. */ counts?: boolean };

export async function checkReceipt(input: ReceiptInput, poIds: string[]): Promise<ReceiptCheck> {
  if (!(await receiptsReady())) return {};
  const firstPo = poIds[0];
  if (!firstPo) return {};
  const sups = await Promise.all(poIds.map((id) => supplierOfPo(id)));
  const s = sups[0];
  if (!s) return { error: "That LPO was not found." };
  if (sups.some((x) => (x?.supplierId ?? x?.name) !== (s.supplierId ?? s.name))) return { error: "Receive one supplier at a time: each supplier's paper has its own invoice number." };
  const today = dubaiDay(Date.now());
  // 15 November 2026: "Arrived - paperwork pending" for EVERY supplier. Same working day for a normal supplier, the
  // supplier's own days for one marked "Invoice later allowed". The parts are recorded and can be handed over at once.
  if (input.later) {
    if (!input.paper && !input.noPaper) return { error: "Arrived - paperwork pending: add a photo of the delivery paper that came with the part, or tick \"No paper came\"." };
    return { supplier: s, due: paperworkDue(today, s.laterAllowed, s.laterDays), ref: null, counts: false };
  }
  const types = await receiptRefTypes();
  const typesOn = await refsReady();
  const type = typesOn && types.some((t) => t.key === input.refType) ? input.refType : "invoice";
  const label = refLabel(types, type);
  const bad = type === "invoice" ? receiptNumberProblem(input.number) : refNumberProblem(input.number, label);
  if (bad) return { error: `Not received: ${bad} Or press "Arrived - paperwork pending" to record the parts now and type the reference later today.` };
  const counts = refCounts(types, type) || !typesOn;
  if (counts) {
    const others = await lposWithNumber(s.supplierId, s.name, input.number, poIds);
    if (others.length && !input.sameOk) return { error: `${label} ${input.number} is already on ${others.join(", ")} for ${s.name}. Same invoice as ${others[0]}? Tick "Same invoice" and save again.` };
  }
  return { supplier: s, due: counts ? null : paperworkDue(today, s.laterAllowed, s.laterDays), ref: { type, number: input.number.trim() }, counts };
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
export async function saveReceipts(input: ReceiptInput, checked: ReceiptCheck, perPo: { poId: string; jobId: string | null; lines: { line_id: string | null; part_item_id: string | null; description: string; qty: number }[] }[], by: Staffish): Promise<string[]> {
  if (!(await receiptsReady()) || !checked.supplier) return [];
  const admin = createAdminClient();
  const ids: string[] = [];
  const now = new Date().toISOString();
  let paperDone = false;
  const typesOn = await refsReady();
  // THE number that counts as the supplier's invoice (null = the real invoice is still due: paperwork pending or WIP).
  const counting = !input.later && checked.counts !== false ? input.number : null;
  const pendingInvoice = !counting;
  for (const p of perPo) {
    if (!p.lines.length) continue;
    const others = counting && input.sameOk ? await lposWithNumber(checked.supplier.supplierId, checked.supplier.name, input.number, [p.poId]) : [];
    let samePo: string | null = null;
    if (others.length) {
      const { data } = await admin.from("purchase_orders").select("id").eq("number", others[0]).maybeSingle();
      samePo = (data?.id as string | undefined) ?? null;
    }
    const { data: r, error } = await admin.from("part_receipts").insert({
      po_id: p.poId, job_id: p.jobId, supplier_id: checked.supplier.supplierId, supplier_name: checked.supplier.name, lines: p.lines, received_at: now, received_by: by.id,
      invoice_number: counting, invoice_later: pendingInvoice, invoice_due_date: pendingInvoice ? checked.due ?? null : null, no_paper: input.later && input.noPaper,
      same_invoice_po_id: samePo, invoice_entered_at: counting ? now : null, invoice_entered_by: counting ? by.id : null, created_by: by.id, updated_by: by.id,
      ...(typesOn ? { refs: checked.ref ? [checked.ref] : [], paperwork_pending: input.later } : {}),
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
  /** 15 November 2026: every reference on the receipt (type, its words, number); none = "Arrived - paperwork pending". */
  refs: { type: string; label: string; number: string; counts: boolean }[]; pending: boolean;
  history: { old: string | null; new: string; old_type?: string | null; new_type?: string | null; by_name: string; at: string }[];
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
  const types = await receiptRefTypes();
  return rows.map((r) => {
    const po = poOf.get(String(r.po_id));
    const refs = refsOfRow(r as { refs?: unknown; invoice_number?: string | null });
    const due = (r.invoice_due_date as string | null) ?? null;
    const number = (r.invoice_number as string | null) ?? null;
    return {
      id: String(r.id), poId: String(r.po_id), poNumber: po?.number ?? "", jobId: (r.job_id as string | null) ?? null, supplierName: String(r.supplier_name ?? ""),
      lines: ((r.lines as { description: string; qty: number }[] | null) ?? []).map((l) => ({ description: String(l.description ?? ""), qty: Number(l.qty) || 0 })),
      receivedAt: String(r.received_at), receivedBy: r.received_by ? name.get(String(r.received_by)) ?? null : null,
      number, later: !!r.invoice_later, due, tag: !number && r.invoice_later ? pendingTag({ refs, due, today }) : null, overdue: !number && !!due && today > due, noPaper: !!r.no_paper,
      refs: refs.map((x) => ({ type: x.type, label: refLabel(types, x.type), number: x.number, counts: refCounts(types, x.type) })), pending: !refs.length,
      history: ((r.number_history as ReceiptView["history"] | null) ?? []),
      retakeAsked: r.retake_asked_at ? { at: String(r.retake_asked_at), by: r.retake_asked_by ? name.get(String(r.retake_asked_by)) ?? null : null, note: (r.retake_note as string | null) ?? null } : null,
      retakeDone: (r.retake_done_at as string | null) ?? null,
      files: fs.filter((f) => f.receipt_id === r.id).map((f) => ({ id: f.id, kind: f.kind, url: signed.get(f.path) ?? null, contentType: f.content_type, at: f.created_at, by: f.created_by ? name.get(f.created_by) ?? null : null, replacedAt: f.replaced_at, replacedBy: f.replaced_by ? name.get(f.replaced_by) ?? null : null })),
      invoiceChecked: !!po?.supplier_invoice_checked_at,
    };
  });
}

/**
 * Add a reference to a receipt, or change one (its type or its number). The parts desk only ADDS one to a delivery
 * recorded with none; accounts and the owner may add or change any (logged old -> new, type and number, who, when).
 * THE invoice number of the receipt follows: the first reference of a type that counts as the supplier's invoice. When it
 * counts, the reminders stop; when nothing counts any more (a type changed to WIP) the real invoice is due again.
 */
export async function setReceiptRef(receiptId: string, o: { type: string; number: string; replace: number | null; sameOk: boolean }, by: Staffish): Promise<{ error?: string; ok?: boolean; words?: string }> {
  const { mayCorrectNumber, mayTypeMissingNumber } = await import("./receipt-rules");
  const admin = createAdminClient();
  const typesOn = await refsReady();
  const { data: r } = await admin.from("part_receipts").select(`id, po_id, supplier_id, supplier_name, invoice_number, invoice_later, invoice_due_date, received_at, number_history${typesOn ? ", refs" : ""}`).eq("id", receiptId).eq("is_active", true).maybeSingle();
  if (!r) return { error: "That receipt was not found." };
  const row = r as unknown as Record<string, unknown>;
  const types = await receiptRefTypes();
  const type = typesOn && types.some((t) => t.key === o.type) ? o.type : "invoice";
  const label = refLabel(types, type);
  const refs = refsOfRow(row as { refs?: unknown; invoice_number?: string | null });
  const changing = o.replace !== null && o.replace >= 0 && o.replace < refs.length;
  const mayChange = mayCorrectNumber(by.role_id);
  if (changing || refs.length ? !mayChange : !mayTypeMissingNumber(by.role_id)) return { error: changing || refs.length ? "Only accounts or the owner can change or add a reference once one is saved." : "Only the parts desk, accounts or the owner can type the reference." };
  const number = o.number.trim();
  const bad = type === "invoice" ? receiptNumberProblem(number) : refNumberProblem(number, label);
  if (bad) return { error: bad };
  const before = changing ? refs[o.replace!] : null;
  if (before && before.type === type && sameNumber(before.number, number)) return { ok: true, words: "Nothing changed." };
  const counts = refCounts(types, type) || !typesOn;
  if (counts) {
    const others = await lposWithNumber((row.supplier_id as string | null) ?? null, String(row.supplier_name ?? ""), number, [String(row.po_id)]);
    if (others.length && !o.sameOk) return { error: `${label} ${number} is already on ${others.join(", ")} for ${row.supplier_name}. Same invoice as ${others[0]}? Tick "Same invoice" and save again.` };
  }
  const next: Ref[] = changing ? refs.map((x, i) => (i === o.replace ? { type, number } : x)) : [...refs, { type, number }];
  const invoiceNow = typesOn ? countingNumber(next, types) : number;
  const now = new Date().toISOString();
  const history = [...(((row.number_history as unknown[]) ?? []) as unknown[]), { old: before?.number ?? null, new: number, old_type: before ? refLabel(types, before.type) : null, new_type: label, by: by.id, by_name: by.display_name, at: now }];
  const patch: Record<string, unknown> = { invoice_number: invoiceNow, number_history: history, updated_by: by.id };
  if (typesOn) patch.refs = next;
  if (invoiceNow && !row.invoice_number) Object.assign(patch, { invoice_entered_at: now, invoice_entered_by: by.id });
  if (!invoiceNow) {
    // The real invoice is still (or again) due: same working day, or the supplier's own days.
    const s = await supplierOfPo(String(row.po_id));
    Object.assign(patch, { invoice_later: true, invoice_due_date: (row.invoice_due_date as string | null) ?? paperworkDue(dubaiDay(String(row.received_at)), !!s?.laterAllowed, s?.laterDays ?? 5) });
  }
  const { error } = await admin.from("part_receipts").update(patch).eq("id", receiptId);
  if (error) {
    logAppError("receipts.number", error, { staffId: by.id });
    return { error: "Couldn't save – nothing was recorded. Try again or tell the owner." };
  }
  if (before) return { ok: true, words: `Changed: ${refLabel(types, before.type)} ${before.number} → ${label} ${number} (${by.display_name}).${invoiceNow ? "" : " The supplier's real invoice is still due."}` };
  return { ok: true, words: counts ? `${label} ${number} saved: the reminders stop.` : `${label} ${number} saved. It does not count as the supplier's invoice: the real invoice is still due.` };
}

/** The invoice number typed later, or corrected (kept for older callers: an invoice-type reference). */
export async function setReceiptNumber(receiptId: string, number: string, sameOk: boolean, by: Staffish): Promise<{ error?: string; ok?: boolean; words?: string }> {
  const typesOn = await refsReady();
  const admin = createAdminClient();
  const { data: r } = await admin.from("part_receipts").select(`invoice_number${typesOn ? ", refs" : ""}`).eq("id", receiptId).maybeSingle();
  const refs = r ? refsOfRow(r as unknown as { refs?: unknown; invoice_number?: string | null }) : [];
  const at = refs.findIndex((x) => x.type === "invoice");
  return setReceiptRef(receiptId, { type: "invoice", number, replace: at >= 0 ? at : null, sameOk }, by);
}

/**
 * THE paperwork rule for closing (checking) and paying an LPO (15 November 2026): no delivery on it may still be
 * "Arrived - paperwork pending" with no reference typed. Dormant until the database change (it needs the pending flag).
 */
export async function paperworkBlockFor(poIds: string[]): Promise<string | null> {
  if (!poIds.length || !(await receiptsReady()) || !(await refsReady())) return null;
  const admin = createAdminClient();
  const [{ data: recs }, { data: pos }] = await Promise.all([
    admin.from("part_receipts").select("po_id, invoice_number, refs, paperwork_pending").in("po_id", poIds).eq("is_active", true).eq("paperwork_pending", true),
    admin.from("purchase_orders").select("id, number").in("id", poIds),
  ]);
  for (const p of (pos ?? []) as { id: string; number: string }[]) {
    const mine = ((recs ?? []) as unknown as { po_id: string; invoice_number: string | null; refs?: unknown; paperwork_pending: boolean }[]).filter((x) => x.po_id === p.id).map((x) => ({ poNumber: p.number, refs: refsOfRow(x), pending: !!x.paperwork_pending }));
    const words = paperworkBlock(mine);
    if (words) return words;
  }
  return null;
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
export async function receiptReminders(today = dubaiDay(Date.now()), hour = new Date(Date.now() + 4 * 3600000).getUTCHours()): Promise<number> {
  if (!(await receiptsReady())) return 0;
  const admin = createAdminClient();
  const { data } = await admin.from("part_receipts").select("id, po_id, job_id, supplier_name, received_at, invoice_due_date, invoice_number, invoice_later, reminded_day3_at, reminded_day5_at, last_reminded_on, is_active").is("invoice_number", null).eq("invoice_later", true).eq("is_active", true);
  let n = 0;
  for (const r of (data ?? []) as { id: string; po_id: string; job_id: string | null; supplier_name: string | null; received_at: string; invoice_due_date: string | null; invoice_number: string | null; invoice_later: boolean; reminded_day3_at: string | null; reminded_day5_at: string | null; last_reminded_on: string | null; is_active: boolean }[]) {
    const step = reminderDue(r, today);
    if (!step) continue;
    // 15 November 2026: the overdue reminder is a MORNING one (from 07:00 Dubai), once a day.
    if (step === "overdue" && hour < 7) continue;
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

/**
 * 15 November 2026: THE owner's daily summary line - deliveries whose supplier paperwork (or real invoice) is overdue.
 * Once a day at the evening summary hour, only when there is something to count. nowMs lets a test move the clock.
 */
export async function paperworkOwnerSummary(nowMs = Date.now()): Promise<number> {
  const { SUMMARY_HOUR, dubaiClock } = await import("./password-alert-rules");
  const { hour, dayStartIso } = dubaiClock(nowMs);
  if (hour < SUMMARY_HOUR) return 0;
  const open = (await invoicesNotReceived()).filter((r) => r.overdue);
  if (!open.length) return 0;
  const admin = createAdminClient();
  const { data: owners } = await admin.from("staff").select("id").eq("role_id", "owner").eq("is_active", true);
  const ids = ((owners ?? []) as { id: string }[]).map((o) => o.id);
  if (!ids.length) return 0;
  const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("type", "paperwork_pending_count").in("staff_id", ids).gte("created_at", dayStartIso);
  if ((count ?? 0) > 0) return 0;
  const { notifyStaff } = await import("./notifications");
  const lpos = Array.from(new Set(open.map((r) => r.poNumber)));
  await notifyStaff(ids, { type: "paperwork_pending_count", title: `${open.length} deliver${open.length === 1 ? "y" : "ies"} with supplier paperwork overdue`, body: `Parts received and handed over, the supplier's reference or invoice not typed yet: ${lpos.slice(0, 10).join(", ")}${lpos.length > 10 ? "…" : ""}. The parts desk and accounts are reminded every morning.`, href: "/supplier-invoices" });
  return open.length;
}

/** For the receive forms: per LPO, its supplier, when paperwork pending would be due ("today" or a date) and the reference types. */
export async function receiptPropsFor(poIds: string[]): Promise<Record<string, { supplier: SupplierFacts; dueOn: string | null; types: RefType[] | null }> | null> {
  if (!(await receiptsReady())) return null;
  const out: Record<string, { supplier: SupplierFacts; dueOn: string | null; types: RefType[] | null }> = {};
  const today = dubaiDay(Date.now());
  const types = (await refsReady()) ? await receiptRefTypes() : null;
  for (const id of Array.from(new Set(poIds))) {
    const s = await supplierOfPo(id);
    if (!s) continue;
    const due = paperworkDue(today, s.laterAllowed, s.laterDays);
    out[id] = { supplier: s, types, dueOn: due === today ? "today" : new Date(`${due}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) };
  }
  return out;
}

/** The words after a delivery is recorded (both receive doors). */
export async function receiptSavedWords(input: ReceiptInput, c: ReceiptCheck): Promise<string> {
  if (!c.supplier) return "";
  const today = dubaiDay(Date.now());
  const when = c.due === today ? "by the end of today" : `by ${c.due ?? ""}`;
  if (input.later) return ` ARRIVED - PAPERWORK PENDING: the parts can be issued now; the supplier's reference is due ${when} (the parts desk and accounts are reminded).`;
  const label = c.ref ? refLabel(await receiptRefTypes(), c.ref.type) : "Invoice";
  if (c.counts === false) return ` ${label} ${input.number} recorded. It does not count as the supplier's invoice: the real invoice is due ${when}.`;
  return ` ${label} ${input.number} recorded.`;
}
