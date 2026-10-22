"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";

export type TabletCar = { jobId: string; plate: string; title: string; colour: string | null; stage: string; due: string | null; tone: "red" | "amber" | "normal"; pictureUrl: string | null; onCar: { id: string; name: string; clocked: boolean }[]; coming: boolean; readyParts?: { id: string; description: string; quantity: number }[]; /** Section 10: the PPF cutting method badge (HAND-CUT / PRE-CUT / MIXED). */ cut?: { badge: string; note: string | null } | null; /** Section 11: the tint choice per window, in the documents' words. */ tint?: string | null };
export type TabletPerson = { id: string; name: string; photoUrl: string | null; clockedOn: string | null };

/** A tablet photo redrawn as a JPEG of at most 1600 px (a few hundred KB); the original when the browser cannot decode it. */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * The shared section tablet: the section's cars in due order; tap a car, tap your face, type your PIN, and you are
 * clocked in (or out). Nothing else, no typing. Refreshes itself every half minute.
 */
export function SectionTablet({ section, cars, people }: { section: string; cars: TabletCar[]; people: TabletPerson[] }) {
  const router = useRouter();
  const [carId, setCarId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState<"clock" | "parts" | "tint" | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);
  const car = cars.find((c) => c.jobId === carId) ?? null;
  const person = people.find((p) => p.id === personId) ?? null;
  const direction: "in" | "out" = person && car && person.clockedOn === car.jobId ? "out" : "in";

  const readyParts = car?.readyParts ?? [];
  const tickedParts = readyParts.filter((p) => !unticked.has(p.id));
  const receiving = mode === "parts" && readyParts.length > 0;
  const tintPhoto = mode === "tint" && !!car?.tint;
  async function submit(fullPin: string) {
    if (!car || !person || busy) return;
    if (tintPhoto && !photo) { setNote({ text: "Take the photo first.", ok: false }); setPin(""); return; }
    setBusy(true);
    let res: Response;
    if (tintPhoto && photo) {
      const fd = new FormData();
      fd.set("jobId", car.jobId);
      fd.set("staffId", person.id);
      fd.set("pin", fullPin);
      fd.set("action", "tint_photo");
      fd.set("photo", photo.blob, "tint-fitted.jpg");
      res = await fetch("/api/tablet/bodyshop", { method: "POST", body: fd });
    } else {
      res = await fetch("/api/tablet/bodyshop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(receiving ? { jobId: car.jobId, staffId: person.id, pin: fullPin, action: "receive_parts", partIds: tickedParts.map((p) => p.id) } : { jobId: car.jobId, staffId: person.id, pin: fullPin, action: direction }) });
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
    setBusy(false);
    setPin("");
    if (!res.ok || !data.ok) {
      setNote({ text: data.error ?? "Try again.", ok: false });
      return;
    }
    setNote({ text: data.message ?? "Done.", ok: true });
    setPersonId(null);
    setCarId(null);
    setMode(null);
    setUnticked(new Set());
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    router.refresh();
  }
  const press = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) void submit(next);
  };

  return (
    <div className="flex flex-col gap-4" data-section-tablet={section}>
      {note ? <div className={`rounded-control px-4 py-3 text-base font-bold ${note.ok ? "bg-green-soft text-green" : "bg-red-soft text-red"}`} data-tablet-note>{note.text}</div> : null}
      {!car ? (
        <div className="flex flex-col gap-2">
          {cars.length === 0 ? <p className="text-lg text-muted">No cars for this section right now.</p> : null}
          {cars.map((c) => (
            <button key={c.jobId} type="button" onClick={() => setCarId(c.jobId)} className={`flex items-center gap-4 rounded-card border-2 bg-white p-3 text-left min-h-20 ${c.tone === "red" ? "border-red-bar" : c.tone === "amber" ? "border-amber-bar" : "border-line-strong"} ${c.coming ? "opacity-70" : ""}`} data-tablet-car={c.jobId}>
              {c.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.pictureUrl} alt="" className="h-16 w-24 shrink-0 rounded-control object-cover bg-chip" />
              ) : <span className="h-16 w-24 shrink-0 rounded-control bg-chip" />}
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-xl font-extrabold tracking-[0.03em]">{c.plate} <span className="text-base font-semibold text-muted">· {c.title}{c.colour ? ` · ${c.colour}` : ""}</span></span>
                {c.cut ? <span className="inline-flex w-fit items-center rounded-control bg-ink px-3 py-1 text-base font-extrabold tracking-[0.08em] text-white" data-cut-badge={c.cut.badge}>{c.cut.badge}{c.cut.note ? ` · ${c.cut.note}` : ""}</span> : null}
                {c.tint ? <span className="text-base font-bold" data-tint-summary>Tint: {c.tint}</span> : null}
                <span className="text-base text-muted">{c.coming ? `Coming: ${c.stage}` : c.stage}{c.onCar.length ? ` · ${c.onCar.map((p) => `${p.name}${p.clocked ? " ●" : ""}`).join(", ")}` : ""}</span>
              </span>
              <span className={`text-base font-bold ${c.tone === "red" ? "text-red" : c.tone === "amber" ? "text-amber" : "text-muted"}`}>{c.tone === "red" ? "Late" : c.tone === "amber" ? "Due today" : c.due ?? ""}</span>
            </button>
          ))}
        </div>
      ) : !person ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xl font-extrabold">{car.plate} · {car.title}</span>
            <button type="button" onClick={() => setCarId(null)} className="min-h-12 rounded-control border border-line-strong bg-white px-4 text-base font-bold">Back</button>
          </div>
          <p className="text-base text-muted">Who are you? Tap your face.</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {people.map((p) => (
              <button key={p.id} type="button" onClick={() => setPersonId(p.id)} className={`flex flex-col items-center gap-2 rounded-card border-2 bg-white p-3 min-h-28 ${p.clockedOn === car.jobId ? "border-green" : "border-line-strong"}`} data-tablet-person={p.id}>
                <Avatar name={p.name} photoUrl={p.photoUrl} size={64} />
                <span className="text-base font-bold text-center leading-tight">{p.name}</span>
                {p.clockedOn === car.jobId ? <span className="text-[11px] font-bold text-green">On this car · tap to clock out</span> : p.clockedOn ? <span className="text-[11px] text-muted">On another car</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : (readyParts.length || car.tint) && mode === null ? (
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={person.name} photoUrl={person.photoUrl} size={56} />
            <span className="text-xl font-extrabold">{person.name}</span>
          </div>
          <p className="text-base"><span className="font-bold">{car.plate} · {car.title}</span>: what are you doing?</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => setMode("clock")} className="min-h-16 rounded-card border-2 border-line-strong bg-white px-6 text-lg font-extrabold" data-tablet-mode-clock>{direction === "in" ? "Clock in" : "Clock out"}</button>
            {readyParts.length ? <button type="button" onClick={() => setMode("parts")} className="min-h-16 rounded-card border-2 border-ink bg-white px-6 text-lg font-extrabold" data-tablet-mode-parts>Receive {readyParts.length} part{readyParts.length === 1 ? "" : "s"}</button> : null}
            {car.tint ? <button type="button" onClick={() => setMode("tint")} className="min-h-16 rounded-card border-2 border-ink bg-white px-6 text-lg font-extrabold" data-tablet-mode-tint>Tint fitted · photo</button> : null}
          </div>
          <button type="button" onClick={() => { setPersonId(null); setPin(""); }} className="min-h-12 rounded-control border border-line-strong bg-white px-5 text-base font-bold">Back</button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={person.name} photoUrl={person.photoUrl} size={56} />
            <span className="text-xl font-extrabold">{person.name}</span>
          </div>
          {receiving ? (
            <div className="w-full max-w-md flex flex-col gap-1" data-tablet-ready-parts>
              <p className="text-base">Tick the parts you are taking for <span className="font-bold">{car.plate}</span>:</p>
              {readyParts.map((p) => {
                const on = !unticked.has(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => setUnticked((u) => { const n = new Set(u); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} aria-pressed={on} className={`flex w-full min-h-12 items-center gap-3 rounded-control px-2 text-left ${on ? "bg-chip" : ""}`}>
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control border text-xs font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong text-transparent"}`}>✓</span>
                    <span className="flex-1 font-semibold">{p.description}</span>
                    <span>× {p.quantity}</span>
                  </button>
                );
              })}
              <p className="text-base mt-2">Then your PIN ({tickedParts.length} ticked):</p>
            </div>
          ) : tintPhoto ? (
            <div className="w-full max-w-md flex flex-col items-center gap-2" data-tablet-tint-photo>
              <p className="text-base text-center"><span className="font-bold">{car.plate}</span> · Tint: {car.tint}</p>
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="Tint after fitting" className="max-h-56 rounded-card object-contain bg-chip" data-tablet-tint-preview />
              ) : null}
              <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-card border-2 border-line-strong bg-white px-6 text-lg font-extrabold">
                {photo ? "Take it again" : "Take the photo"}
                <input type="file" accept="image/*" capture="environment" className="sr-only" data-tablet-tint-file onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const blob = await shrinkPhoto(f); if (photo) URL.revokeObjectURL(photo.url); setPhoto({ blob, url: URL.createObjectURL(blob) }); }} />
              </label>
              <p className="text-base mt-1">{photo ? "Then your PIN:" : "Take the photo, then your PIN."}</p>
            </div>
          ) : (
            <p className="text-base">{direction === "in" ? "Clock in on" : "Clock out of"} <span className="font-bold">{car.plate} · {car.title}</span>. Your PIN:</p>
          )}
          <div className="flex gap-3" aria-label="PIN">{[0, 1, 2, 3].map((i) => <span key={i} className={`h-4 w-4 rounded-full ${pin.length > i ? "bg-ink" : "border border-line-strong"}`} />)}</div>
          <div className="grid grid-cols-3 gap-3" data-pin-pad>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) => (
              <button key={i} type="button" disabled={busy || k === ""} onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : press(k))} className={`h-16 w-20 rounded-card text-2xl font-extrabold ${k === "" ? "invisible" : "border-2 border-line-strong bg-white"}`}>{k}</button>
            ))}
          </div>
          <button type="button" onClick={() => { if (mode) { setMode(null); } else { setPersonId(null); } setPin(""); }} className="min-h-12 rounded-control border border-line-strong bg-white px-5 text-base font-bold">Back</button>
        </div>
      )}
    </div>
  );
}
