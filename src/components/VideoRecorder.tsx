"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { VIDEO_BITRATE, VIDEO_TARGET, qualityProblem, qualityWords, recorderType } from "@/lib/video-quality";
import { holdIdleLock } from "@/lib/screen-hold";

/**
 * THE gate-in video recorder (9 November 2026, Section 7): the page records itself with the back camera at 1920 × 1080,
 * 30 fps (the phone's camera app through a web page gave 480 × 360), and hands over the file EXACTLY as recorded. A
 * camera that cannot give at least 720p is refused with words. Stops by itself at the time limit.
 */
export function VideoRecorder({ maxSeconds = 240, onDone, onClose, onFallback }: { maxSeconds?: number; onDone: (file: File, info: { width: number; height: number }) => void; onClose: () => void; /** "Use the camera app instead" (the inspection, 12 November 2026). */ onFallback?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<{ width: number; height: number; fps: number | null } | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // The tablet's idle lock never signs out while the recorder is open (the video would be lost).
  useEffect(() => holdIdleLock("recording a video", 15 * 60_000), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setError("This browser cannot record video here. Use Safari on iPhone or Chrome on Android.");
        return;
      }
      const ask = (audio: boolean) => navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: VIDEO_TARGET.width }, height: { ideal: VIDEO_TARGET.height }, frameRate: { ideal: VIDEO_TARGET.fps } }, audio });
      let stream: MediaStream;
      try {
        stream = await ask(true).catch(() => ask(false));
      } catch {
        setError("The camera is not allowed. Allow the camera for erp.ofjauto.com in the phone's settings, then try again.");
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const s = stream.getVideoTracks()[0]?.getSettings() ?? {};
      const width = Number(s.width) || 0;
      const height = Number(s.height) || 0;
      setQuality({ width, height, fps: s.frameRate ?? null });
      const problem = qualityProblem(width, height, "camera");
      if (problem) setError(problem);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => null);
      }
    })();
    return () => {
      cancelled = true;
      if (recRef.current?.state === "recording") recRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  function start() {
    const stream = streamRef.current;
    if (!stream || error) return;
    const type = recorderType((t) => MediaRecorder.isTypeSupported(t));
    chunks.current = [];
    const rec = new MediaRecorder(stream, { ...(type.mimeType ? { mimeType: type.mimeType } : {}), videoBitsPerSecond: VIDEO_BITRATE });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: type.contentType });
      const file = new File([blob], `video-${Date.now()}.${type.ext}`, { type: type.contentType });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onDone(file, { width: quality?.width ?? 0, height: quality?.height ?? 0 });
    };
    rec.start(1000);
    recRef.current = rec;
    // The time limit: the recording stops by itself.
    limitTimer.current = setTimeout(() => { if (recRef.current?.state === "recording") recRef.current.stop(); setRecording(false); }, maxSeconds * 1000);
    setSeconds(0);
    setRecording(true);
  }
  function stop() {
    if (limitTimer.current) clearTimeout(limitTimer.current);
    if (recRef.current?.state === "recording") recRef.current.stop();
    setRecording(false);
  }

  const mm = String(Math.floor(seconds / 60));
  const ss = String(seconds % 60).padStart(2, "0");
  const box = (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" data-video-recorder>
      <video ref={videoRef} muted playsInline className="min-h-0 flex-1 object-contain" />
      <div className="flex flex-col gap-2 p-4">
        {quality ? <span className="text-center text-xs" data-recorder-quality>{qualityWords(quality.width, quality.height, quality.fps)}</span> : null}
        {error ? <p className="rounded-control bg-red-soft px-3 py-2 text-sm font-semibold text-red" data-recorder-error>{error}</p> : null}
        {recording ? <span className="text-center text-lg font-extrabold" data-recorder-time>● {mm}:{ss} / {Math.floor(maxSeconds / 60)}:00</span> : null}
        <div className="flex gap-2">
          {!recording ? <Button type="button" size="lg" className="flex-1" disabled={!quality || !!error} onClick={start} data-recorder-start>Start recording</Button> : <Button type="button" size="lg" tone="danger" className="flex-1" onClick={stop} data-recorder-stop>Stop</Button>}
          {!recording ? <Button type="button" size="lg" tone="secondary" onClick={onClose} data-recorder-close>Cancel</Button> : null}
        </div>
        {!recording && onFallback ? (
          <button type="button" onClick={onFallback} className="min-h-11 text-sm font-semibold underline underline-offset-4" data-recorder-fallback>
            Use the camera app instead
          </button>
        ) : null}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(box, document.body);
}
