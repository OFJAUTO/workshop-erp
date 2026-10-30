"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "./JobFileUpload";
import { Field, Input, Textarea } from "./ui";
import { checkFinalReading, formatThousands, parseMileage, UNREADABLE_REASONS, type MileageUnit } from "@/lib/mileage";

/**
 * The final reading at gate-out (30 October 2026, batch 2 section 2): the km (or miles) on the dashboard and a photo
 * of the WHOLE instrument cluster (km, fuel, warning lights) as proof of how the car left. Both are required; when the
 * reading cannot be taken (battery dead, cluster not working, leaves on a recovery truck) the person picks the reason
 * and still adds the photo. "Driven while with us" shows as the figure is typed, red when it is lower than at gate-in.
 * The server checks the same rules (checkFinalReading) before the car can leave.
 */
export function FinalMileage({ jobId, unit, inReading, alertKm, initial }: { jobId: string; unit: MileageUnit; inReading: number | null; alertKm: number; initial?: { reading?: string; reason?: string; note?: string; photo?: JobFile | null } }) {
  const [text, setText] = useState(initial?.reading ?? "");
  const [unreadable, setUnreadable] = useState(!!initial?.reason);
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [photo, setPhoto] = useState<JobFile | null>(initial?.photo ?? null);
  const reading = parseMileage(text);
  const check = !unreadable && reading !== null ? checkFinalReading(reading, inReading, unit) : null;
  const lower = !!check && "error" in check;
  const driven = !unreadable && reading !== null && inReading !== null && !lower ? reading - inReading : null;
  const drivenKm = driven === null ? null : unit === "mi" ? Math.round(driven * 1.609344) : driven;
  return (
    <div className="flex flex-col gap-3 rounded-control border-2 border-ink p-3" data-final-mileage>
      <input type="hidden" name="mileage_out" value={unreadable ? "" : reading === null ? "" : String(reading)} />
      <input type="hidden" name="mileage_unreadable_reason" value={unreadable ? reason : ""} />
      <input type="hidden" name="mileage_unreadable_note" value={unreadable ? note : ""} />
      <input type="hidden" name="odometer_file_id" value={photo?.id ?? ""} />
      <p className="text-sm font-extrabold uppercase tracking-[0.08em]">Final {unit} and the dashboard photo</p>
      {!unreadable ? (
        <Field label={`Final ${unit} on the dashboard`} hint={inReading !== null ? `At gate-in: ${formatThousands(inReading)} ${unit}` : "No reading was recorded at gate-in."}>
          <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => reading !== null && setText(formatThousands(reading))} inputMode="numeric" aria-label={`Final ${unit}`} className="text-right" style={{ width: "10rem" }} data-mileage-out />
        </Field>
      ) : null}
      {lower ? <p className="text-sm font-bold text-red" data-mileage-lower>{(check as { error: string }).error}</p> : null}
      {driven !== null ? (
        <p className={`text-sm font-bold ${drivenKm !== null && drivenKm > alertKm ? "text-amber" : ""}`} data-mileage-driven>
          Driven while with us: {formatThousands(driven)} {unit}
          {unit === "mi" ? ` (${formatThousands(drivenKm)} km)` : ""}
          {drivenKm !== null && drivenKm > alertKm ? ` – more than ${alertKm} km: the owner is told` : ""}
        </p>
      ) : null}
      <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={unreadable} onChange={(e) => setUnreadable(e.target.checked)} className="h-5 w-5" data-mileage-unreadable />
        Can&apos;t read it
      </label>
      {unreadable ? (
        <div className="flex flex-col gap-2" data-mileage-reasons>
          <div className="flex flex-wrap gap-2">
            {UNREADABLE_REASONS.map((r) => (
              <button key={r.key} type="button" aria-pressed={reason === r.key} onClick={() => setReason(r.key)} className={`min-h-11 rounded-control border px-3 text-sm font-semibold ${reason === r.key ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-mileage-reason={r.key}>
                {r.label}
              </button>
            ))}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={reason === "other" ? "What happened (required)" : "Note (optional)"} data-mileage-note />
          <p className="text-xs text-muted">The owner is told. Take the photo of the cluster anyway.</p>
        </div>
      ) : null}
      <Field label="Photo of the whole instrument cluster" hint="Km, fuel and any warning lights in one photo: the proof of how the car left. Internal only.">
        <JobFileUpload jobId={jobId} kind="odometer_out" caption="Dashboard at gate-out" files={photo ? [photo] : []} accept="photo" label={photo ? "Retake the photo" : "Take the photo"} removable onAdded={(f) => setPhoto(f)} onRemoved={() => setPhoto(null)} />
      </Field>
      {!photo ? <p className="text-xs font-semibold text-amber" data-mileage-photo-missing>The photo is required before the car can leave.</p> : null}
    </div>
  );
}
