"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice, Textarea } from "@/components/ui";
import type { SupplierOption } from "@/lib/parts-rows";
import { MAPPING_CHOICES, checkTotals, guessMappingFromData, guessValuesPerRow, linesFromRows, nameSimilarity, suggestMatches, type ApplyLine, type ColumnMapping, type ImportField, type ImportLine, type ImportResult } from "@/lib/price-import";
import { applyImport, parseImportText, parseImportUpload } from "../../import-actions";

export type ImportTarget = { key: string; partId: string | null; requestId: string | null; name: string; original: string | null; partNumber: string | null; state: string; qty: string };

type Source = { kind: "file" | "paste" | "image"; label: string; images: string[] };
type Decision = { target: string; confirmed: boolean; suggested: { id: string; by: "number" | "name"; score: number } | null };
type Way = "file" | "paste" | "image" | "pdf";

const money = (n: number | null) => (n === null ? "" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * The import, step by step: a way in (file, paste, screenshot), the mapping step when the columns are not
 * recognised, then the check screen (supplier, VIN, totals, every line beside its match with Confirm, Change
 * match, Add as new part, Skip) and Apply. Nothing is written before Apply.
 */
export function ImportWizard({ jobId, vin, suppliers, targets, ocrEnabled, canApply }: { jobId: string; vin: string | null; suppliers: (SupplierOption & { hasMapping: boolean })[]; targets: ImportTarget[]; ocrEnabled: boolean; canApply: boolean }) {
  const router = useRouter();
  const [way, setWay] = useState<Way>("file");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [vinOk, setVinOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  // One-value-per-line text with no headings: how many values make one part (guessed, changeable).
  const [perRow, setPerRow] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [applied, setApplied] = useState<{ applied: number; failed: { name: string; error: string }[] } | null>(null);
  const [, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  /** A parsed result arrives: matches are suggested, the supplier pre-selected from the file's own words. */
  function receive(r: ImportResult, src: Source) {
    setResult(r);
    setSource(src);
    // Unknown columns: a first guess from the data, changed with one tap on the mapping screen.
    setMapping(r.format === "unknown" && Object.keys(r.mapping).length === 0 ? guessMappingFromData(r.rows) : r.mapping);
    setVinOk(false);
    setApplied(null);
    const d: Record<string, Decision> = {};
    const matches = suggestMatches(r.lines, targets.map((t) => ({ id: t.key, name: t.name, original: t.original, partNumber: t.partNumber })));
    for (const l of r.lines) {
      const s = matches.get(l.key) ?? null;
      d[l.key] = { target: s?.id ?? "new", confirmed: false, suggested: s };
    }
    setDecisions(d);
    if (!supplierId) {
      const hint = r.supplierHint?.toLowerCase() ?? "";
      const byHint = hint ? suppliers.find((s) => s.name.toLowerCase().includes(hint) || hint.includes(s.name.toLowerCase()) || nameSimilarity(s.name, hint) >= 0.6) : undefined;
      const dealer = r.format === "b2bconnect" ? suppliers.find((s) => /gargash|mercedes/i.test(s.name)) : r.format === "landrover" ? suppliers.find((s) => /land ?rover|jaguar|al tayer|premier/i.test(s.name)) : undefined;
      const pick = byHint ?? dealer;
      if (pick) setSupplierId(pick.id);
    }
  }

  async function sendFiles(files: File[]) {
    if (!files.length) return;
    setError(null);
    setBusy("Reading the file…");
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const res = await parseImportUpload(jobId, fd);
    setBusy(null);
    if (res.error || !res.result) {
      setError(res.error ?? "Could not read the file.");
      return;
    }
    // A scanned PDF went through the picture reader: every line must be ticked, like a screenshot.
    receive(res.result, { kind: res.scanned ? "image" : "file", label: (res.fileNames ?? []).join(", "), images: [] });
  }
  async function sendText(t: string, valuesPerRow: number | null = perRow) {
    if (!t.trim()) return;
    setError(null);
    setBusy("Reading the text…");
    const res = await parseImportText(jobId, t, valuesPerRow);
    setBusy(null);
    if (res.error || !res.result) {
      setError(res.error ?? "Could not read the text.");
      return;
    }
    receive(res.result, { kind: "paste", label: "pasted text", images: [] });
  }
  async function sendImages(files: File[]) {
    if (!files.length) return;
    if (!ocrEnabled) {
      setError("Reading screenshots is not switched on yet. Use Upload file or Paste from email for now.");
      return;
    }
    setError(null);
    const results: ImportResult[] = [];
    const urls: string[] = [];
    let i = 0;
    for (const f of files) {
      i++;
      setBusy(files.length > 1 ? `Reading picture ${i} of ${files.length}…` : "Reading the picture…");
      const fd = new FormData();
      fd.append("image", f);
      const res = await fetch("/api/import/ocr", { method: "POST", body: fd }).catch(() => null);
      const data = (await res?.json().catch(() => ({}))) as { result?: ImportResult; error?: string } | undefined;
      if (!res || !res.ok || !data?.result) {
        setBusy(null);
        setError(data?.error ?? "The picture could not be read.");
        return;
      }
      results.push(data.result);
      urls.push(URL.createObjectURL(f));
    }
    setBusy(null);
    const merged: ImportResult = results.length === 1 ? results[0] : { ...results[0], lines: results.flatMap((r, k) => r.lines.map((l) => ({ ...l, key: `p${k}-${l.key}` }))), totals: { found: results.flatMap((r) => r.totals.found), sumLines: results.reduce((a, r) => a + (r.totals.sumLines ?? 0), 0), expected: results.every((r) => r.totals.expected !== null) ? results.reduce((a, r) => a + (r.totals.expected ?? 0), 0) : null, match: results.some((r) => r.totals.match === false) ? false : results.some((r) => r.totals.match === true) ? true : null }, warnings: results.flatMap((r) => r.warnings) };
    receive(merged, { kind: "image", label: `${files.length} screenshot${files.length === 1 ? "" : "s"}`, images: urls });
  }

  /** Ctrl+V anywhere on the page: a picture goes to the screenshot reader, text to the paste reader. */
  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      setWay("image");
      void sendImages(files);
      return;
    }
    const t = e.clipboardData.getData("text/plain");
    if (t && (t.includes("\n") || t.includes("\t")) && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      setWay("paste");
      setText(t);
      void sendText(t);
    }
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length && images.length === files.length) {
      setWay("image");
      void sendImages(images);
    } else void sendFiles(files);
  }

  /** The mapping step's Import: the columns as Parts named them, read again on the spot; the mapping is kept for the supplier on Apply. */
  function applyMapping() {
    if (!result) return;
    const { lines, found, vin: fileVin } = linesFromRows(result.rows, mapping, "m");
    receive({ ...result, format: "mapped", mapping, lines, totals: checkTotals(lines, found), vin: fileVin ?? result.vin, warnings: lines.length ? [] : ["No part lines were found with this mapping."] }, source ?? { kind: "file", label: "file", images: [] });
  }

  const lines = result?.lines ?? [];
  const decide = (key: string, patch: Partial<Decision>) => setDecisions((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  // Two lines pointing at the same row on the list: one would overwrite the other, so both are held until changed.
  const targetCounts = new Map<string, number>();
  for (const l of lines) {
    const t = decisions[l.key]?.target;
    if (t && t !== "new" && t !== "skip") targetCounts.set(t, (targetCounts.get(t) ?? 0) + 1);
  }
  const duplicated = (key: string) => { const t = decisions[key]?.target; return !!t && t !== "new" && t !== "skip" && (targetCounts.get(t) ?? 0) > 1; };
  const anyDuplicate = lines.some((l) => duplicated(l.key));
  const allDecided = lines.length > 0 && !anyDuplicate && lines.every((l) => decisions[l.key]?.confirmed || decisions[l.key]?.target === "skip");
  const vinMismatch = !!(result?.vin && vin && result.vin.replace(/\s+/g, "").toUpperCase() !== vin.replace(/\s+/g, "").toUpperCase());
  const totalsBad = result?.totals.match === false;
  const canConfirmAll = !!result && source?.kind !== "image" && !totalsBad;
  const readyToApply = canApply && !!supplierId && allDecided && (!vinMismatch || vinOk) && !busy;
  const defaultType = result?.format === "b2bconnect" || result?.format === "landrover" ? "genuine" : null;

  function apply() {
    if (!result || !readyToApply) return;
    const payload: ApplyLine[] = lines.map((l) => {
      const d = decisions[l.key];
      const t = d?.target ?? "new";
      const target = t === "new" || t === "skip" ? t : (() => { const row = targets.find((x) => x.key === t); return row ? { partId: row.partId, requestId: row.requestId } : "new"; })();
      return { key: l.key, target, name: l.description ?? l.partNumber ?? "Part", partNumber: l.partNumber, qty: l.qty, list: l.list, discount: l.discount, net: l.net, availability: l.availability };
    });
    setBusy("Applying…");
    start(async () => {
      const res = await applyImport(jobId, { supplierId: supplierId || null, defaultType, source: source?.label ?? "import", format: result.format, mapping: result.format === "mapped" ? { headings: result.headings, mapping: result.mapping } : null, lines: payload });
      setBusy(null);
      if (res.error) {
        setError(res.error);
        return;
      }
      setApplied({ applied: res.applied ?? 0, failed: res.failed ?? [] });
      if (!(res.failed ?? []).length) router.push(`/parts/${jobId}?message=${encodeURIComponent(`${res.applied} price${res.applied === 1 ? "" : "s"} imported. Undo last import is in the row above the table.`)}`);
    });
  }

  const wayBtn = (w: Way, label: string) => (
    <button key={w} type="button" onClick={() => setWay(w)} aria-pressed={way === w} className={`min-h-11 rounded-control px-4 text-sm font-bold ${way === w ? "bg-ink text-white" : "border border-line-strong bg-white"}`} data-way={w}>{label}</button>
  );
  const chip = (text: string, tone: "green" | "amber" | "grey") => <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-bold whitespace-nowrap ${tone === "green" ? "bg-green-soft text-green" : tone === "amber" ? "bg-amber-soft text-amber" : "bg-chip text-muted"}`}>{text}</span>;
  const availabilityChip = (l: ImportLine) => (l.availability ? (l.availability.kind === "same_day" ? chip("Same day", "green") : l.availability.kind === "days" ? chip(l.availability.days === 1 ? "Next day" : `${l.availability.days} days`, "grey") : l.availability.kind === "back_order" ? chip("Back order", "amber") : chip("Supplier to confirm", "amber")) : null);

  return (
    <div className="flex flex-col gap-4" onPaste={onPaste} data-import-wizard>
      {/* The way in */}
      <div className="rounded-card border border-line bg-white p-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">{wayBtn("file", "Upload file")}{wayBtn("paste", "Paste from email")}{wayBtn("image", "Upload screenshot")}{wayBtn("pdf", "Upload PDF")}</div>
        {way === "file" ? (
          <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} className={`rounded-card border-2 border-dashed p-6 flex flex-col items-center gap-2 text-center ${dragging ? "border-ink bg-chip" : "border-line-strong"}`} data-drop-zone>
            <p className="text-sm font-semibold">Drop an Excel or CSV file here (one or several), or</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void sendFiles(files); }} data-file-input />
            <Button type="button" size="lg" onClick={() => fileRef.current?.click()} disabled={!!busy}>Choose file</Button>
            <p className="text-xs text-muted">Mercedes B2BConnect files are recognised by themselves. Other suppliers: the columns are mapped once and remembered.</p>
          </div>
        ) : null}
        {way === "pdf" ? (
          <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} className={`rounded-card border-2 border-dashed p-6 flex flex-col items-center gap-2 text-center ${dragging ? "border-ink bg-chip" : "border-line-strong"}`} data-drop-zone>
            <p className="text-sm font-semibold">Drop the PDF from the supplier here (one or several), or</p>
            <input ref={pdfRef} type="file" accept="application/pdf,.pdf" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void sendFiles(files); }} data-pdf-input />
            <Button type="button" size="lg" onClick={() => pdfRef.current?.click()} disabled={!!busy}>Choose PDF</Button>
            <p className="text-xs text-muted">A PDF with text is read page by page; totals are left out. A scanned PDF (a picture) goes through the screenshot reader{ocrEnabled ? "" : ", which is not switched on yet"}.</p>
          </div>
        ) : null}
        {way === "paste" ? (
          <div className="flex flex-col gap-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="Paste the supplier's email or the copied cells here (Ctrl+V)." className="font-mono text-xs" aria-label="Pasted text" data-paste-box />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="lg" onClick={() => void sendText(text)} disabled={!text.trim() || !!busy} data-read-text>Read the text</Button>
              <p className="text-xs text-muted self-center">Both layouts work: one part per line, or one value per line. Totals are checked against the lines.</p>
            </div>
          </div>
        ) : null}
        {way === "image" ? (
          <div className="flex flex-col gap-2">
            {ocrEnabled ? (
              <>
                <input ref={imageRef} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void sendImages(files); }} />
                <div className="flex flex-wrap gap-2 items-center">
                  <Button type="button" size="lg" onClick={() => imageRef.current?.click()} disabled={!!busy}>Choose picture</Button>
                  <p className="text-xs text-muted">Or press Ctrl+V with a screenshot on the clipboard. Every line must be ticked before Apply.</p>
                </div>
              </>
            ) : (
              <Notice tone="info">Reading screenshots is not switched on yet. It needs the ANTHROPIC_API_KEY in the environment settings (see the delivery note for the service and the cost). Use Upload file or Paste from email meanwhile.</Notice>
            )}
          </div>
        ) : null}
        {busy ? <p className="text-sm font-semibold text-muted" data-import-busy>{busy}</p> : null}
        {error ? <p className="text-sm font-semibold text-red" data-import-error>{error}</p> : null}
      </div>

      {/* Mapping step: the columns were not recognised. The first five lines, a dropdown above each column, one Import button. */}
      {result && result.format === "unknown" ? (() => {
        const width = Math.max(result.headings.length, ...result.rows.map((r) => r.length), 1);
        const cols = Array.from({ length: width }, (_, i) => i);
        const fieldOf = (i: number) => (Object.entries(mapping).find(([, v]) => v === i)?.[0] as ImportField | undefined) ?? "ignore";
        const setField = (i: number, f: ImportField) => setMapping((m) => { const next: ColumnMapping = {}; for (const [k, v] of Object.entries(m)) if (v !== i && k !== f) (next as Record<string, number>)[k] = v as number; if (f !== "ignore") next[f] = i; return next; });
        const named = result.headings.some((h) => h && !/^Column \d+$/.test(h));
        const singleColumn = width <= 1 && source?.kind === "paste";
        const guess = perRow ?? guessValuesPerRow(text) ?? 4;
        return (
          <div className="rounded-card border border-ink bg-white p-4 flex flex-col gap-3" data-mapping-step>
            <span className="text-base font-extrabold">Which column is which?</span>
            <p className="text-xs text-muted">The first lines as they were read. A heading that is wrong: tap it and choose another. Then Import.</p>
            {singleColumn ? (
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">Values per part</span>
                <input type="number" min={2} max={12} value={guess} onChange={(e) => { const n = Math.max(2, Math.min(12, Number(e.target.value) || 2)); setPerRow(n); void sendText(text, n); }} className="min-h-11 w-20 rounded-control border border-line-strong px-2 text-center" aria-label="Values per part" data-values-per-row />
                <span className="text-xs text-muted">One value per line: how many lines make one part.</span>
              </label>
            ) : null}
            <div className="overflow-x-auto">
              <table className="text-sm" data-mapping-table>
                <thead>
                  <tr>
                    {cols.map((i) => (
                      <th key={i} className="px-1.5 py-1 text-left">
                        <select value={fieldOf(i)} onChange={(e) => setField(i, e.target.value as ImportField)} className={`min-h-11 rounded-control border px-2 text-xs font-bold ${fieldOf(i) === "ignore" ? "border-line bg-chip text-muted" : "border-ink bg-white"}`} aria-label={`Column ${i + 1} meaning`} data-mapping-select>
                          {MAPPING_CHOICES.map((c) => <option key={c.field} value={c.field}>{c.label}</option>)}
                        </select>
                      </th>
                    ))}
                  </tr>
                  {named ? <tr>{cols.map((i) => <th key={i} className="px-2 py-1 text-left text-[11px] font-semibold text-muted border-b border-line whitespace-nowrap">{result.headings[i] ?? ""}</th>)}</tr> : null}
                </thead>
                <tbody>
                  {result.rows.slice(0, 5).map((r, ri) => <tr key={ri} data-mapping-row>{cols.map((ci) => <td key={ci} className="px-2 py-1 whitespace-nowrap border-b border-line">{r[ci] ?? ""}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="lg" onClick={applyMapping} disabled={(mapping.partNumber === undefined && mapping.description === undefined) || mapping.net === undefined} data-apply-mapping>Import</Button>
              {mapping.net === undefined ? <span className="text-xs font-semibold text-red">Choose which column is the price.</span> : mapping.partNumber === undefined && mapping.description === undefined ? <span className="text-xs font-semibold text-red">Choose the part number or the name.</span> : <span className="text-xs text-muted">{result.rows.length} line{result.rows.length === 1 ? "" : "s"} will be read. The mapping is remembered for the supplier when you apply.</span>}
            </div>
          </div>
        );
      })() : null}

      {/* The check screen */}
      {result && result.format !== "unknown" ? (
        <div className={`grid gap-4 ${source?.images.length ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
          {source?.images.length ? (
            <div className="flex flex-col gap-2 order-last xl:order-first">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">The screenshot</span>
              {source.images.map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={u} src={u} alt="Screenshot" className="w-full rounded-card border border-line" />
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-3" data-check-screen>
            <div className="rounded-card border border-line bg-white p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-base font-extrabold">Check before applying</span>
                <span className="text-xs text-muted">{lines.length} line{lines.length === 1 ? "" : "s"} read from {source?.label}{result.format === "b2bconnect" ? " (Mercedes B2BConnect)" : result.format === "landrover" ? " (Land Rover quotation)" : result.format === "mapped" ? " (saved mapping)" : ""}</span>
                <Button type="button" tone="ghost" size="md" className="ml-auto" onClick={() => { setResult(null); setSource(null); setApplied(null); }}>Start again</Button>
              </div>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">Supplier</span>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`min-h-11 rounded-control border bg-white px-3 text-sm ${supplierId ? "border-line-strong" : "border-red-bar"}`} aria-label="Supplier" data-import-supplier>
                  <option value="">Choose the supplier…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.discount ? ` · ${s.discount}%` : ""}</option>)}
                </select>
                {!supplierId ? <span className="text-xs font-semibold text-red">Choose the supplier before Apply.</span> : null}
              </label>
              {result.vin ? (
                vinMismatch ? (
                  <div className="rounded-control border border-amber-bar bg-amber-soft p-3 flex flex-col gap-2 text-sm" data-vin-warning>
                    <span className="font-bold">The file is for VIN {result.vin}; this car is {vin}.</span>
                    <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={vinOk} onChange={(e) => setVinOk(e.target.checked)} className="h-5 w-5 accent-ink" /> <span>I checked: apply these prices to this car anyway.</span></label>
                  </div>
                ) : vin ? <p className="text-xs font-semibold text-green" data-vin-ok>✓ VIN {result.vin} matches the car.</p> : <p className="text-xs text-muted">VIN in the file: {result.vin}</p>
              ) : null}
              <div data-totals-check className={`rounded-control px-3 py-2 text-sm font-semibold ${totalsBad ? "bg-red-soft text-red" : result.totals.match ? "bg-green-soft text-green" : "bg-chip text-muted"}`}>
                {totalsBad ? `Totals don't match, check the prices: the lines add up to AED ${money(result.totals.sumLines)}, the ${source?.kind === "image" ? "picture" : "file"} says AED ${money(result.totals.expected)}. Confirm each price before Apply.` : result.totals.match ? `✓ The lines add up to AED ${money(result.totals.sumLines)}, the same as the total in the ${source?.kind === "image" ? "picture" : "file"}.` : `No total in the ${source?.kind === "image" ? "picture" : "file"} to check the lines against${result.totals.sumLines !== null ? ` (lines: AED ${money(result.totals.sumLines)})` : ""}.`}
              </div>
              {result.warnings.map((w) => <p key={w} className="text-xs font-semibold text-amber">{w}</p>)}
            </div>

            <div className="rounded-card border border-line bg-white p-2 flex flex-col gap-1.5" data-import-lines>
              <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem] gap-2 px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted border-b border-line">
                <span>Imported line</span><span>On the car&apos;s list</span><span />
              </div>
              {lines.map((l) => {
                const d = decisions[l.key] ?? { target: "new", confirmed: false, suggested: null };
                const skipped = d.target === "skip";
                const dup = duplicated(l.key);
                return (
                  <div key={l.key} data-import-line={l.key} data-decided={d.confirmed ? "confirmed" : skipped ? "skipped" : "open"} data-duplicate={dup ? "true" : undefined} className={`grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem] gap-2 items-center rounded-control border px-2 py-1.5 ${dup ? "border-red-bar bg-red-soft" : d.confirmed ? "border-green bg-green-soft" : skipped ? "border-line bg-canvas opacity-70" : totalsBad ? "border-red-bar bg-white" : "border-line bg-white"}`}>
                    <div className="flex flex-col min-w-0 text-sm">
                      <span className="font-bold truncate">{l.description ?? <span className="text-muted">No description</span>}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                        {dup ? <span className="font-semibold text-red">Same match as another line: change one</span> : null}
                        {l.partNumber ? <span className="font-mono font-semibold text-ink">{l.partNumber}</span> : <span className="text-amber">No part number</span>}
                        <span>× {l.qty ?? <span className="text-amber">?</span>}</span>
                        {l.list !== null ? <span>List {money(l.list)}</span> : null}
                        {l.discount !== null ? <span>{l.discount}%</span> : null}
                        <span className={l.net === null ? "text-amber" : "font-semibold text-ink"}>{l.net === null ? "No net price" : `Net ${money(l.net)}`}</span>
                        {availabilityChip(l)}
                      </span>
                    </div>
                    <select value={d.target} onChange={(e) => decide(l.key, { target: e.target.value, confirmed: false })} className="min-h-10 w-full rounded-control border border-line-strong bg-white px-2 text-sm" aria-label={`Match for ${l.description ?? l.partNumber ?? "line"}`} data-match-select>
                      <option value="new">+ Add as new part</option>
                      <option value="skip">Skip this line</option>
                      {[...targets].sort((a, b) => (a.key === d.suggested?.id ? -1 : b.key === d.suggested?.id ? 1 : 0)).map((t) => (
                        <option key={t.key} value={t.key}>{t.name}{t.partNumber ? ` · ${t.partNumber}` : ""}{t.key === d.suggested?.id ? (d.suggested?.by === "number" ? " · same part number" : " · similar name") : ""}</option>
                      ))}
                    </select>
                    <div className="flex justify-end">
                      {skipped ? (
                        <span className="text-xs font-semibold text-muted">Skipped</span>
                      ) : (
                        <button type="button" onClick={() => decide(l.key, { confirmed: !d.confirmed })} aria-pressed={d.confirmed} className={`min-h-10 w-full rounded-control border px-3 text-sm font-bold ${d.confirmed ? "border-green bg-green text-white" : "border-line-strong bg-white"}`} data-confirm-line>{d.confirmed ? "✓ Confirmed" : "Confirm"}</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {lines.length === 0 ? <p className="p-3 text-sm text-muted">No lines were read.</p> : null}
            </div>

            {applied?.failed.length ? (
              <Notice tone="error">{applied.applied} applied; {applied.failed.length} could not be: {applied.failed.map((f) => `${f.name} (${f.error})`).join("; ")}</Notice>
            ) : null}

            <div className="sticky bottom-0 rounded-card border border-line bg-white px-4 py-3 flex flex-wrap items-center gap-2" data-import-bar>
              <span className="text-sm text-muted">{lines.filter((l) => decisions[l.key]?.confirmed).length} confirmed · {lines.filter((l) => decisions[l.key]?.target === "skip").length} skipped · {lines.filter((l) => !decisions[l.key]?.confirmed && decisions[l.key]?.target !== "skip").length} to check</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {canConfirmAll ? <Button type="button" tone="secondary" size="lg" onClick={() => setDecisions((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.target === "skip" ? v : { ...v, confirmed: true }])))} data-confirm-all>Confirm all matched</Button> : null}
                <Button type="button" size="lg" onClick={apply} disabled={!readyToApply} data-apply>{busy === "Applying…" ? "Applying…" : `Apply${lines.length ? ` (${lines.filter((l) => decisions[l.key]?.confirmed).length})` : ""}`}</Button>
              </div>
              {!canApply ? <p className="w-full text-xs text-muted">This job is closed, or you are only viewing: nothing can be applied.</p> : !allDecided && lines.length ? <p className="w-full text-xs text-muted">{totalsBad ? "Confirm each price (or skip the line) before Apply." : "Confirm or skip every line before Apply."}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
