"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "./ui";
import { saveMediaDetails } from "@/lib/upload-client";

/** The words in a note, split on commas and line breaks. */
const wordsOf = (text: string) => text.split(/[,\n]+/).map((w) => w.trim()).filter(Boolean);

/**
 * One optional note under the damage close-ups, with one-tap chips above it (from Settings > Damage note chips).
 * A tap writes the word into the note, a second tap takes it out; typing always works. The note saves itself
 * about a second after the last change, with the status in a line that never changes height.
 */
export function DamageNote({ jobId, initial, token, chips = [] }: { jobId: string; initial: string; token?: string; chips?: string[] }) {
  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial.trim());
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const lastSaved = useRef(initial.trim());
  const savedBefore = useRef(new Set<string>([initial.trim()]));
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);

  // Typed on another device: take the new note when the page refreshes, unless this one is mid-edit.
  const synced = useRef(initial);
  useEffect(() => {
    if (initial === synced.current) return;
    // A value this box saved earlier coming back from a late refresh is old news, never a reason to change the box.
    if (savedBefore.current.has(initial.trim())) return;
    synced.current = initial;
    setSavedValue(initial.trim());
    setValue((current) => (current.trim() === savedValue ? initial : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  function saveNow(text: string) {
    const clean = text.trim();
    // One save at a time, in order: the last value typed is the last one written.
    chain.current = chain.current.then(async () => {
      if (clean === lastSaved.current) { setState(clean ? "saved" : "idle"); return; }
      setState("saving");
      setError(null);
      try {
        await saveMediaDetails(jobId, { damageNote: clean }, token);
        lastSaved.current = clean;
        savedBefore.current.add(clean);
        synced.current = clean;
        setSavedValue(clean);
        setState(latest.current.trim() === clean ? "saved" : "idle");
      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
    return chain.current;
  }
  const queue = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveNow(text), 1200);
  };
  const change = (text: string) => { setValue(text); queue(text); };
  const toggle = (chip: string) => {
    const words = wordsOf(value);
    const has = words.some((w) => w.toLowerCase() === chip.toLowerCase());
    const next = has ? words.filter((w) => w.toLowerCase() !== chip.toLowerCase()).join(", ") : [...words, chip].join(", ");
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    void saveNow(next);
  };
  const picked = new Set(wordsOf(value).map((w) => w.toLowerCase()));

  return (
    <div className="flex flex-col gap-2" data-damage-note>
      <span className="text-sm font-semibold">Damage note <span className="text-xs font-medium text-muted">(optional)</span></span>
      {chips.length ? (
        <div className="flex flex-wrap gap-1.5" data-damage-chips>
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => toggle(c)} aria-pressed={picked.has(c.toLowerCase())} className={`min-h-10 rounded-control border px-3 text-xs font-bold uppercase tracking-wide ${picked.has(c.toLowerCase()) ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-damage-chip={c}>
              {c}
            </button>
          ))}
        </div>
      ) : null}
      <Textarea value={value} onChange={(e) => change(e.target.value)} onBlur={() => { if (timer.current) clearTimeout(timer.current); void saveNow(latest.current); }} rows={2} maxLength={500} placeholder="For example: scratches and dents all around" aria-label="Damage note" />
      <span className="min-h-5 text-xs font-semibold" data-damage-status aria-live="polite">
        {state === "saving" ? <span className="text-muted">Saving…</span> : state === "saved" ? <span className="text-green">Saved</span> : state === "error" ? <span className="text-red">{error ?? "Could not save."}</span> : null}
      </span>
    </div>
  );
}
