"use client";

import { useRef, useState } from "react";

/**
 * The driver's page, big buttons only. A DELIVERY is one step: "Delivered to the customer" with the
 * photo, then the price, SEND. A PICK-UP is two: "Car loaded" with a photo first (OFJ sees it is on the
 * way), then "Delivered to OFJ" with a photo and the price. Works once; afterwards "Done, thank you".
 */
export function DriveClient({ token, kind, loadedAt = null }: { token: string; kind: "delivery" | "pickup"; loadedAt?: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [loaded, setLoaded] = useState(!!loadedAt);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  // The step on screen: a pick-up first loads the car, then delivers it to OFJ.
  const step: "loaded" | "final" = kind === "pickup" && !loaded ? "loaded" : "final";
  const word = step === "loaded" ? "CAR LOADED" : kind === "pickup" ? "DELIVERED TO OFJ" : "DELIVERED TO THE CUSTOMER";

  const send = async () => {
    if (!photo) { setError("Take the photo first."); return; }
    if (step === "final" && !(Number(price.replace(",", ".")) > 0)) { setError("Enter the price in AED."); return; }
    setState("sending");
    setError(null);
    try {
      const fd = new FormData();
      fd.set("photo", photo);
      if (step === "loaded") fd.set("step", "loaded");
      else fd.set("price", price);
      const r = await fetch(`/api/drive/${token}`, { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { setError(j.error ?? "It did not go through. Try again."); setState("idle"); return; }
      if (step === "loaded") {
        // On to step two: a fresh photo for the arrival at OFJ.
        setLoaded(true);
        setPhoto(null);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("No connection. Try again.");
      setState("idle");
    }
  };

  if (state === "done") {
    return <div className="flex min-h-[60vh] items-center justify-center p-6"><p className="text-center text-3xl font-extrabold">Done. Thank you!</p></div>;
  }
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 p-5">
      {kind === "pickup" ? (
        <div className="flex items-center gap-2 text-sm font-extrabold" data-drive-steps>
          <span className={`rounded-full px-3 py-1 ${step === "loaded" ? "bg-[#111113] text-white" : "bg-[#E8F5EC] text-[#1b6b2f]"}`}>1 · Car loaded{loaded ? " ✓" : ""}</span>
          <span className={`rounded-full px-3 py-1 ${step === "final" ? "bg-[#111113] text-white" : "bg-[#F4F4F5] text-[#5F6368]"}`}>2 · Delivered to OFJ</span>
        </div>
      ) : null}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setPhoto(f); setPreview(f ? URL.createObjectURL(f) : null); }} />
      {!photo ? (
        <button type="button" onClick={() => fileRef.current?.click()} className="flex min-h-40 w-full items-center justify-center rounded-2xl bg-[#111113] px-6 text-center text-3xl font-extrabold leading-tight text-white" data-drive-photo>
          {word}:<br />TAKE PHOTO
        </button>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="The photo" className="w-full rounded-2xl border-2 border-[#111113]" /> : null}
          <button type="button" onClick={() => fileRef.current?.click()} className="min-h-12 rounded-xl border-2 border-[#111113] bg-white px-4 text-base font-extrabold">Retake photo</button>
          {step === "final" ? (
            <label className="flex flex-col gap-2">
              <span className="text-2xl font-extrabold">PRICE (AED)</span>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" className="min-h-16 rounded-xl border-2 border-[#111113] px-4 text-3xl font-extrabold" data-drive-price />
            </label>
          ) : null}
          <button type="button" disabled={state === "sending"} onClick={send} className="min-h-16 rounded-2xl bg-[#111113] px-6 text-2xl font-extrabold text-white disabled:opacity-50" data-drive-send>
            {state === "sending" ? "SENDING…" : "SEND"}
          </button>
        </>
      )}
      {error ? <p className="text-center text-base font-bold text-[#B3261E]">{error}</p> : null}
    </div>
  );
}
