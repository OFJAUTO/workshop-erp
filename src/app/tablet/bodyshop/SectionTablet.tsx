"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";

export type TabletCar = { jobId: string; plate: string; title: string; colour: string | null; stage: string; due: string | null; tone: "red" | "amber" | "normal"; pictureUrl: string | null; onCar: { id: string; name: string; clocked: boolean }[]; coming: boolean };
export type TabletPerson = { id: string; name: string; photoUrl: string | null; clockedOn: string | null };

/**
 * The shared section tablet: the section's cars in due order; tap a car, tap your face, type your PIN, and you are
 * clocked in (or out). Nothing else, no typing. Refreshes itself every half minute.
 */
export function SectionTablet({ section, cars, people }: { section: string; cars: TabletCar[]; people: TabletPerson[] }) {
  const router = useRouter();
  const [carId, setCarId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
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

  async function submit(fullPin: string) {
    if (!car || !person || busy) return;
    setBusy(true);
    const res = await fetch("/api/tablet/bodyshop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: car.jobId, staffId: person.id, pin: fullPin, action: direction }) });
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
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={person.name} photoUrl={person.photoUrl} size={56} />
            <span className="text-xl font-extrabold">{person.name}</span>
          </div>
          <p className="text-base">{direction === "in" ? "Clock in on" : "Clock out of"} <span className="font-bold">{car.plate} · {car.title}</span>. Your PIN:</p>
          <div className="flex gap-3" aria-label="PIN">{[0, 1, 2, 3].map((i) => <span key={i} className={`h-4 w-4 rounded-full ${pin.length > i ? "bg-ink" : "border border-line-strong"}`} />)}</div>
          <div className="grid grid-cols-3 gap-3" data-pin-pad>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) => (
              <button key={i} type="button" disabled={busy || k === ""} onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : press(k))} className={`h-16 w-20 rounded-card text-2xl font-extrabold ${k === "" ? "invisible" : "border-2 border-line-strong bg-white"}`}>{k}</button>
            ))}
          </div>
          <button type="button" onClick={() => { setPersonId(null); setPin(""); }} className="min-h-12 rounded-control border border-line-strong bg-white px-5 text-base font-bold">Back</button>
        </div>
      )}
    </div>
  );
}
