"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { Button, Card, Input, Notice, SectionLabel, Textarea } from "@/components/ui";
import { QC_KIND_LABELS, type QcItem } from "@/lib/qc-items";

/** The QC checklist: every item Pass or Fail with a remark on Fail, the mileage, and the post-scan PDF or a reason. */
export function QcForm({ jobId, items, initialMileage, mileageUnit, postscan, waivedReason, notes, readOnly, loose = false, action }: { /** Loose items: no mileage, no Autel scan. */ loose?: boolean; jobId: string; items: QcItem[]; initialMileage: number | null; mileageUnit: string; postscan: JobFile | null; waivedReason: string | null; notes: string | null; readOnly: boolean; action: (formData: FormData) => void }) {
  const [results, setResults] = useState<Record<string, "pass" | "fail" | null>>(Object.fromEntries(items.map((i) => [i.key, i.result])));
  const [scan, setScan] = useState<JobFile | null>(postscan);
  const [attempted, setAttempted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const kinds = Array.from(new Set(items.map((i) => i.kind)));
  const missing = items.filter((i) => !results[i.key]);
  const fails = items.filter((i) => results[i.key] === "fail").length;

  /** Every reason the check cannot be finished, in plain words, shown next to the button. Nothing fails silently. */
  function finish(e: React.MouseEvent<HTMLButtonElement>) {
    const form = (e.currentTarget as HTMLButtonElement).closest("form")!;
    const fd = new FormData(form);
    const reasons: string[] = [];
    if (missing.length) reasons.push(`${missing.length} item${missing.length === 1 ? "" : "s"} not marked Pass or Fail`);
    const noRemark = items.filter((i) => results[i.key] === "fail" && !String(fd.get(`remark__${i.key}`) ?? "").trim());
    if (noRemark.length) reasons.push(`write what is wrong on: ${noRemark.map((i) => i.label).join(", ")}`);
    if (!loose && !String(fd.get("mileage") ?? "").replace(/[^\d]/g, "")) reasons.push("record the mileage");
    if (!loose && !scan && !String(fd.get("postscan_waived_reason") ?? "").trim()) reasons.push("attach the post-scan PDF or write why there is none");
    if (reasons.length) {
      setAttempted(true);
      setProblem(`Cannot finish yet: ${reasons.join("; ")}.`);
      if (missing.length) document.getElementById(`item-${missing[0].key}`)?.scrollIntoView({ block: "center" });
      return;
    }
    setProblem(null);
    (form.querySelector("#qc-finish") as HTMLInputElement).value = "yes";
    form.requestSubmit();
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="finish" value="no" id="qc-finish" />
      {kinds.map((kind) => (
        <Card key={kind} className="flex flex-col gap-3">
          <SectionLabel right={`${items.filter((i) => i.kind === kind && results[i.key]).length} of ${items.filter((i) => i.kind === kind).length}`}>{QC_KIND_LABELS[kind]}</SectionLabel>
          {items.filter((i) => i.kind === kind).map((it) => {
            const r = results[it.key];
            return (
              <div key={it.key} id={`item-${it.key}`} className={`rounded-control border p-3 flex flex-col gap-2 ${r === "fail" ? "border-red-bar" : r === "pass" ? "border-green" : attempted ? "border-red-bar" : "border-line"}`}>
                <span className="font-semibold">{it.label}</span>
                <input type="hidden" name={`result__${it.key}`} value={r ?? ""} />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={readOnly} onClick={() => setResults({ ...results, [it.key]: "pass" })} aria-pressed={r === "pass"} className={`min-h-12 rounded-control border-2 text-sm font-extrabold tracking-[0.04em] ${r === "pass" ? "border-green bg-green text-white" : "border-line-strong bg-white"}`}>PASS</button>
                  <button type="button" disabled={readOnly} onClick={() => setResults({ ...results, [it.key]: "fail" })} aria-pressed={r === "fail"} className={`min-h-12 rounded-control border-2 text-sm font-extrabold tracking-[0.04em] ${r === "fail" ? "border-red-bar bg-red-bar text-white" : "border-line-strong bg-white"}`}>FAIL</button>
                </div>
                {r === "fail" ? <Textarea name={`remark__${it.key}`} rows={2} defaultValue={it.remark ?? ""} placeholder="What is wrong (required)" disabled={readOnly} /> : <input type="hidden" name={`remark__${it.key}`} value={it.remark ?? ""} />}
              </div>
            );
          })}
        </Card>
      ))}
      {!loose ? (
      <Card className="flex flex-col gap-3">
        <SectionLabel>Mileage at QC</SectionLabel>
        <div className="flex flex-wrap items-end gap-2">
          <Input name="mileage" defaultValue={initialMileage ?? ""} inputMode="numeric" className="w-40" disabled={readOnly} />
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="mileage_unit" value="km" defaultChecked={mileageUnit !== "mi"} /> km</label>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="mileage_unit" value="mi" defaultChecked={mileageUnit === "mi"} /> miles</label>
        </div>
      </Card>
      ) : null}
      {!loose ? (
      <Card className="flex flex-col gap-3">
        <SectionLabel>Post-scan from the Autel (PDF)</SectionLabel>
        <JobFileUpload jobId={jobId} kind="qc_postscan" files={scan ? [scan] : []} accept="pdf" label="Attach the post-scan PDF" disabled={readOnly} onAdded={(f) => setScan(f)} />
        <input type="hidden" name="postscan_path" value={scan?.path ?? ""} />
        {!scan ? (
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">No scan? Write the reason (required to pass without it)</span><Textarea name="postscan_waived_reason" rows={2} defaultValue={waivedReason ?? ""} disabled={readOnly} /></label>
        ) : null}
      </Card>
      ) : null}
      <Card className="flex flex-col gap-3">
        <SectionLabel>Notes</SectionLabel>
        <Textarea name="notes" rows={2} defaultValue={notes ?? ""} disabled={readOnly} />
      </Card>
      {!readOnly ? (
        <div className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-card border border-ink bg-white p-3">
          {problem ? <p className="text-sm font-bold text-red">{problem}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{missing.length ? `${missing.length} not marked` : fails ? `${fails} fail${fails === 1 ? "" : "s"}: the car goes back to Work` : "All pass: the car goes to the wash"}</span>
            {attempted && missing.length ? <button type="button" className="text-xs font-bold text-red underline underline-offset-4" onClick={() => document.getElementById(`item-${missing[0].key}`)?.scrollIntoView({ block: "center" })}>Show the first</button> : null}
            <span className="ml-auto flex gap-2">
              <Button type="submit" tone="secondary" size="md">Save for later</Button>
              <Button type="button" size="md" onClick={finish}>{fails ? "Finish: fail, back to Work" : "Finish: pass"}</Button>
            </span>
          </div>
        </div>
      ) : (
        <Notice tone="info">View only.</Notice>
      )}
    </form>
  );
}
