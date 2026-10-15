"use client";

import { useEffect, useState } from "react";
import { CarPictureCrop } from "./CarPictureCrop";
import { DamageNote } from "./DamageNote";
import { MediaCapture } from "./MediaCapture";
import { VideoCapture } from "./VideoCapture";
import { WheelCapture } from "./WheelCapture";
import { Notice } from "./ui";
import type { Checklist } from "@/lib/media";
import { GATE_IN_ATTEMPT_EVENT, itemsLeftLine, missingItems } from "@/lib/media-checklist";

/** Required items with their state, and under them the line that names what is left. Shown on the PC, the tablet and the phone; it refreshes live. */
export function ChecklistSummary({ check, attempted = false }: { check: Checklist; attempted?: boolean }) {
  const wheelsDone = check.wheels.filter((w) => w.done).length;
  const rows: { label: string; done: boolean }[] = [
    { label: "Car picture (for our dashboard)", done: check.carPicture },
    { label: "Exterior video", done: check.videoExterior },
    { label: "Interior video", done: check.videoInterior },
    { label: "Dashboard photo", done: check.dashboard },
    { label: "Keys, front", done: check.keysFront },
    { label: "Keys, back", done: check.keysBack },
    ...(check.wheelsRequired ? [{ label: `Wheel photos with condition (${wheelsDone} of 4)`, done: wheelsDone === 4 }] : []),
    ...(check.majorDamage ? [{ label: `Damage photos (${check.damageCount})`, done: check.damageCount > 0 }] : []),
  ];
  const missing = missingItems(check);
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {rows.map((r) => (
          <li key={r.label} className={`flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold ${r.done ? "bg-green-soft text-green" : attempted ? "bg-red-soft text-red" : "bg-chip text-muted"}`}>
            <span className="w-5 text-center">{r.done ? "✓" : attempted ? "!" : "…"}</span>
            {r.label}
            <span className="ml-auto text-xs font-medium">{r.done ? "Done" : attempted ? "Missing" : "Waiting"}</span>
          </li>
        ))}
      </ul>
      {missing.length === 0 ? (
        <Notice tone="success">All uploads complete.</Notice>
      ) : (
        <p className={`text-sm ${attempted ? "font-semibold text-red" : "text-muted"}`} data-items-left>{itemsLeftLine(missing)}</p>
      )}
    </div>
  );
}

/**
 * The full set of gate-in capture controls, used on the PC/tablet media step and on the phone page. One source
 * of truth: the checklist the server computes from the recorded files. Every upload hands the server's fresh
 * checklist back here the moment the file is recorded, so a tick turns green only when the gate-in counts the
 * item as done; the page's own refresh brings the same answer when the upload happened on another device.
 * When someone presses the finish button with items missing, those items turn red.
 */
export function MediaChecklist({ jobId, check: serverCheck, token, carPictureUrl = null, damageChips = [] }: { jobId: string; check: Checklist; token?: string; /** The current car picture, so "Tap to replace" opens the crop with it. */ carPictureUrl?: string | null; /** One-tap words above the damage note (Settings). */ damageChips?: string[] }) {
  const [check, setCheck] = useState(serverCheck);
  const [seen, setSeen] = useState(serverCheck);
  if (seen !== serverCheck) {
    setSeen(serverCheck);
    setCheck(serverCheck);
  }
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    const on = () => setAttempted(true);
    window.addEventListener(GATE_IN_ATTEMPT_EVENT, on);
    return () => window.removeEventListener(GATE_IN_ATTEMPT_EVENT, on);
  }, []);
  const onChecklist = (c: Partial<Checklist>) => setCheck((cur) => ({ ...cur, ...c }));
  // Wheels are taken in order: each one unlocks once the previous photo is in.
  const wheelSteps = check.wheelsRequired ? check.wheels.length : 0;
  const damageStep = 7 + wheelSteps;
  return (
    <div className="flex flex-col gap-4" data-media-checklist>
      <ChecklistSummary check={check} attempted={attempted} />
      <CarPictureCrop jobId={jobId} token={token} done={check.carPicture} currentUrl={carPictureUrl} attempted={attempted} onChecklist={onChecklist} />
      <VideoCapture jobId={jobId} kind="video_exterior" label="2. Exterior video" hint="Walk around the outside of the car." token={token} done={check.videoExterior} attempted={attempted} onChecklist={onChecklist} />
      <VideoCapture jobId={jobId} kind="video_interior" label="3. Interior video" hint="Seats, dashboard, boot and controls." token={token} done={check.videoInterior} attempted={attempted} onChecklist={onChecklist} />
      <MediaCapture jobId={jobId} kind="dashboard_photo" label="4. Dashboard photo (mileage)" done={check.dashboard} token={token} attempted={attempted} onChecklist={onChecklist} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MediaCapture jobId={jobId} kind="keys_photo_front" label="5. Keys, front" done={check.keysFront} token={token} attempted={attempted} onChecklist={onChecklist} />
        <MediaCapture jobId={jobId} kind="keys_photo_back" label="6. Keys, back" done={check.keysBack} token={token} attempted={attempted} onChecklist={onChecklist} />
      </div>
      {check.wheelsRequired ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-bold">Wheels: front left, front right, rear left, rear right. Tap the condition under each photo.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {check.wheels.map((w, i) => (
              <WheelCapture key={w.kind} jobId={jobId} wheel={w} step={7 + i} enabled={i === 0 || check.wheels[i - 1].photo} token={token} attempted={attempted} onChecklist={onChecklist} />
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
        attempted={attempted && check.majorDamage}
        itemKey={check.majorDamage ? "damage_photo" : null}
        onChecklist={onChecklist}
      />
      <DamageNote jobId={jobId} initial={check.damageNote} token={token} chips={damageChips} />
      {check.complete ? <Notice tone="success">All done. You can close this page.</Notice> : null}
    </div>
  );
}
