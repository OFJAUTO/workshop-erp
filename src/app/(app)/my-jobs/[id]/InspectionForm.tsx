"use client";

import { useRef, useState } from "react";
import { InspectionMedia, type InspectionFile } from "@/components/InspectionMedia";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Card, Input, Notice, SectionLabel, Textarea } from "@/components/ui";
import { ITEM_STATUSES, ITEM_STATUS_LABELS, MEASUREMENTS, type ChecklistSection, type ItemStatus } from "@/lib/inspection";

export type ItemState = { key: string; label: string; sectionKey: string; status: ItemStatus | null; remarks: string; parts_needed: string; labour_hours: string };
export type FindingState = { requestId: string; text: string; found: string; needs: string; status: ItemStatus | null };

const STATUS_CLASS: Record<ItemStatus, string> = {
  good: "border-green bg-green text-white",
  average: "border-amber-bar bg-amber-bar text-white",
  bad: "border-red-bar bg-red-bar text-white",
};

async function save(body: Record<string, unknown>) {
  const res = await fetch("/api/inspection/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save.");
}

function StatusButtons({ value, onPick, disabled }: { value: ItemStatus | null; onPick: (s: ItemStatus) => void; disabled: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ITEM_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          onClick={() => onPick(s)}
          aria-pressed={value === s}
          className={`min-h-12 rounded-control border-2 text-sm font-extrabold tracking-[0.04em] ${value === s ? STATUS_CLASS[s] : "border-line-strong bg-white"} ${disabled ? "opacity-60" : ""}`}
        >
          {ITEM_STATUS_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

/**
 * The technician's report: findings per customer request, the full checklist with one-tap
 * statuses, numbers, pre-scan PDFs, notes, then submit. Every tap is saved at once.
 */
export function InspectionForm({
  inspectionId,
  checklist,
  items: initialItems,
  findings: initialFindings,
  measurements: initialMeasurements,
  files: initialFiles,
  notes: initialNotes,
  returnReason,
  readOnly,
  submitAction,
}: {
  inspectionId: string;
  checklist: ChecklistSection[];
  items: ItemState[];
  findings: FindingState[];
  measurements: Record<string, string>;
  files: (InspectionFile & { itemKey: string | null; requestId: string | null })[];
  notes: string;
  returnReason: string | null;
  readOnly: boolean;
  submitAction: FormAction;
}) {
  const [items, setItems] = useState(initialItems);
  const [findings, setFindings] = useState(initialFindings);
  const [measurements, setMeasurements] = useState(initialMeasurements);
  const latestMeasurements = useRef(initialMeasurements);
  const [files, setFiles] = useState(initialFiles);
  const [notes, setNotes] = useState(initialNotes);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const disabled = readOnly;

  function debounced(key: string, fn: () => Promise<void>) {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => fn().catch((e) => setError(e instanceof Error ? e.message : "Could not save.")), 600);
  }

  async function setItemStatus(key: string, status: ItemStatus) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, status } : i)));
    try {
      await save({ inspectionId, item: { key, status } });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }
  function setItemText(key: string, field: "remarks" | "parts_needed" | "labour_hours", value: string) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)));
    debounced(`${key}.${field}`, () => save({ inspectionId, item: { key, [field]: value } }));
  }
  async function allGood(sectionKey: string) {
    setItems((prev) => prev.map((i) => (i.sectionKey === sectionKey && !i.status ? { ...i, status: "good" } : i)));
    try {
      await save({ inspectionId, sectionAllGood: sectionKey });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }
  async function setFindingStatus(requestId: string, status: ItemStatus) {
    setFindings((prev) => prev.map((f) => (f.requestId === requestId ? { ...f, status } : f)));
    try {
      await save({ inspectionId, finding: { requestId, status } });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }
  function setFindingText(requestId: string, field: "found" | "needs", value: string) {
    setFindings((prev) => prev.map((f) => (f.requestId === requestId ? { ...f, [field]: value } : f)));
    debounced(`${requestId}.${field}`, () => save({ inspectionId, finding: { requestId, [field]: value } }));
  }
  function setMeasurement(key: string, value: string) {
    // All numbers go together in one save, so quick entries never overwrite each other.
    const next = { ...latestMeasurements.current, [key]: value };
    latestMeasurements.current = next;
    setMeasurements(next);
    debounced("measurements", () => save({ inspectionId, measurements: latestMeasurements.current }));
  }
  function setNotesText(value: string) {
    setNotes(value);
    debounced("notes", () => save({ inspectionId, technicianNotes: value }));
  }
  const filesFor = (where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean }) =>
    files.filter((f) => (where.isPrescan ? f.isPrescan : !f.isPrescan && (f.itemKey ?? null) === (where.itemKey ?? null) && (f.requestId ?? null) === (where.requestId ?? null)));
  const addFile = (where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean }) => (f: InspectionFile) =>
    setFiles((prev) => [...prev, { ...f, itemKey: where.itemKey ?? null, requestId: where.requestId ?? null, isPrescan: !!where.isPrescan }]);

  const marked = items.filter((i) => i.status).length;
  const groups = Array.from(new Set(MEASUREMENTS.map((m) => m.group)));

  return (
    <div className="flex flex-col gap-6">
      {returnReason ? <Notice tone="error">Sent back by the workshop manager: {returnReason}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-col gap-4">
        <SectionLabel right={`${findings.filter((f) => f.status).length} of ${findings.length}`}>Part 1 · Customer requests</SectionLabel>
        {findings.length === 0 ? <p className="text-sm text-muted">No customer requests were recorded at gate-in.</p> : null}
        {findings.map((f, i) => (
          <div key={f.requestId} className="rounded-card border border-line p-3 flex flex-col gap-3">
            <p className="font-bold">
              {i + 1}. {f.text}
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">What was found</span>
              <Textarea value={f.found} onChange={(e) => setFindingText(f.requestId, "found", e.target.value)} rows={2} disabled={disabled} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">What it needs</span>
              <Textarea value={f.needs} onChange={(e) => setFindingText(f.requestId, "needs", e.target.value)} rows={2} disabled={disabled} />
            </label>
            <StatusButtons value={f.status} onPick={(s) => setFindingStatus(f.requestId, s)} disabled={disabled} />
            <InspectionMedia inspectionId={inspectionId} files={filesFor({ requestId: f.requestId })} where={{ requestId: f.requestId }} disabled={disabled} onAdded={addFile({ requestId: f.requestId })} />
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${marked} of ${items.length} marked`}>Part 2 · Full inspection</SectionLabel>
        <p className="text-sm text-muted">Tap GOOD, AVERAGE or BAD on every item. AVERAGE and BAD need a remark and at least one photo or video, plus the parts needed and your labour estimate.</p>
      </Card>

      {checklist.map((section) => {
        const sectionItems = items.filter((i) => i.sectionKey === section.key);
        const open = sectionItems.filter((i) => !i.status).length;
        return (
          <Card key={section.key} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel right={open ? `${open} to mark` : "Done"}>{section.title}</SectionLabel>
              {!disabled && open ? (
                <button type="button" onClick={() => allGood(section.key)} className="min-h-11 rounded-control border border-green bg-green-soft px-4 text-sm font-bold text-green">
                  All GOOD
                </button>
              ) : null}
            </div>
            {sectionItems.map((it) => {
              const needsDetail = it.status === "average" || it.status === "bad";
              return (
                <div key={it.key} className={`rounded-card border p-3 flex flex-col gap-3 ${it.status === "bad" ? "border-red-bar" : it.status === "average" ? "border-amber-bar" : "border-line"}`}>
                  <p className="font-semibold">{it.label}</p>
                  <StatusButtons value={it.status} onPick={(s) => setItemStatus(it.key, s)} disabled={disabled} />
                  {needsDetail || it.remarks ? (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted">Remarks{needsDetail ? " (required)" : ""}</span>
                      <Textarea value={it.remarks} onChange={(e) => setItemText(it.key, "remarks", e.target.value)} rows={2} disabled={disabled} />
                    </label>
                  ) : null}
                  {needsDetail ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="sm:col-span-2 flex flex-col gap-1">
                        <span className="text-xs font-semibold text-muted">Parts needed</span>
                        <Textarea value={it.parts_needed} onChange={(e) => setItemText(it.key, "parts_needed", e.target.value)} rows={2} disabled={disabled} placeholder="Part names or numbers, one per line" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-muted">Labour (hours)</span>
                        <Input value={it.labour_hours} onChange={(e) => setItemText(it.key, "labour_hours", e.target.value)} inputMode="decimal" disabled={disabled} placeholder="1.5" />
                      </label>
                    </div>
                  ) : null}
                  {needsDetail || filesFor({ itemKey: it.key }).length ? (
                    <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: it.key })} where={{ itemKey: it.key }} disabled={disabled} onAdded={addFile({ itemKey: it.key })} />
                  ) : null}
                </div>
              );
            })}
          </Card>
        );
      })}

      <Card className="flex flex-col gap-4">
        <SectionLabel>Numbers (all required)</SectionLabel>
        {groups.map((g) => (
          <div key={g} className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{g}</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MEASUREMENTS.filter((m) => m.group === g).map((m) => (
                <label key={m.key} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">
                    {m.label}
                    {m.unit ? ` (${m.unit})` : ""}
                  </span>
                  {m.kind === "choice" ? (
                    <div className="grid grid-cols-3 gap-1">
                      {m.choices!.map((c) => (
                        <button key={c.value} type="button" disabled={disabled} onClick={() => setMeasurement(m.key, c.value)} aria-pressed={measurements[m.key] === c.value} className={`min-h-11 rounded-control border text-xs font-bold ${measurements[m.key] === c.value ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Input value={measurements[m.key] ?? ""} onChange={(e) => setMeasurement(m.key, e.target.value)} inputMode={m.kind === "year" ? "numeric" : "decimal"} placeholder={m.kind === "year" ? "2023" : ""} disabled={disabled} />
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel right={filesFor({ isPrescan: true }).length ? `${filesFor({ isPrescan: true }).length} file${filesFor({ isPrescan: true }).length === 1 ? "" : "s"}` : "Required"}>Pre-scan (Autel fault code report, PDF)</SectionLabel>
        <p className="text-sm text-muted">Internal by default. The advisor can choose to show it to the customer with the report.</p>
        <InspectionMedia inspectionId={inspectionId} files={filesFor({ isPrescan: true })} where={{ isPrescan: true }} accept="pdf" disabled={disabled} onAdded={addFile({ isPrescan: true })} />
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Photos and videos of the whole car</SectionLabel>
        <InspectionMedia inspectionId={inspectionId} files={filesFor({})} where={{}} disabled={disabled} onAdded={addFile({})} />
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Technician&apos;s notes</SectionLabel>
        <Textarea value={notes} onChange={(e) => setNotesText(e.target.value)} rows={4} disabled={disabled} placeholder="Anything the workshop manager and advisor should know." />
      </Card>

      {!disabled ? (
        <ActionForm action={submitAction} className="flex flex-col gap-3">
          {() => (
            <>
              <p className="text-sm text-muted">Submitting records the end time. The workshop manager then approves the report or sends it back.</p>
              <SubmitButton>Submit report to the workshop manager</SubmitButton>
            </>
          )}
        </ActionForm>
      ) : null}
    </div>
  );
}
