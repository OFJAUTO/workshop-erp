"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Facing = "environment" | "user";
type Problem = { kind: "denied" | "nocamera" | "busy" | "other"; message: string };

/** The device, for the permission steps: iPad Safari reports itself as a Mac with touch. */
export function devicePlatform(): "ipad" | "iphone" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ipad";
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** The exact taps to allow the camera again, for the device in hand. */
export function cameraPermissionSteps(platform = devicePlatform()): string[] {
  switch (platform) {
    case "ipad":
    case "iphone":
      return [
        "Tap the small \"AA\" (or the page settings button) at the left of the address bar.",
        "Tap Website Settings, then Camera, then Allow.",
        "Reload this page and tap the photo button again.",
        "If Camera is not listed there: open the Settings app, scroll to Safari, tap Camera and choose Allow or Ask.",
      ];
    case "android":
      return [
        "Tap the lock (or the tune icon) at the left of the address bar.",
        "Tap Permissions, then Camera, then Allow.",
        "Reload this page and tap the photo button again.",
        "If the camera is still blocked: Android Settings, Apps, Chrome, Permissions, Camera, Allow.",
      ];
    default:
      return ["Click the camera icon at the right of the address bar and choose Allow.", "Reload this page and click the photo button again."];
  }
}

function problemOf(err: unknown): Problem {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return { kind: "denied", message: "The browser has blocked the camera for this site." };
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return { kind: "nocamera", message: "No camera was found on this device." };
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return { kind: "busy", message: "The camera is in use by another app. Close it and try again." };
  return { kind: "other", message: err instanceof Error && err.message ? err.message : "The camera could not be opened." };
}

/**
 * The camera inside the page: a live preview, one big shutter, Flip, and Done. No switch to the camera app, so the
 * page is never reloaded behind the photo and the picture always comes back. If the browser has blocked the camera,
 * the exact steps to allow it on this device are shown; "Use the camera app instead" is always there.
 */
export function CameraCapture({ multiple = false, title = "Take a photo", onCapture, onClose, onFallback, onProblem }: { multiple?: boolean; title?: string; onCapture: (files: File[]) => void; onClose: () => void; onFallback: () => void; /** A camera that would not open: logged by the caller. */ onProblem?: (problem: Problem) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);
  const [flash, setFlash] = useState(false);
  const [canFlip, setCanFlip] = useState(false);
  // "Try again" after a problem reopens the camera.
  const [attempt, setAttempt] = useState(0);
  const onProblemRef = useRef(onProblem);
  useEffect(() => { onProblemRef.current = onProblem; }, [onProblem]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function open() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem({ kind: "other", message: "This browser cannot open the camera from a page." });
        return;
      }
      const tryGet = async (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints);
      let stream: MediaStream;
      try {
        try {
          stream = await tryGet({ video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
        } catch (first) {
          const p = problemOf(first);
          if (p.kind === "denied" || p.kind === "nocamera") throw first;
          stream = await tryGet({ video: true, audio: false });
        }
      } catch (err) {
        if (cancelled) return;
        const p = problemOf(err);
        setProblem(p);
        onProblemRef.current?.(p);
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.muted = true;
        v.setAttribute("playsinline", "true");
        try {
          await v.play();
        } catch {
          // Some browsers start the preview by themselves.
        }
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
      } catch {
        setCanFlip(false);
      }
      setReady(true);
    }
    void open();
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, attempt, stop]);

  // The small previews are freed when the camera closes, never while they are on the screen.
  const shotsRef = useRef<{ url: string }[]>([]);
  useEffect(() => { shotsRef.current = shots; }, [shots]);
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  async function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) {
      setProblem({ kind: "other", message: "The photo could not be saved from the camera. Try again, or use the camera app." });
      return;
    }
    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
    if (!multiple) {
      stop();
      onCapture([file]);
      return;
    }
    setShots((s) => [...s, { file, url: URL.createObjectURL(blob) }]);
  }

  function finish() {
    stop();
    onCapture(shots.map((s) => s.file));
  }

  const steps = problem?.kind === "denied" ? cameraPermissionSteps() : [];

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={title} data-camera>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm font-bold">{title}{multiple && shots.length ? ` · ${shots.length} taken` : ""}</span>
        <button type="button" onClick={() => { stop(); onClose(); }} className="min-h-11 min-w-11 rounded-control border border-white/30 px-3 text-sm font-bold" aria-label="Close the camera">✕</button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center">
        <video ref={videoRef} autoPlay muted playsInline className={`max-h-full max-w-full ${ready ? "" : "opacity-0"}`} />
        {flash ? <div className="absolute inset-0 bg-white/80" /> : null}
        {!ready && !problem ? <p className="absolute text-sm text-white/80">Opening the camera…</p> : null}
        {problem ? (
          <div className="absolute inset-x-4 top-4 rounded-card bg-white p-4 text-ink flex flex-col gap-2 max-w-md mx-auto">
            <span className="font-bold">{problem.message}</span>
            {steps.length ? (
              <ol className="list-decimal pl-5 text-sm flex flex-col gap-1">
                {steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={() => { setProblem(null); setReady(false); setAttempt((a) => a + 1); }} className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Try again</button>
              <button type="button" onClick={() => { stop(); onFallback(); }} className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-white">Use the camera app instead</button>
            </div>
          </div>
        ) : null}
        {multiple && shots.length ? (
          <div className="absolute bottom-2 left-2 right-2 flex gap-1.5 overflow-x-auto">
            {shots.map((s, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={s.url} src={s.url} alt={`Photo ${i + 1}`} className="h-14 w-14 shrink-0 rounded-md object-cover border border-white/40" />
            ))}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-3 items-center px-6 py-4">
        <button type="button" onClick={() => { stop(); onFallback(); }} className="justify-self-start min-h-11 text-xs font-semibold text-white/80 underline underline-offset-4">Use the camera app</button>
        <button type="button" onClick={shoot} disabled={!ready} aria-label="Take the photo" className="justify-self-center h-18 w-18 rounded-full border-4 border-white bg-white/20 disabled:opacity-40">
          <span className="block h-full w-full rounded-full bg-white scale-75" />
        </button>
        <div className="justify-self-end flex items-center gap-2">
          {canFlip ? <button type="button" onClick={() => { setReady(false); setProblem(null); setFacing((f) => (f === "environment" ? "user" : "environment")); }} className="min-h-11 rounded-control border border-white/30 px-3 text-xs font-bold">Flip</button> : null}
          {multiple ? <button type="button" onClick={finish} disabled={shots.length === 0} className="min-h-11 rounded-control bg-white px-4 text-sm font-bold text-ink disabled:opacity-40">Done{shots.length ? ` (${shots.length})` : ""}</button> : null}
        </div>
      </div>
    </div>
  );
}
