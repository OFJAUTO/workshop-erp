"use client";

import { useState, useTransition } from "react";
import { LinePrices } from "@/app/(app)/parts/orders/[id]/PoForms";
import { SupplierInvoiceBox } from "@/components/SupplierInvoiceBox";
import { Button, Input } from "@/components/ui";
import type { InvoiceFacts } from "@/lib/price-import";
import { readInvoiceScanAction } from "./scan-actions";

/**
 * Accounts enter a waiting supplier invoice (4 November 2026): scan the paper (the box's own "Scan
 * document" straightens and cleans it into one PDF), press "Read the scan" to pre-fill the number, the
 * date and the figures, check or correct them (a remark when the paper differs from the LPO), and save.
 * Then Mark checked sends the bill to Zoho as always.
 */
export function ScanEnterInvoice({ poId, rowKey, jobId, poTotal, lines = [], action, lpoDate = null, noCarUploads = false, typedNumber = null }: { /** 13 November 2026: the number the parts desk typed at receiving. */ typedNumber?: string | null; poId: string; rowKey: string; jobId: string | null; poTotal: number | null; lpoDate?: string | null; noCarUploads?: boolean; /** The LPO's lines, so the invoice's own price per line can be typed with it. */ lines?: { id: string; description: string; unit_cost: number }[]; action: (formData: FormData) => void }) {
  void rowKey;
  const [facts, setFacts] = useState<(InvoiceFacts & { key: number; source: string; file: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, start] = useTransition();
  const money = (n: number | null) => (n === null ? "—" : `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const addsUp = facts && facts.beforeVat !== null && facts.vat !== null && facts.net !== null ? Math.abs(facts.beforeVat + facts.vat - facts.net) <= 0.02 : null;

  function read() {
    setError(null);
    start(async () => {
      const r = await readInvoiceScanAction(poId);
      if (!r.facts) {
        setError(r.error ?? "The scan could not be read.");
        return;
      }
      setFacts({ ...r.facts, key: Date.now(), source: r.source ?? "text", file: r.file ?? "the scan" });
    });
  }

  return (
    <form action={action} className="flex flex-col gap-2 rounded-card border-2 border-ink bg-white p-3" data-si-enter>
      <span className="text-sm font-extrabold uppercase tracking-[0.08em]">Scan &amp; enter the invoice</span>
      <p className="text-xs text-muted">Collect the supplier&apos;s paper from Parts, press <b>Scan document</b> below (it straightens and cleans the pages into one PDF), then <b>Read the scan</b> to pre-fill the figures. Check every figure against the paper before saving.</p>
      <SupplierInvoiceBox jobId={jobId} poId={poId} poTotal={poTotal} lpoDate={lpoDate} noCarUploads={noCarUploads} canFollow={false} prefill={facts ? { key: facts.key, number: facts.number ?? typedNumber ?? "", date: facts.date ?? "", amount: facts.beforeVat !== null ? String(facts.beforeVat) : "" } : typedNumber ? { key: 1, number: typedNumber, date: "", amount: "" } : null} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" tone="secondary" size="md" disabled={reading} onClick={read} data-si-read-scan>{reading ? "Reading…" : "Read the scan"}</Button>
        {error ? <span className="text-xs font-semibold text-red" data-si-read-error>{error}</span> : null}
      </div>
      {facts ? (
        <p className="rounded-control bg-chip px-3 py-2 text-xs font-semibold" data-si-read-facts>
          Read from {facts.file}{facts.source === "ocr" ? " (camera scan, read by the reader)" : ""}: gross {money(facts.gross)} · discount {money(facts.discount)} · before VAT {money(facts.beforeVat)} · VAT {money(facts.vat)} · net total {money(facts.net)}
          {addsUp === null ? "" : addsUp ? " · adds up ✓" : " · DOES NOT ADD UP – check the paper"}
        </p>
      ) : null}
      {lines.length ? <LinePrices lines={lines} word="LPO" /> : null}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted">Remark (only when the paper differs from the LPO)</span>
        <Input name="remark" placeholder="e.g. supplier billed 2, we received 1 – credit note to follow" textCase="sentence" data-si-remark />
      </label>
      <div><Button type="submit" size="lg" data-si-enter-save>Save the invoice</Button></div>
    </form>
  );
}
