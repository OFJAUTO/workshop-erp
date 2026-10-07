import { DamageNote } from "./DamageNote";
import { MediaCapture } from "./MediaCapture";
import { VideoCapture } from "./VideoCapture";
import { WheelCapture } from "./WheelCapture";
import { Notice } from "./ui";
import type { Checklist } from "@/lib/media";

/** Required items with their state. Shown on the PC, the tablet and the phone; it refreshes live. */
export function ChecklistSummary({ check }: { check: Checklist }) {
  const wheelsDone = check.wheels.filter((w) => w.done).length;
  const rows: { label: string; done: boolean }[] = [
    { label: "Exterior video", done: check.videoExterior },
    { label: "Interior video", done: check.videoInterior },
    { label: "Dashboard photo", done: check.dashboard },
    { label: "Keys, front", done: check.keysFront },
    { label: "Keys, back", done: check.keysBack },
    ...(check.wheelsRequired ? [{ label: `Wheel photos with condition (${wheelsDone} of 4)`, done: wheelsDone === 4 }] : []),
    ...(check.majorDamage ? [{ label: `Damage photos (${check.damageCount})`, done: check.damageCount > 0 }] : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {rows.map((r) => (
          <li key={r.label} className={`flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold ${r.done ? "bg-green-soft text-green" : "bg-chip text-muted"}`}>
            <span className="w-5 text-center">{r.done ? "✓" : "…"}</span>
            {r.label}
            <span className="ml-auto text-xs font-medium">{r.done ? "Done" : "Waiting"}</span>
          </li>
        ))}
      </ul>
      {check.complete ? (
        <Notice tone="success">All uploads complete.</Notice>
      ) : (
        <Notice tone="info">
          The gate-in stays &quot;incomplete, video pending&quot; until every item above is done.
        </Notice>
      )}
    </div>
  );
}

/** The full set of gate-in capture controls, used on the PC/tablet media step and on the phone page. */
export function MediaChecklist({ jobId, check, token }: { jobId: string; check: Checklist; token?: string }) {
  // Wheels are taken in order: each one unlocks once the previous photo is in.
  const wheelSteps = check.wheelsRequired ? check.wheels.length : 0;
  const damageStep = 6 + wheelSteps;
  return (
    <div className="flex flex-col gap-4">
      <ChecklistSummary check={check} />
      <VideoCapture jobId={jobId} kind="video_exterior" label="1. Exterior video" hint="Walk around the outside of the car." token={token} done={check.videoExterior} />
      <VideoCapture jobId={jobId} kind="video_interior" label="2. Interior video" hint="Seats, dashboard, boot and controls." token={token} done={check.videoInterior} />
      <MediaCapture jobId={jobId} kind="dashboard_photo" label="3. Dashboard photo (mileage)" done={check.dashboard} token={token} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MediaCapture jobId={jobId} kind="keys_photo_front" label="4. Keys, front" done={check.keysFront} token={token} />
        <MediaCapture jobId={jobId} kind="keys_photo_back" label="5. Keys, back" done={check.keysBack} token={token} />
      </div>
      {check.wheelsRequired ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-bold">Wheels: front left, front right, rear left, rear right. Tap the condition under each photo.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {check.wheels.map((w, i) => (
              <WheelCapture key={w.kind} jobId={jobId} wheel={w} step={6 + i} enabled={i === 0 || check.wheels[i - 1].photo} token={token} />
            ))}
          </div>
        </div>
      ) : null}
      <MediaCapture
        jobId={jobId}
        kind="damage_photo"
        label={
          check.majorDamage
            ? `${damageStep}. Major damage photos (at least 1 required)${check.damageCount ? ` · ${check.damageCount} added` : ""}`
            : `${damageStep}. Damage close-ups (optional)${check.damageCount ? ` · ${check.damageCount} added` : ""}`
        }
        multiple
        done={check.damageCount > 0}
        token={token}
      />
      <DamageNote jobId={jobId} initial={check.damageNote} token={token} />
      {check.complete ? <Notice tone="success">All done. You can close this page.</Notice> : null}
    </div>
  );
}
