"use client";

import { useEffect, useState } from "react";
import { CarPictureCrop } from "./CarPictureCrop";
import { DamageNote } from "./DamageNote";
import { MediaCapture, coveredByDevice, deviceWord, useDeviceFiles, type DeviceFile } from "./MediaCapture";
import { VideoCapture } from "./VideoCapture";
import { WheelCapture } from "./WheelCapture";
import { Notice } from "./ui";
import type { Checklist } from "@/lib/media";
import { GATE_IN_ATTEMPT_EVENT, itemsLeftLine, missingItems } from "@/lib/media-checklist";
import { WHEEL_KINDS } from "@/lib/wheels";

type RowState = "done" | "stopped" | "sending" | "device" | "missing" | "waiting";

/** One summary row: green only from the server's checklist; amber while its file is on this device or sending. */
function rowState(done: boolean, files: DeviceFile[], attempted: boolean): { state: RowState; progress: number } {
  if (done) return { state: "done", progress: 1 };
  if (files.some((f) => f.state === "stopped")) return { state: "stopped", progress: 0 };
  const sending = files.find((f) => f.state === "sending");
  if (sending) return { state: "sending", progress: sending.progress };
  if (files.length) return { state: "device", progress: 0 };
  return { state: attempted ? "missing" : "waiting", progress: 0 };
}

const ROW_LOOK: Record<RowState, { cls: string; icon: string }> = {
  done: { cls: "bg-green-soft text-green", icon: "✓" },
  stopped: { cls: "bg-red-soft text-red", icon: "!" },
  sending: { cls: "bg-amber-soft text-amber", icon: "↑" },
  device: { cls: "bg-amber-soft text-amber", icon: "↑" },
  missing: { cls: "bg-red-soft text-red", icon: "!" },
  waiting: { cls: "bg-chip text-muted", icon: "…" },
};

const rowWord = (s: { state: RowState; progress: number }) =>
  s.state === "done" ? "Done" : s.state === "stopped" ? "Not sent" : s.state === "sending" ? `Sending ${Math.round(s.progress * 100)}%` : s.state === "device" ? "On this device" : s.state === "missing" ? "Missing" : "Waiting";

/**
 * Required items with their state, and under them the line that names what is left. Shown on the PC, the tablet and
 * the phone; it refreshes live. A file still on this device (no signal yet, or on its way) shows amber "On this
 * device" - the item turns green only when the server's checklist counts it.
 */
export function ChecklistSummary({ check, attempted = false, device = [] }: { check: Checklist; attempted?: boolean; /** Gate-in files of this car still on this device. */ device?: DeviceFile[] }) {
  const wheelsDone = check.wheels.filter((w) => w.done).length;
  const of = (kinds: readonly string[]) => device.filter((f) => kinds.includes(f.kind));
  const damageOnDevice = of(["damage_photo"]).length;
  const rows: { key: string; label: string; done: boolean; files: DeviceFile[] }[] = [
    { key: "car_picture", label: "Car picture (for our dashboard)", done: check.carPicture, files: of(["car_picture"]) },
    { key: "video_exterior", label: "Exterior video", done: check.videoExterior, files: of(["video_exterior"]) },
    { key: "video_interior", label: "Interior video", done: check.videoInterior, files: of(["video_interior"]) },
    { key: "dashboard_photo", label: "Dashboard photo", done: check.dashboard, files: of(["dashboard_photo"]) },
    { key: "keys_photo_front", label: "Keys, front", done: check.keysFront, files: of(["keys_photo_front"]) },
    { key: "keys_photo_back", label: "Keys, back", done: check.keysBack, files: of(["keys_photo_back"]) },
    ...(check.wheelsRequired ? [{ key: "wheels", label: `Wheel photos with condition (${wheelsDone} of 4)`, done: wheelsDone === 4, files: of(WHEEL_KINDS) }] : []),
    ...(check.majorDamage ? [{ key: "damage_photo", label: `Damage photos (${check.damageCount}${damageOnDevice ? ` + ${damageOnDevice} on this device` : ""})`, done: check.damageCount > 0, files: of(["damage_photo"]) }] : []),
  ];
  const missing = missingItems(check);
  const uncovered = missing.filter((m) => !coveredByDevice(m, check, device));
  // Only on the device (never on the server's first render): the words for "this tablet" / "this phone".
  const where = device.length ? deviceWord() : "";
  const sendingLine = `${device.length} still sending from this ${where}`;
  const line = !device.length ? itemsLeftLine(missing) : uncovered.length ? `${itemsLeftLine(uncovered)} · ${sendingLine}` : `Nothing left to take: ${sendingLine}.`;
  return (
    <div className="flex flex-col gap-2" data-checklist-summary data-device-files={device.length}>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {rows.map((r) => {
          const s = rowState(r.done, r.files, attempted);
          const look = ROW_LOOK[s.state];
          return (
            <li key={r.key} className={`flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold ${look.cls}`} data-summary-row={r.key} data-summary-state={s.state}>
              <span className="w-5 text-center">{look.icon}</span>
              {r.label}
              <span className="ml-auto text-xs font-medium">{rowWord(s)}</span>
            </li>
          );
        })}
      </ul>
      {missing.length === 0 ? (
        <>
          <Notice tone="success">All uploads complete.</Notice>
          {device.length ? <p className="text-sm font-semibold text-amber" data-device-line>{sendingLine} – it carries on by itself.</p> : null}
        </>
      ) : (
        <p className={`text-sm ${attempted && uncovered.length ? "font-semibold text-red" : !uncovered.length ? "font-semibold text-amber" : "text-muted"}`} data-items-left>{line}</p>
      )}
    </div>
  );
}

/**
 * The full set of gate-in capture controls, used on the PC/tablet media step and on the phone page. One source
 * of truth: the checklist the server computes from the recorded files. Every file is kept on this device until the
 * server has it (THE send queue) and shows amber "on this device" meanwhile; the server's fresh checklist comes back
 * here the moment a file is recorded, so a tick turns green only when the gate-in counts the item as done; the
 * page's own refresh brings the same answer when the upload happened on another device. When someone presses the
 * finish button with items missing, those items turn red.
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
  const device = useDeviceFiles(jobId);
  const onChecklist = (c: Partial<Checklist>) => setCheck((cur) => ({ ...cur, ...c }));
  // Wheels are taken in order: each one unlocks once the previous photo is in, or on its way from this device.
  const wheelSteps = check.wheelsRequired ? check.wheels.length : 0;
  const damageStep = 7 + wheelSteps;
  const where = device.length ? deviceWord() : "";
  return (
    <div className="flex flex-col gap-4" data-media-checklist data-device-files={device.length}>
      <ChecklistSummary check={check} attempted={attempted} device={device} />
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
              <WheelCapture key={w.kind} jobId={jobId} wheel={w} step={7 + i} enabled={i === 0 || check.wheels[i - 1].photo || device.some((f) => f.kind === check.wheels[i - 1].kind)} token={token} attempted={attempted} onChecklist={onChecklist} />
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
      {check.complete ? (
        device.length ? (
          <Notice tone="info">
            <span data-device-line>
              Everything needed is in. {device.length} more {device.length === 1 ? "file is" : "files are"} still sending from this {where} – leave this page open until {device.length === 1 ? "it has" : "they have"} gone.
            </span>
          </Notice>
        ) : (
          <Notice tone="success">All done. You can close this page.</Notice>
        )
      ) : null}
    </div>
  );
}
