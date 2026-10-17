"use client";

import { useRef, useState } from "react";

/**
 * The driver's page: one big button, the camera, one price box, SEND. Nothing else to read or choose, nothing about
 * invoices. Works once; afterwards it only says "Done, thank you".
 */
export function DriveClient({ token, kind }: { token: string; kind: "delivery" | "pickup" }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const word = kind === "pickup" ? "LOADED" : "DELIVERED";

  const send = async () => {
    if (!photo || !(Number(price.replace(",", ".")) > 0)) { setError("Enter the price in AED."); return; }
    setState("sending");
    setError(null);
    try {
      const fd = new FormData();
      fd.set("photo", photo);
      fd.set("price", price);
      const r = await fetch(`/api/drive/${token}`, { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { setError(j.error ?? "It did not go through. Try again."); setState("idle"); return; }
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
          <label className="flex flex-col gap-2">
            <span className="text-2xl font-extrabold">PRICE (AED)</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" className="min-h-16 rounded-xl border-2 border-[#111113] px-4 text-3xl font-extrabold" data-drive-price />
          </label>
          <button type="button" disabled={state === "sending"} onClick={send} className="min-h-16 rounded-2xl bg-[#111113] px-6 text-2xl font-extrabold text-white disabled:opacity-50" data-drive-send>
            {state === "sending" ? "SENDING…" : "SEND"}
          </button>
        </>
      )}
      {error ? <p className="text-center text-base font-bold text-[#B3261E]">{error}</p> : null}
    </div>
  );
}
