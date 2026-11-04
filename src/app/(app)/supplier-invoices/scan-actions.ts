"use server";

import { getCurrentStaff } from "@/lib/auth";
import { ocrInvoiceFacts } from "@/lib/import-ocr";
import { readPdfRows, renderPdfPages } from "@/lib/pdf-read";
import { invoiceDateIso, invoiceFacts, parseNumber, type InvoiceFacts } from "@/lib/price-import";
import { createAdminClient } from "@/lib/supabase/admin";
import { JOB_FILES_BUCKET } from "@/lib/work-data";

export type ReadScanResult = { facts?: InvoiceFacts; source?: "text" | "ocr"; file?: string; error?: string };

/**
 * "Read the scan" (4 November 2026): the newest invoice file on the LPO is read and the fields pre-filled -
 * number, date, gross, discount, before VAT, VAT, net total. A PDF with its own words is read directly; a
 * camera scan (pictures in a PDF, no words) goes through the OCR reader. Accounts check every figure before
 * saving - the reader only types for them.
 */
export async function readInvoiceScanAction(poId: string): Promise<ReadScanResult> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !["owner", "accounts"].includes(staff.role_id)) return { error: "Supplier invoices are read and entered by accounts (or the owner)." };
  const admin = createAdminClient();
  const [{ data: po }, { data: files }] = await Promise.all([
    admin.from("purchase_orders").select("id, supplier_invoice_path").eq("id", poId).maybeSingle(),
    admin.from("job_files").select("storage_path, content_type, caption, created_at").eq("kind", "supplier_invoice").eq("ref_id", poId).is("removed_at", null).order("created_at", { ascending: false }).limit(1),
  ]);
  if (!po) return { error: "That LPO no longer exists." };
  const newest = (files ?? [])[0] ?? null;
  const path = (newest?.storage_path as string | undefined) ?? (po.supplier_invoice_path as string | null) ?? null;
  if (!path) return { error: "No scan or photo on this LPO yet: press Scan document first." };
  const { data: blob, error: dlErr } = await admin.storage.from(JOB_FILES_BUCKET).download(path);
  if (dlErr || !blob) return { error: "The scan could not be opened just now. Try again." };
  const buf = Buffer.from(await blob.arrayBuffer());
  const isPdf = /\.pdf$/i.test(path) || /pdf/i.test(String(newest?.content_type ?? ""));
  const fileName = (newest?.caption as string | null) ?? path.split("/").pop() ?? "scan";
  try {
    if (isPdf) {
      const read = await readPdfRows(buf);
      const facts = invoiceFacts(read.text);
      // A PDF with real words and at least one fact found: the text is the truth, no OCR needed.
      if (read.text.replace(/\s+/g, "").length > 60 && (facts.number || facts.net !== null || facts.beforeVat !== null)) return { facts, source: "text", file: fileName };
      // A camera scan: pictures in a PDF, no words. The first page goes through the OCR reader.
      const pages = await renderPdfPages(buf, 1);
      if (!pages.length) return { error: "The scan has no readable page. Type the figures from the paper." };
      return await ocrFacts(pages[0], "image/png", fileName);
    }
    return await ocrFacts(buf, String(newest?.content_type ?? "image/jpeg"), fileName);
  } catch {
    return { error: "The scan could not be read. Type the figures from the paper." };
  }
}

async function ocrFacts(data: Uint8Array | Buffer, mediaType: string, fileName: string): Promise<ReadScanResult> {
  const r = await ocrInvoiceFacts(data, mediaType);
  if (!r.facts) return { error: r.error ?? "The scan could not be read. Type the figures from the paper." };
  const f = r.facts;
  const money = (s: string) => (s ? parseNumber(s) : null);
  const facts: InvoiceFacts = {
    number: f.invoice_number ? f.invoice_number.toUpperCase().slice(0, 25) : null,
    date: invoiceDateIso(f.invoice_date),
    gross: money(f.gross),
    discount: money(f.discount),
    beforeVat: money(f.before_vat),
    vat: money(f.vat),
    net: money(f.net_total),
  };
  if (facts.beforeVat !== null && facts.vat !== null && facts.net === null) facts.net = Math.round((facts.beforeVat + facts.vat) * 100) / 100;
  if (facts.net !== null && facts.vat !== null && facts.beforeVat === null) facts.beforeVat = Math.round((facts.net - facts.vat) * 100) / 100;
  return { facts, source: "ocr", file: fileName };
}
