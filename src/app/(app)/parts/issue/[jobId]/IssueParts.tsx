"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "@/components/ui";

type Detector = { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

export type IssuePart = { id: string; description: string; part_number: string | null; label_code: string | null; received_qty: number; issue_status: string; return_status: string; on_approved_po: boolean };

/**
 * Issue parts: Parts scan each label (tablet or phone camera, or type the code), the technician
 * ticks each part one by one and enters his PIN. There is no "confirm all".
 */
export function IssueParts({ parts, technicians, action }: { parts: IssuePart[]; technicians: { id: string; display_name: string }[]; action: (formData: FormData) => void }) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [scanOpen, setScanOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const issuable = parts.filter((p) => p.issue_status !== "confirmed" && p.return_status === "none" && p.received_qty > 0 && p.on_approved_po);

  useEffect(() => () => stop(), []);
  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  function applyCode(raw: string) {
    const c = raw.trim().toUpperCase();
    const hit = issuable.find((p) => (p.label_code ?? "").toUpperCase() === c);
    if (!hit) {
      setMessage(`Label ${c} is not a part of this job waiting to be issued.`);
      return;
    }
    setTicked((t) => ({ ...t, [hit.id]: true }));
    setMessage(`Scanned: ${hit.description}. The technician ticks it below.`);
    setCode("");
  }
  async function startScan() {
    setMessage(null);
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) {
      setMessage("This browser cannot scan with the camera. Type the code from the label instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      streamRef.current = stream;
      setScanOpen(true);
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const detector = new Ctor({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await detector.detect(video);
          const hit = codes.map((c) => c.rawValue.trim())[0];
          if (hit) {
            applyCode(hit);
            setTimeout(tick, 1500);
            return;
          }
        } catch {
          // keep scanning
        }
        setTimeout(tick, 250);
      };
      tick();
    } catch {
      setMessage("Camera not available. Type the code from the label instead.");
      setScanOpen(false);
    }
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        {!scanOpen ? (
          <Button type="button" size="md" onClick={startScan}>Scan a label</Button>
        ) : (
          <Button type="button" tone="secondary" size="md" onClick={() => { stop(); setScanOpen(false); }}>Stop scanning</Button>
        )}
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Or type the label code</span><Input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCode(code); } }} className="w-44 font-mono uppercase" /></label>
        <Button type="button" tone="secondary" size="md" onClick={() => applyCode(code)}>Find</Button>
      </div>
      {scanOpen ? <video ref={videoRef} muted playsInline className="w-full max-w-md rounded-card bg-black aspect-[4/3]" /> : null}
      {message ? <p className="text-sm font-semibold">{message}</p> : null}

      <ul className="divide-y divide-line">
        {parts.map((p) => {
          const can = issuable.some((x) => x.id === p.id);
          return (
            <li key={p.id} className="py-3 flex flex-wrap items-center gap-3">
              <label className={`flex items-center gap-3 flex-1 min-w-64 ${can ? "cursor-pointer" : "opacity-60"}`}>
                <input type="checkbox" name="part" value={p.id} checked={!!ticked[p.id]} disabled={!can} onChange={(e) => setTicked({ ...ticked, [p.id]: e.target.checked })} className="h-6 w-6 accent-ink" />
                <span>
                  <span className="font-semibold">{p.description}</span>
                  <span className="block text-xs text-muted">{p.part_number ?? "no part number"} · {p.label_code ?? "no label yet"} · received {p.received_qty}</span>
                </span>
              </label>
              <span className="text-xs font-semibold">
                {p.issue_status === "confirmed" ? "Issued and confirmed" : p.return_status !== "none" ? "Marked for return" : !p.on_approved_po ? "Not on an approved purchase order" : p.received_qty <= 0 ? "Not received yet" : ticked[p.id] ? "Ticked by the technician" : "Waiting"}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="rounded-card border border-ink p-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician taking the parts</span>
          <Select name="technician" required className="w-56">
            <option value="">Choose…</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician&apos;s PIN</span><Input name="pin" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" required className="w-28 text-center tracking-[0.4em]" /></label>
        <Button type="submit" size="lg" disabled={!Object.values(ticked).some(Boolean)}>Issue the ticked parts</Button>
        <p className="w-full text-xs text-muted">Each part is ticked one by one. The PIN confirms the technician took them.</p>
      </div>
    </form>
  );
}
