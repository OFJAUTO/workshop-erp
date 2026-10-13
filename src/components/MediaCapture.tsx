"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoButton } from "./PhotoButton";
import { reportUploadFailure, uploadFile, type UploadKind } from "@/lib/upload-client";
import type { Checklist } from "@/lib/media";
import { refreshWhenIdle } from "@/lib/refresh-idle";

/** Whether the server's checklist counts this kind of photo as done. */
function countedDone(c: Partial<Checklist>, kind: UploadKind): boolean | undefined {
  switch (kind) {
    case "dashboard_photo": return c.dashboard;
    case "keys_photo_front": return c.keysFront;
    case "keys_photo_back": return c.keysBack;
    case "car_picture": return c.carPicture;
    case "damage_photo": return c.damageCount === undefined ? undefined : c.damageCount > 0;
    case "wheel_fl": case "wheel_fr": case "wheel_rl": case "wheel_rr": return c.wheels?.find((w) => w.kind === kind)?.photo;
    default: return undefined;
  }
}

type Shot = { id: number; file: File; preview: string; status: "uploading" | "failed" | "done"; progress: number; error: string | null };

/**
 * One photo item of the gate-in: the camera opens inside the page (the picker on a PC), the picture stays on the
 * screen as a preview while it uploads, and the item turns green only when the server has recorded the file.
 * A failed or interrupted upload turns the item red, keeps the preview and offers Retry; nothing ever falls back
 * quietly to "Waiting". Every failure is logged with the device and the step.
 */
export function MediaCapture({
  jobId,
  kind,
  label,
  done = false,
  token,
  caption,
  multiple = false,
  disabled = false,
  hint,
  attempted = false,
  itemKey,
  onUploaded,
  onChecklist,
}: {
  /** The server's fresh checklist once a file is recorded. */
  onChecklist?: (c: Partial<Checklist>) => void;
  jobId: string;
  kind: UploadKind;
  label: string;
  done?: boolean;
  token?: string;
  caption?: string;
  multiple?: boolean;
  disabled?: boolean;
  hint?: string;
  /** Someone tried to finish the gate-in: a missing item shows in red. */
  attempted?: boolean;
  /** The item's key for "Go to next" (defaults to the kind); null when a wrapper carries the marker instead. */
  itemKey?: string | null;
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const [shots, setShots] = useState<Shot[]>([]);
  const [count, setCount] = useState(0);
  // Green only when the server counts the photo: the checklist from the upload, or the page's refresh.
  const [serverDone, setServerDone] = useState<boolean | null>(null);
  const [seenDone, setSeenDone] = useState(done);
  if (seenDone !== done) {
    setSeenDone(done);
    setServerDone(null);
  }
  // Previews are freed only when the item leaves the page, never while one is still on the screen.
  const shotsRef = useRef<Shot[]>([]);
  useEffect(() => { shotsRef.current = shots; }, [shots]);
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.preview)), []);

  const patch = (id: number, p: Partial<Shot>) => setShots((cur) => cur.map((s) => (s.id === id ? { ...s, ...p } : s)));

  async function uploadShot(shot: Shot) {
    patch(shot.id, { status: "uploading", progress: 0, error: null });
    const type = shot.file.type || "image/jpeg";
    try {
      const checklist = (await uploadFile(jobId, kind, shot.file, type, (x) => patch(shot.id, { progress: x }), { token, caption })) as Partial<Checklist>;
      const counted = countedDone(checklist, kind);
      if (counted === false) throw new Error("The file was sent but the gate-in did not count it. Tap Retry.");
      patch(shot.id, { status: "done", progress: 1 });
      setCount((c) => c + 1);
      if (counted !== undefined) setServerDone(counted);
      onChecklist?.(checklist);
      onUploaded?.();
      refreshWhenIdle(() => router.refresh());
    } catch (err) {
      patch(shot.id, { status: "failed", error: err instanceof Error ? err.message : "Upload failed." });
    }
  }

  async function onFiles(files: File[]) {
    const fresh: Shot[] = files.map((file, i) => ({ id: Date.now() + i, file, preview: URL.createObjectURL(file), status: "uploading", progress: 0, error: null }));
    // Done pictures of a single item are replaced by the new one; a multi item keeps them all.
    setShots((cur) => (multiple ? [...cur.filter((s) => s.status !== "done"), ...fresh] : fresh));
    for (const s of fresh) await uploadShot(s);
  }
  function retry() {
    const failed = shots.filter((s) => s.status === "failed");
    void (async () => { for (const s of failed) await uploadShot(s); })();
  }

  const finished = done || serverDone === true;
  const uploading = shots.some((s) => s.status === "uploading");
  const failed = shots.filter((s) => s.status === "failed");
  const red = failed.length > 0 || (attempted && !finished && !uploading);
  const current = shots.find((s) => s.status === "uploading") ?? null;
  const lastShot = shots[shots.length - 1] ?? null;
  const text = uploading
    ? `Uploading… ${Math.round((current?.progress ?? 0) * 100)}%`
    : failed.length
      ? failed[0].error ?? "Upload failed."
      : finished
        ? multiple
          ? `${count ? count + " added. " : ""}Tap to add more.`
          : "Done. Tap to take another."
        : disabled
          ? (hint ?? "Finish the step above first")
          : attempted
            ? "Missing. Tap to take the photo."
            : (hint ?? "Tap to take a photo");
  const tile = `flex min-h-16 w-full items-center justify-between gap-3 rounded-card border-2 px-4 text-left ${
    finished && !failed.length ? "border-green bg-green-soft" : red ? "border-red-bar bg-red-soft" : uploading ? "border-amber-bar bg-amber-soft" : disabled ? "border-line bg-chip opacity-60" : "border-line-strong bg-white"
  }`;

  return (
    <div className="flex flex-col gap-2" data-media-item={itemKey === null ? undefined : (itemKey ?? kind)} data-missing={itemKey === null ? undefined : finished ? "false" : "true"} data-media-status={uploading ? "uploading" : failed.length ? "failed" : finished ? "done" : "waiting"}>
      <div className="flex items-stretch gap-2">
        <PhotoButton source="camera" multiple={multiple} disabled={disabled || uploading} className={`${tile} flex-1`} title={label} onFiles={onFiles} onProblem={(m) => reportUploadFailure({ jobId, kind, step: "camera", error: m, token })}>
          <span className="flex items-center gap-3 min-w-0">
            {lastShot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lastShot.preview} alt="" className={`h-12 w-12 shrink-0 rounded-md object-cover ${lastShot.status === "failed" ? "opacity-70" : ""}`} />
            ) : null}
            <span className="flex flex-col min-w-0">
              <span className="font-bold">{label}</span>
              <span className={`text-xs ${failed.length ? "font-semibold text-red" : "text-muted"}`}>{text}</span>
            </span>
          </span>
          <span className={`text-2xl font-bold ${finished && !failed.length ? "text-green" : red ? "text-red" : "text-faint"}`}>{finished && !failed.length ? "✓" : uploading ? "…" : red ? "!" : "+"}</span>
        </PhotoButton>
        {!disabled ? (
          <PhotoButton source="gallery" multiple={multiple} disabled={uploading} className="shrink-0 w-20 rounded-card border-2 border-line bg-white text-[11px] font-bold leading-tight px-1" title={label} onFiles={onFiles}>
            From gallery
          </PhotoButton>
        ) : null}
      </div>
      {uploading ? (
        <div className="h-2 rounded-full bg-track overflow-hidden">
          <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round((current?.progress ?? 0) * 100)}%` }} />
        </div>
      ) : null}
      {failed.length ? (
        <button type="button" onClick={retry} className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-white self-start" data-retry>
          Retry{failed.length > 1 ? ` (${failed.length} photos)` : ""}
        </button>
      ) : null}
    </div>
  );
}
