"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

/**
 * THE HR "Attach document" window (13 November 2026, Section 13): a real button instead of the browser's "Choose File".
 * On a phone or tablet: "Take photo" or "Choose file"; on a computer: "Choose file". Several files per document (front
 * and back, passport pages), a preview of each before saving, and large photos are reduced on the device (never
 * refused at 4 MB). Replacing keeps the old files on the server.
 */
type Picked = { id: string; file: File; url: string | null };
const MAX_SIDE = 2000;
const TOTAL_LIMIT = 3.8 * 1024 * 1024;

async function reduce(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= 700 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function HrAttach({
  action,
  kind,
  label,
  numbered,
  needsExpiry,
  other = false,
  trigger,
}: {
  action: (fd: FormData) => Promise<void>;
  kind: string;
  label: string;
  numbered: boolean;
  needsExpiry: boolean;
  other?: boolean;
  trigger: "Attach" | "Replace" | "Add other document";
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [touch, setTouch] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => {
    const m = window.matchMedia("(pointer: coarse)");
    const set = () => setTouch(m.matches || /Android|iPhone|iPad/i.test(navigator.userAgent));
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const next: Picked[] = [];
    for (const f of Array.from(list)) {
      const file = await reduce(f);
      const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (url) urls.current.push(url);
      next.push({ id: `${Date.now()}-${Math.random()}`, file, url });
    }
    setPicked((cur) => [...cur, ...next].slice(0, 8));
  };
  const save = () => {
    if (!picked.length) return setError("Attach at least one photo or PDF.");
    const total = picked.reduce((t, p) => t + p.file.size, 0);
    if (total > TOTAL_LIMIT) return setError("Too large together: attach fewer files at a time (PDFs cannot be reduced).");
    const fd = new FormData(form.current ?? undefined);
    fd.set("kind", kind);
    fd.delete("file");
    for (const p of picked) fd.append("file", p.file, p.file.name);
    start(async () => {
      try {
        await action(fd);
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
        setError("Couldn't save – nothing was recorded. Try again.");
      }
    });
  };
  const close = () => {
    setOpen(false);
    setPicked([]);
    setError(null);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex min-h-11 items-center rounded-control px-4 text-sm font-bold ${trigger === "Replace" ? "border border-line-strong bg-white" : "bg-ink text-on-dark"}`} data-hr-attach={kind}>
        {trigger}
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onKeyDown={(e) => e.key === "Escape" && close()} data-hr-attach-window={kind}>
              <form ref={form} onSubmit={(e) => { e.preventDefault(); save(); }} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-card bg-white p-5 shadow-xl">
                <h2 className="text-lg font-bold">{trigger === "Replace" ? `Replace: ${label}` : label}</h2>
                {trigger === "Replace" ? <p className="text-xs text-muted">The old files are kept under &quot;Replaced documents&quot;.</p> : null}
                {other ? (
                  <label className="flex flex-col gap-1 text-sm font-semibold">What is it?
                    <input name="other_label" required minLength={2} placeholder="e.g. Trade licence" className="min-h-11 rounded-control border border-line-strong px-3 text-base" data-hr-other-label data-spell="" />
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {touch ? (
                    <button type="button" onClick={() => cam.current?.click()} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-hr-take-photo>Take photo</button>
                  ) : null}
                  <button type="button" onClick={() => pick.current?.click()} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-hr-choose-file>Choose file</button>
                  <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
                  <input ref={pick} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} data-hr-file-input />
                </div>
                {picked.length ? (
                  <ul className="grid grid-cols-3 gap-2" data-hr-previews={picked.length}>
                    {picked.map((p, i) => (
                      <li key={p.id} className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-control border border-line bg-chip" data-hr-preview>
                        {p.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a local preview of a file on the device
                          <img src={p.url} alt={`File ${i + 1}`} className="h-full w-full object-cover" />
                        ) : (
                          <span className="px-2 text-center text-xs font-bold">PDF<br />{p.file.name.slice(0, 24)}</span>
                        )}
                        <button type="button" onClick={() => setPicked((cur) => cur.filter((x) => x.id !== p.id))} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-sm font-bold shadow" aria-label={`Remove file ${i + 1}`}>×</button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No file yet. Several files are fine (front and back, passport pages).</p>
                )}
                {numbered ? (
                  <label className="flex flex-col gap-1 text-sm font-semibold">ID number <span className="text-xs font-normal text-muted">(optional)</span>
                    <input name="doc_number" autoComplete="off" className="min-h-11 rounded-control border border-line-strong px-3 text-base" data-hr-number-input />
                  </label>
                ) : null}
                {needsExpiry ? (
                  <label className="flex flex-col gap-1 text-sm font-semibold">Expiry date
                    <input name="expires_on" type="date" required className="min-h-11 rounded-control border border-line-strong px-3 text-base" data-hr-expiry-input />
                  </label>
                ) : null}
                {error ? <p className="text-sm font-semibold text-red" data-hr-attach-error>{error}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={busy || !picked.length} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark disabled:opacity-50" data-hr-attach-save>{busy ? "Saving…" : `Save ${picked.length > 1 ? `${picked.length} files` : ""}`.trim()}</button>
                  <button type="button" onClick={close} className="inline-flex min-h-12 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Cancel</button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
