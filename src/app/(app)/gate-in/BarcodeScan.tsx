"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

type Detector = { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

/** Scans the VIN barcode (door jamb or windscreen) with the camera and searches for it. */
export function BarcodeScan() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => () => stop(), []);

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function start() {
    setMessage(null);
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      streamRef.current = stream;
      setOpen(true);
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const detector = new Ctor({ formats: ["code_39", "code_128", "qr_code", "data_matrix"] });
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await detector.detect(video);
          const hit = codes.map((c) => c.rawValue.trim().toUpperCase()).find((v) => v.length >= 6);
          if (hit) {
            stop();
            setOpen(false);
            router.push(`/gate-in?q=${encodeURIComponent(hit)}`);
            return;
          }
        } catch {
          // keep scanning
        }
        setTimeout(tick, 250);
      };
      tick();
    } catch {
      setMessage("Camera not available. Type the plate or VIN instead.");
      setOpen(false);
    }
  }

  if (!supported) return <p className="text-xs text-muted">Barcode scanning needs Chrome on Android or a recent desktop Chrome.</p>;

  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <Button tone="secondary" size="lg" onClick={start}>
          Scan VIN barcode
        </Button>
      ) : (
        <div className="flex flex-col gap-2 max-w-md">
          <video ref={videoRef} playsInline muted className="w-full rounded-card bg-black aspect-video" />
          <Button tone="ghost" onClick={() => { stop(); setOpen(false); }}>
            Cancel
          </Button>
        </div>
      )}
      {message ? <p className="text-xs text-red font-semibold">{message}</p> : null}
    </div>
  );
}
