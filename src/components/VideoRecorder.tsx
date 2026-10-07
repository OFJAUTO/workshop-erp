"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { uploadFile } from "@/lib/upload-client";

const MAX_SECONDS = 90;
const BITRATE = 3_500_000; // about 40 MB for a full 90-second 1080p recording

type Phase = "idle" | "ready" | "recording" | "review" | "uploading" | "done" | "unsupported";

/**
 * Records the walk-around video in the browser: 1080p where the camera allows,
 * stops by itself at 90 seconds, then uploads with a progress bar.
 */
export function VideoRecorder({ jobId, token, done = false }: { jobId: string; token?: string; done?: boolean }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [phase, setPhase] = useState<Phase>(done ? "done" : "idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => stopStream(), []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
  }

  async function startCamera() {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("ready");
    } catch {
      setError("Camera not available. Allow camera access, or use the file option below.");
      setPhase("unsupported");
    }
  }

  function pickMime() {
    const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: BITRATE } : { videoBitsPerSecond: BITRATE });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mimeType || "video/webm";
      const b = new Blob(chunksRef.current, { type });
      setBlob(b);
      setBlobUrl(URL.createObjectURL(b));
      setPhase("review");
      if (videoRef.current) videoRef.current.srcObject = null;
      stopStream();
    };
    recorderRef.current = rec;
    rec.start(1000);
    setSeconds(0);
    setPhase("recording");
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) {
          stopRecording();
          return MAX_SECONDS;
        }
        return s + 1;
      });
    }, 1000);
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function upload(file: Blob, duration: number | undefined) {
    setPhase("uploading");
    setError(null);
    try {
      const type = (file.type || "video/webm").split(";")[0];
      await uploadFile(jobId, "video", file, type, setProgress, { duration, token });
      setPhase("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setPhase("review");
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      setError("That video is over 200 MB. Record a shorter one.");
      return;
    }
    await upload(file, undefined);
    e.target.value = "";
  }

  const finished = phase === "done";

  return (
    <div className={`flex flex-col gap-3 rounded-card border-2 p-4 ${finished ? "border-green bg-green-soft" : "border-line-strong bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="font-bold">Walk-around video</span>
          <span className="text-xs text-muted">Exterior, interior and dashboard. Up to 90 seconds, stops by itself.</span>
        </span>
        <span className={`text-2xl font-bold ${finished ? "text-green" : "text-faint"}`}>{finished ? "✓" : "●"}</span>
      </div>

      {phase === "idle" ? (
        <Button size="lg" onClick={startCamera}>
          Open camera
        </Button>
      ) : null}

      {phase === "ready" || phase === "recording" ? (
        <div className="flex flex-col gap-3">
          <video ref={videoRef} playsInline autoPlay muted className="w-full rounded-card bg-black aspect-video" />
          {phase === "ready" ? (
            <Button size="lg" onClick={startRecording}>
              Start recording
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-3 w-3 rounded-full bg-red-bar animate-pulse" />
              <span className="font-bold tabular-nums">
                {seconds}s / {MAX_SECONDS}s
              </span>
              <Button tone="danger" size="lg" onClick={stopRecording} className="ml-auto">
                Stop
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {phase === "review" && blobUrl && blob ? (
        <div className="flex flex-col gap-3">
          <video src={blobUrl} controls playsInline className="w-full rounded-card bg-black aspect-video" />
          <p className="text-xs text-muted">
            {seconds}s · {(blob.size / 1024 / 1024).toFixed(1)} MB
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => upload(blob, seconds)}>
              Upload this video
            </Button>
            <Button tone="secondary" size="lg" onClick={() => { setBlob(null); setBlobUrl(null); startCamera(); }}>
              Record again
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "uploading" ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Uploading… {Math.round(progress * 100)}%</span>
          <div className="h-2 rounded-full bg-track overflow-hidden">
            <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="text-xs text-muted">Keep this page open until it finishes.</p>
        </div>
      ) : null}

      {phase === "done" ? <p className="text-sm font-semibold text-green">Video uploaded.</p> : null}

      {phase === "unsupported" || phase === "idle" ? (
        <label className="text-xs text-muted cursor-pointer underline underline-offset-4">
          Or choose a video file from this device
          <input type="file" accept="video/*" capture="environment" onChange={onFile} className="sr-only" />
        </label>
      ) : null}

      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
    </div>
  );
}
