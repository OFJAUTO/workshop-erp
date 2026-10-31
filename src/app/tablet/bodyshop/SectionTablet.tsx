"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";
import { enqueue, listRecords, onSendEvent, removeQueued, retryNow, type SendRecord } from "@/lib/send-queue";
import { reportUploadFailure, shrinkPhoto } from "@/lib/upload-client";
import { pendingWords, type PendingFile } from "@/lib/use-send-queue";

export type TabletCar = { jobId: string; plate: string; title: string; colour: string | null; stage: string; due: string | null; tone: "red" | "amber" | "normal"; pictureUrl: string | null; onCar: { id: string; name: string; clocked: boolean }[]; coming: boolean; readyParts?: { id: string; description: string; quantity: number }[]; /** Section 10: the PPF cutting method badge (HAND-CUT / PRE-CUT / MIXED). */ cut?: { badge: string; note: string | null } | null; /** Section 11: the tint choice per window, in the documents' words. */ tint?: string | null };
export type TabletPerson = { id: string; name: string; photoUrl: string | null; clockedOn: string | null };

/** A tint photo kept on this tablet until OFJ's server has it: its picture, its car, who took it and what is happening. */
type SendingPhoto = PendingFile & { plate: string; by: string };
type Note = { text: string; tone: "ok" | "bad" | "wait" };

const NOTE_CLASS: Record<Note["tone"], string> = { ok: "bg-green-soft text-green", bad: "bg-red-soft text-red", wait: "bg-amber-soft text-amber" };

/** The tablet's own photos in the queue (the tint photo after fitting), as they come back after a reload. */
const isTabletPhoto = (r: Pick<SendRecord, "target" | "fields">) => r.target === "job_file" && r.fields.tablet === "tint";

/**
 * The shared section tablet: the section's cars in due order; tap a car, tap your face, type your PIN, and you are
 * clocked in (or out). Nothing else, no typing. Refreshes itself every two minutes while the screen is on.
 *
 * 31 October 2026: the PIN step is one request and never carries the photo. Once the PIN is checked, the tint photo goes to
 * THE send queue with a permit for that car under the PIN holder: it stays on the tablet until the server has it (no
 * signal is fine), shown at the top with its own picture, and the next person can carry on meanwhile.
 */
export function SectionTablet({ section, cars, people }: { section: string; cars: TabletCar[]; people: TabletPerson[] }) {
  const router = useRouter();
  const [carId, setCarId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState<"clock" | "parts" | "tint" | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; type: string; url: string; takenAt: number } | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [sending, setSending] = useState<SendingPhoto[]>([]);
  const urls = useRef(new Map<string, string>());
  // The photos as last shown, read when the queue's news arrives (never during a render).
  const shown = useRef<SendingPhoto[]>([]);
  useEffect(() => {
    shown.current = sending;
  });
  useEffect(() => {
    // A shared tablet has no login, so no live feed reaches it: a check every two minutes, only while the screen is on.
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 120000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  // The tint photos still on this tablet (an earlier visit, a reload), and the queue's news about them.
  useEffect(() => {
    const map = urls.current;
    let live = true;
    const viewOf = (r: SendRecord): SendingPhoto => {
      let url = map.get(r.id) ?? null;
      if (!url) {
        try {
          url = URL.createObjectURL(r.blob);
          map.set(r.id, url);
        } catch {
          url = null;
        }
      }
      return { id: r.id, kind: "image", previewUrl: url, name: null, state: r.permanent ? "stopped" : r.attempts > 0 ? "waiting" : "queued", progress: 0, error: r.lastError, fields: r.fields, memoryOnly: !!r.memoryOnly, takenAt: r.takenAt, size: r.size, plate: String(r.fields.plate ?? ""), by: String(r.fields.by ?? "") };
    };
    const free = (id: string) => {
      const u = map.get(id);
      if (u) URL.revokeObjectURL(u);
      map.delete(id);
    };
    const add = (rows: SendRecord[]) => {
      if (!live) return;
      const views = rows.filter(isTabletPhoto).map(viewOf);
      if (views.length) setSending((cur) => [...cur, ...views.filter((v) => !cur.some((s) => s.id === v.id))]);
    };
    void listRecords().then(add);
    const off = onSendEvent((e) => {
      if (e.type === "queued") {
        void listRecords(e.scope).then((rows) => add(rows.filter((x) => x.id === e.id)));
        return;
      }
      if (e.type === "sent" || e.type === "removed") {
        const had = shown.current.find((s) => s.id === e.id);
        setSending((cur) => cur.filter((s) => s.id !== e.id));
        free(e.id);
        if (e.type === "sent" && (had || (e.scope.startsWith("job_file:") && e.fields.tablet === "tint"))) {
          // Green only now: the server has the photo.
          const by = had?.by ?? String(e.fields.by ?? "");
          const plate = had?.plate ?? String(e.fields.plate ?? "");
          setNote({ text: `${by ? `${by}: ` : ""}tint photo saved${plate ? ` (${plate})` : ""}.`, tone: "ok" });
          router.refresh();
        }
        return;
      }
      setSending((cur) =>
        cur.map((s) => {
          if (s.id !== e.id) return s;
          if (e.type === "sending") return { ...s, state: "sending", progress: e.progress, error: null };
          if (e.type === "waiting") return { ...s, state: "waiting", progress: 0, error: e.error };
          return { ...s, state: "stopped", progress: 0, error: e.error };
        }),
      );
    });
    return () => {
      live = false;
      off();
      for (const u of map.values()) URL.revokeObjectURL(u);
      map.clear();
    };
  }, [router]);

  const car = cars.find((c) => c.jobId === carId) ?? null;
  const person = people.find((p) => p.id === personId) ?? null;
  const direction: "in" | "out" = person && car && person.clockedOn === car.jobId ? "out" : "in";

  const readyParts = car?.readyParts ?? [];
  const tickedParts = readyParts.filter((p) => !unticked.has(p.id));
  const receiving = mode === "parts" && readyParts.length > 0;
  const tintPhoto = mode === "tint" && !!car?.tint;
  async function submit(fullPin: string) {
    if (!car || !person || busy) return;
    if (tintPhoto && !photo) { setNote({ text: "Take the photo first.", tone: "bad" }); setPin(""); return; }
    setBusy(true);
    // The PIN step is one small request; the tint photo never rides in it (it follows through the send queue).
    const payload = tintPhoto
      ? { jobId: car.jobId, staffId: person.id, pin: fullPin, action: "tint_photo" }
      : receiving
        ? { jobId: car.jobId, staffId: person.id, pin: fullPin, action: "receive_parts", partIds: tickedParts.map((p) => p.id) }
        : { jobId: car.jobId, staffId: person.id, pin: fullPin, action: direction };
    let ok = false;
    let data: { ok?: boolean; error?: string; message?: string; grant?: string; stageId?: string | null; caption?: string } = {};
    try {
      const res = await fetch("/api/tablet/bodyshop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000), cache: "no-store" });
      data = (await res.json().catch(() => ({}))) as typeof data;
      ok = res.ok && !!data.ok;
    } catch {
      setBusy(false);
      setPin("");
      setNote({ text: "No connection – nothing was saved. Try again.", tone: "bad" });
      return;
    }
    setBusy(false);
    setPin("");
    if (!ok) {
      setNote({ text: data.error ?? "Try again.", tone: "bad" });
      return;
    }
    let tone: Note["tone"] = "ok";
    if (tintPhoto && photo) {
      // The PIN is checked: the photo goes to the queue with the permit the server handed over (never the PIN).
      if (!data.grant) {
        setNote({ text: "The photo could not be sent. Type your PIN again.", tone: "bad" });
        return;
      }
      try {
        await enqueue({ target: "job_file", scopeId: car.jobId, blob: photo.blob, contentType: photo.type, fields: { kind: "bodyshop_photo", refId: data.stageId ?? undefined, caption: data.caption ?? "Tint fitted", tablet: "tint", plate: car.plate, by: person.name }, takenAt: photo.takenAt, grant: data.grant });
        tone = "wait";
      } catch (err) {
        reportUploadFailure({ jobId: car.jobId, kind: "job_file:bodyshop_photo", step: "upload", error: err, extra: { tablet: true } });
        setNote({ text: "The photo could not be kept on this tablet. Take it again.", tone: "bad" });
        return;
      }
    }
    setNote({ text: data.message ?? "Done.", tone });
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
      {note ? <div className={`rounded-control px-4 py-3 text-base font-bold ${NOTE_CLASS[note.tone]}`} data-tablet-note data-tablet-note-tone={note.tone}>{note.text}</div> : null}
      {sending.length ? (
        <div className="flex flex-col gap-2" data-tablet-sending>
          {sending.map((s) => {
            const stopped = s.state === "stopped";
            return (
              <div key={s.id} className={`flex flex-wrap items-center gap-3 rounded-card border-2 bg-white p-2 ${stopped ? "border-red-bar" : "border-amber-bar"}`} data-tablet-sending-row={s.id} data-tablet-sending-state={s.state}>
                {s.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.previewUrl} alt="" className="h-14 w-14 shrink-0 rounded-control object-cover bg-chip" />
                ) : <span className="h-14 w-14 shrink-0 rounded-control bg-chip" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-base font-bold">Tint photo{s.plate ? ` · ${s.plate}` : ""}{s.by ? ` · ${s.by}` : ""}</span>
                  <span className={`text-sm ${stopped ? "font-semibold text-red" : "text-amber"}`}>{pendingWords(s)}</span>
                </span>
                {stopped ? (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => void retryNow(s.id)} className="min-h-12 rounded-control border-2 border-line-strong bg-white px-4 text-base font-bold" data-tablet-sending-retry>Try again</button>
                    <button type="button" onClick={() => { if (window.confirm("Remove this photo? It will not be sent.")) void removeQueued(s.id); }} className="min-h-12 rounded-control border border-line bg-white px-4 text-base font-semibold text-muted" data-tablet-sending-remove>Remove</button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
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
                <input type="file" accept="image/*" capture="environment" className="sr-only" data-tablet-tint-file onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const takenAt = Date.now(); const small = await shrinkPhoto(f); if (photo) URL.revokeObjectURL(photo.url); setPhoto({ blob: small.blob, type: small.type, url: URL.createObjectURL(small.blob), takenAt }); }} />
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
