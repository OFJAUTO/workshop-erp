"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { Lightbox } from "./Lightbox";
import { PhotoButton } from "./PhotoButton";
import { reportUploadFailure, shrinkPhoto } from "@/lib/upload-client";
import { listRecords, onSendEvent, scopeOf, type SendEvent } from "@/lib/send-queue";
import { pendingWords, useSendQueue, type PendingFile, type SentResult } from "@/lib/use-send-queue";
import { isUuid, newUuid } from "@/lib/uuid";

/** A file on a job as the server recorded it. `refId`: what it was sent tied to (a form's key, an LPO, a stage). */
export type JobFile = { id: string; path: string; url: string | null; caption?: string | null; contentType?: string | null; refId?: string | null };

/** What is still on its way from one uploader: a parent's button waits while a file it needs is only on the device. */
export type FilesWaiting = { count: number; stopped: number };

const STEP_TIMEOUT_MS = 60_000;
/** The job-files bucket's own limit: storage refuses anything larger. */
const MAX_BYTES = 50 * 1024 * 1024;
/** What the job-files place accepts (the same list as the server's, src/lib/upload-targets/job-file.ts). */
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "video/webm", "video/mp4", "video/quicktime", "application/pdf"]);
const TYPE_OF_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", webm: "video/webm", mp4: "video/mp4", mov: "video/quicktime", pdf: "application/pdf" };
/** A signed address from the server lives an hour; an older one is not shown (the file is still there). */
const URL_FRESH_MS = 50 * 60_000;

const typeOfPath = (path: string) => TYPE_OF_EXT[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? null;

function fileTypeOf(f: File): string {
  if (f.type) return f.type.split(";")[0].trim().toLowerCase();
  return TYPE_OF_EXT[f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase()] ?? "image/jpeg";
}

function refusedWords(type: string, accept: "photo" | "pdf" | "any"): string {
  if (/heic|heif/.test(type)) return "This photo is in a format that can't be sent (HEIC). Use the camera button, or choose a JPEG photo.";
  if (accept === "photo") return "That file can't be used here. Add a photo (JPEG or PNG).";
  if (accept === "pdf") return "That file can't be used here. Add a PDF or a photo.";
  return "That file can't be used here. Add a photo, a short video or a PDF.";
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Telling the screen when the server has a file (31 October 2026, uploads section 10)                          */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * One uploader on the page: whom to tell (`fn`, the latest onAdded), what it was told already, and whether it is still
 * on screen. A file is confirmed to every uploader still showing it, or - when none is (a window was closed, the method
 * changed) - to the last one that did, so the form that asked for it still hears, exactly as before the queue.
 */
type Hand = { fn: { current: ((f: JobFile) => void) | undefined }; files: { current: JobFile[] }; seen: Set<string>; alive: boolean };
const deliveries = new Map<string, Hand[]>();
/** Confirmed while no uploader had claimed it yet (the moment a page opens): the uploader showing it takes it then. */
const unclaimed = new Set<string>();

function claim(id: string, hand: Hand) {
  deliveries.set(id, [...(deliveries.get(id) ?? []).filter((h) => h !== hand), hand]);
}

function give(hand: Hand, f: JobFile) {
  if (hand.seen.has(f.id) || hand.files.current.some((x) => x.id === f.id)) return;
  hand.seen.add(f.id);
  hand.fn.current?.(f);
}

function fileOf(r: SentResult): JobFile | null {
  if (!r?.ok || typeof r.id !== "string" || !r.id || !r.path) return null;
  return { id: r.id, path: r.path, url: r.url ?? null, caption: typeof r.caption === "string" ? r.caption : null, contentType: typeOfPath(r.path), refId: typeof r.refId === "string" ? r.refId : null };
}

/*
 * Files a form's key already has on the server, kept on this device for 12 hours: after a reload or a new version the
 * payment, deposit, delivery or problem form shows what it already sent (its key survives the reload, useFormKey).
 */
const JOURNAL = "erp-job-files-sent";
const JOURNAL_MS = 12 * 3_600_000;
type Entry = { slot: string; at: number; file: JobFile };

function slotOf(jobId: string, f: Record<string, unknown>): string | null {
  if (typeof f.form !== "string" || typeof f.formKey !== "string" || !f.formKey) return null;
  return [jobId, f.form, f.formKey, String(f.kind ?? ""), String(f.refId ?? ""), String(f.caption ?? "")].join("|");
}

function readJournal(): Entry[] {
  try {
    const list = JSON.parse(localStorage.getItem(JOURNAL) ?? "[]") as Entry[];
    const since = Date.now() - JOURNAL_MS;
    return Array.isArray(list) ? list.filter((e) => e && typeof e.slot === "string" && e.at > since && !!e.file?.id) : [];
  } catch {
    return [];
  }
}

function writeJournal(list: Entry[]) {
  try {
    localStorage.setItem(JOURNAL, JSON.stringify(list.slice(-100)));
  } catch {
    // Full or blocked: the form simply shows what is sent from now on.
  }
}

function remember(jobId: string, fields: Record<string, unknown>, file: JobFile) {
  const slot = slotOf(jobId, fields);
  if (!slot) return;
  writeJournal([...readJournal().filter((e) => e.file.id !== file.id), { slot, at: Date.now(), file }]);
}

function forget(fileId: string) {
  const list = readJournal();
  const next = list.filter((e) => e.file.id !== fileId);
  if (next.length !== list.length) writeJournal(next);
}

function onQueueNews(e: SendEvent) {
  if (e.type === "removed") {
    deliveries.delete(e.id);
    return;
  }
  if (e.type !== "sent" || !e.scope.startsWith("job_file:")) return;
  const file = fileOf(e.result);
  if (!file) return;
  remember(e.scope.slice("job_file:".length), e.fields, file);
  const hands = deliveries.get(e.id) ?? [];
  deliveries.delete(e.id);
  if (!hands.length) {
    if (unclaimed.size > 200) unclaimed.clear();
    unclaimed.add(e.id);
    return;
  }
  const alive = hands.filter((h) => h.alive);
  for (const h of alive.length ? alive : hands.slice(-1)) give(h, file);
}

if (typeof window !== "undefined") onSendEvent(onQueueNews);

/* ------------------------------------------------------------------------------------------------------------ */
/* A form's own key (a payment, a deposit, a delivery's invoice, a problem)                                     */
/* ------------------------------------------------------------------------------------------------------------ */

const KEY_PREFIX = "erp-form-key:";
const KEY_EVENT = "erp:form-key";
const USED = "erp-form-keys-used";
const memoryKeys = new Map<string, string>();

function readKey(storeKey: string): string | null {
  try {
    const v = sessionStorage.getItem(storeKey);
    if (isUuid(v)) return v;
  } catch {
    // Blocked: this page's memory holds it.
  }
  return memoryKeys.get(storeKey) ?? null;
}

function writeKey(storeKey: string, value: string) {
  memoryKeys.set(storeKey, value);
  try {
    sessionStorage.setItem(storeKey, value);
  } catch {
    // Kept in memory for this page.
  }
  window.dispatchEvent(new Event(KEY_EVENT));
}

function usedKeys(): Set<string> {
  try {
    const list = JSON.parse(localStorage.getItem(USED) ?? "[]") as [string, number][];
    return new Set(Array.isArray(list) ? list.map((x) => (Array.isArray(x) ? String(x[0]) : "")) : []);
  } catch {
    return new Set();
  }
}

function markUsed(key: string) {
  try {
    const since = Date.now() - 3 * 86_400_000;
    const list = (JSON.parse(localStorage.getItem(USED) ?? "[]") as [string, number][]).filter((x) => Array.isArray(x) && x[1] > since && x[0] !== key);
    localStorage.setItem(USED, JSON.stringify([...list, [key, Date.now()]].slice(-200)));
  } catch {
    // Only a guard against reusing a spent key in another tab.
  }
}

const subscribeKeys = (cb: () => void) => {
  window.addEventListener(KEY_EVENT, cb);
  return () => window.removeEventListener(KEY_EVENT, cb);
};

/**
 * THE client key of one form whose files are tied to it before it is saved (31 October 2026): the same key for the same
 * form (`tag`: the form and its job, invoice or LPO) across a reload, a new version or the tablet's idle lock - kept in
 * the tab - so a proof still waiting on the device stays with the form that asked for it. A fresh tab adopts the key of
 * files still waiting on this device for that form. `renew(key)` after a successful save starts a new one (the old one
 * is never adopted again). Null for the first moment in the browser, while it is looked up.
 */
export function useFormKey(tag: string, jobId: string | null): { key: string | null; renew: (spent?: string | null) => void } {
  const storeKey = KEY_PREFIX + tag;
  const key = useSyncExternalStore(subscribeKeys, () => readKey(storeKey), () => null);
  useEffect(() => {
    if (key) return;
    let live = true;
    void (async () => {
      const used = usedKeys();
      let adopt: string | null = null;
      if (jobId) {
        const rows = await listRecords(scopeOf("job_file", jobId)).catch(() => []);
        for (const r of rows) {
          const k = r.fields.formKey;
          if (r.fields.form === tag && isUuid(k) && !used.has(k)) adopt = k;
        }
      }
      if (live && !readKey(storeKey)) writeKey(storeKey, adopt ?? newUuid());
    })();
    return () => {
      live = false;
    };
  }, [key, tag, jobId, storeKey]);
  const renew = useCallback(
    (spent?: string | null) => {
      const cur = readKey(storeKey);
      // Renewed already (two signs of the same save): nothing more to do.
      if (spent && cur !== spent) return;
      if (cur) markUsed(cur);
      writeKey(storeKey, newUuid());
    },
    [storeKey],
  );
  return { key, renew };
}

/*
 * A form that saves through a server action and comes back with ?message= or ?error= (the payment form, the problem
 * window): the key it was submitted with is kept in the tab until the answer is on screen. A "message" means the save
 * happened, so the key is spent and renewed (a reused key would be taken for the same payment or problem); an "error"
 * keeps it - nothing was saved, and the files sent under it still belong to the next try.
 */
const SENT_PREFIX = "erp-form-key-sent:";

export function markFormSent(tag: string, key: string | null) {
  if (!key) return;
  try {
    sessionStorage.setItem(SENT_PREFIX + tag, key);
  } catch {
    // Without it the key is renewed by the page's own list of saved keys, where there is one.
  }
}

function sentKeyOf(tag: string): string | null {
  try {
    return sessionStorage.getItem(SENT_PREFIX + tag);
  } catch {
    return null;
  }
}

function clearSent(tag: string) {
  try {
    sessionStorage.removeItem(SENT_PREFIX + tag);
  } catch {
    // nothing kept
  }
}

export function useRenewAfterAnswer(tag: string, key: string | null, renew: (spent?: string | null) => void) {
  const answer = useSearchParams().toString();
  useEffect(() => {
    if (!key || sentKeyOf(tag) !== key) return;
    const sp = new URLSearchParams(answer);
    if (sp.has("message")) {
      clearSent(tag);
      renew(key);
    } else if (sp.has("error")) clearSent(tag);
  }, [answer, key, tag, renew]);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The uploader                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------ */

type Props = {
  jobId: string;
  kind: string;
  refId?: string | null;
  files: JobFile[];
  accept?: "photo" | "pdf" | "any";
  label?: string;
  disabled?: boolean;
  /** Written on every file uploaded here (what the photo shows). */
  caption?: string;
  onAdded?: (f: JobFile) => void;
  /** The X on each thumbnail: marks the file removed on the server, then tells the holder. */
  onRemoved?: (f: JobFile) => void;
  removable?: boolean;
  compact?: boolean;
  /** The form these files belong to and its key (useFormKey): files it already sent come back after a reload. */
  form?: { tag: string; key: string } | null;
  /** More kinds whose waiting files show here (the gate-out photos follow the way the car leaves). */
  alsoKinds?: string[];
  /** One file: a new one takes the place of any still waiting (the gate-out km photo - the newest is the record). */
  single?: boolean;
  /** Files still on their way from here: the parent's button waits for a file it needs. */
  onPending?: (w: FilesWaiting) => void;
};

/**
 * Photos (the camera inside the page on a phone or tablet, the picker on a PC), videos or a PDF attached to a job: work
 * and bodyshop photos, payment proofs, supplier invoice scans, the gate-out km and handover photos, the QC post-scan.
 * Since 31 October 2026 every file goes through THE send queue: kept on the device until the server confirms it, shown at
 * once with its own picture and a plain state line, sent by itself when the signal is back (a reload, a new version or
 * the idle lock lose nothing). A file counts - green, in `files`, `onAdded` - only once the server has it.
 */
export function JobFileUpload(props: Props) {
  // A new reference (a form's next key, another LPO) is a new place: the waiting list is read again for it.
  return <Uploader key={`${props.jobId}|${props.kind}|${props.refId ?? ""}|${props.caption ?? ""}`} {...props} />;
}

function Uploader({ jobId, kind, refId = null, files, accept = "photo", label, disabled = false, onAdded, onRemoved, removable = false, compact = false, caption, form = null, alsoKinds, single = false, onPending }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fnRef = useRef(onAdded);
  const filesRef = useRef(files);
  const onPendingRef = useRef(onPending);
  const handRef = useRef<Hand | null>(null);
  useEffect(() => {
    fnRef.current = onAdded;
    filesRef.current = files;
    onPendingRef.current = onPending;
  });
  const hand = useCallback((): Hand => {
    if (!handRef.current) handRef.current = { fn: fnRef, files: filesRef, seen: new Set(), alive: true };
    return handRef.current;
  }, []);
  const formTag = form?.tag ?? null;
  const formKey = form?.key ?? null;
  const kinds = alsoKinds?.length ? [kind, ...alsoKinds] : [kind];
  const q = useSendQueue({
    target: "job_file",
    scopeId: jobId,
    grantBody: { kind },
    match: (f) => kinds.includes(String(f.kind ?? "")) && (typeof f.refId === "string" && f.refId ? f.refId : null) === refId && (typeof f.caption === "string" && f.caption ? f.caption : null) === (caption ?? null),
    // Normally the queue's news above tells the uploader that claimed the file; this covers a file confirmed in the very
    // moment this uploader was still reading its waiting list.
    onSent: (result, _fields, id) => {
      if (!unclaimed.delete(id)) return;
      const f = fileOf(result);
      if (f) give(hand(), f);
    },
  });

  // On screen: confirmations reach this uploader (and, through it, its form).
  useEffect(() => {
    const h = hand();
    h.alive = true;
    return () => {
      h.alive = false;
    };
  }, [hand]);

  // Files of this place still on the device (picked here, or on an earlier visit) are confirmed to this uploader.
  const pendingIds = q.pending.map((p) => p.id).join(",");
  useEffect(() => {
    if (!pendingIds) return;
    const h = hand();
    for (const id of pendingIds.split(",")) claim(id, h);
  }, [pendingIds, hand]);

  // A form's files the server already has (sent before a reload or a new version) come back on screen.
  useEffect(() => {
    if (!formTag || !formKey) return;
    const slot = slotOf(jobId, { form: formTag, formKey, kind, refId, caption });
    if (!slot) return;
    const have = new Set(filesRef.current.map((f) => f.id));
    const h = hand();
    for (const e of readJournal()) {
      if (e.slot !== slot || have.has(e.file.id)) continue;
      give(h, Date.now() - e.at < URL_FRESH_MS ? e.file : { ...e.file, url: null });
    }
  }, [jobId, kind, refId, caption, formTag, formKey, hand]);

  const waiting = q.pending.length + preparing;
  const stopped = q.pending.filter((p) => p.state === "stopped").length;
  useEffect(() => {
    const r = onPendingRef;
    r.current?.({ count: waiting, stopped });
    return () => r.current?.({ count: 0, stopped: 0 });
  }, [waiting, stopped]);

  async function removeOne(f: JobFile) {
    setError(null);
    try {
      const res = await fetch("/api/files/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }), signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
      const r = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !r.ok) throw new Error(r.error ?? "Could not remove the file.");
      forget(f.id);
      onRemoved?.(f);
    } catch (err) {
      setError(err instanceof Error && !/fetch|network|abort|timed? ?out/i.test(err.message) ? err.message : "No connection: the file was not removed. Try again.");
    }
  }

  function dropPending(id: string) {
    deliveries.delete(id);
    void q.remove(id);
  }

  async function handleFiles(list: File[]) {
    if (!list.length) return;
    setError(null);
    const picked = single ? list.slice(-1) : list;
    // One photo here: a retake takes the place of the one still waiting (the newest is the record on the server).
    if (single) for (const p of q.pending) dropPending(p.id);
    setPreparing((n) => n + picked.length);
    for (const original of picked) {
      try {
        const type = fileTypeOf(original);
        // 30 October 2026: a photo is shrunk on the device first (2000 px, JPEG 80%, about 0.5 MB). Videos and PDFs go as they are.
        const small = type.startsWith("image/") ? await shrinkPhoto(original) : { blob: original as Blob, type, shrunk: false };
        // A photo the browser could not redraw keeps its own type (a HEIC is named, never sent as a broken JPEG).
        const contentType = (small.shrunk ? small.type : type).split(";")[0].trim().toLowerCase();
        if (!ACCEPTED.has(contentType)) {
          setError(refusedWords(contentType, accept));
          reportUploadFailure({ jobId, kind: `job_${kind}`, step: "decode", error: `not accepted: ${contentType}`, sizeBytes: small.blob.size, contentType });
          continue;
        }
        if (small.blob.size > MAX_BYTES) {
          setError("That file is too big to send (over 50 MB). Use a shorter video or a smaller file.");
          reportUploadFailure({ jobId, kind: `job_${kind}`, step: "upload", error: "over 50 MB", sizeBytes: small.blob.size, contentType });
          continue;
        }
        const id = newUuid();
        claim(id, hand());
        const fields: Record<string, unknown> = { kind, refId };
        if (caption) fields.caption = caption;
        if (formTag && formKey) {
          fields.form = formTag;
          fields.formKey = formKey;
        }
        const ids = await q.add([{ id, blob: small.blob, contentType, fields, name: original.name ? original.name.slice(0, 120) : null }]);
        if (!ids.length) {
          deliveries.delete(id);
          setError("Couldn't keep the file on this device. Try again.");
        }
      } catch (err) {
        setError("Couldn't get the file ready. Try again.");
        reportUploadFailure({ jobId, kind: `job_${kind}`, step: "decode", error: err, sizeBytes: original.size, contentType: original.type || null });
      } finally {
        setPreparing((n) => Math.max(0, n - 1));
      }
    }
  }

  const isPdf = (f: JobFile) => f.contentType === "application/pdf" || !!f.caption?.toLowerCase().endsWith(".pdf");
  const isVideo = (f: JobFile) => (f.contentType ?? "").startsWith("video/");
  const slides = files.filter((f) => !isPdf(f) && f.url).map((f) => ({ key: f.id, url: f.url as string, label: f.caption ?? "Photo", kind: isVideo(f) ? ("video" as const) : ("image" as const) }));
  const acceptAttr = accept === "pdf" ? "application/pdf,image/*" : "image/*,video/*,application/pdf";
  const tile = compact ? "h-16 w-16" : "h-24 w-24";
  // The buttons stay usable while files send: more can be picked at any time.
  const btn = `inline-flex ${compact ? "min-h-10" : "min-h-12"} w-fit cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-white px-4 text-sm font-bold`;
  const text = label ?? (accept === "pdf" ? "Attach PDF or photo" : "Add photo");

  return (
    <div className="flex flex-col gap-2" data-job-file-upload data-files-waiting={waiting}>
      {files.length ? (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <span key={f.id} className="relative inline-flex" data-invoice-file={f.id}>
              {isPdf(f) ? (
                <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className={`inline-flex min-h-11 items-center rounded-control border border-line bg-chip px-3 text-sm font-semibold ${removable ? "pr-9" : ""}`}>PDF · {f.caption ?? "file"}</a>
              ) : f.url ? (
                <button type="button" onClick={() => setOpen(slides.findIndex((s) => s.key === f.id))} className={`${tile} overflow-hidden rounded-control bg-chip cursor-zoom-in`} aria-label="Enlarge">
                  {isVideo(f) ? <video src={f.url} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url} alt="Photo" className="h-full w-full object-cover" />
                  )}
                </button>
              ) : (
                <span className={`${tile} inline-flex items-center justify-center rounded-control bg-chip text-xs font-semibold text-muted`} data-file-no-preview>{isVideo(f) ? "Video" : "Photo"}</span>
              )}
              {removable && !disabled ? (
                <button type="button" onClick={() => void removeOne(f)} aria-label="Remove this file" data-remove-file={f.id} className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink/80 text-sm font-bold text-white">×</button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {q.pending.length ? (
        <ul className="flex flex-col gap-1.5" data-pending-files>
          {q.pending.map((p) => (
            <PendingRow key={p.id} p={p} compact={compact} canRemove={removable || p.state === "stopped"} onRetry={() => void q.retry(p.id)} onRemove={() => dropPending(p.id)} />
          ))}
        </ul>
      ) : null}
      {preparing ? <p className="text-xs font-semibold text-muted" data-file-preparing>Getting the {accept === "photo" ? "photo" : "file"} ready…</p> : null}
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          {accept === "photo" ? (
            <>
              <PhotoButton source="camera" multiple={!single} className={btn} title={label ?? "Add photo"} onFiles={(f) => void handleFiles(f)} onProblem={(m) => reportUploadFailure({ jobId, kind: `job_${kind}`, step: "camera", error: m })}>
                {text}
              </PhotoButton>
              <PhotoButton source="gallery" multiple={!single} className={`${btn} text-xs`} title="From gallery" onFiles={(f) => void handleFiles(f)}>
                From gallery
              </PhotoButton>
            </>
          ) : (
            <>
              <input ref={fileRef} type="file" accept={acceptAttr} multiple={accept !== "pdf" && !single} onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; void handleFiles(list); }} className="sr-only" tabIndex={-1} aria-hidden />
              <button type="button" onClick={() => { const el = fileRef.current; if (el) { el.value = ""; el.click(); } }} className={btn}>{text}</button>
            </>
          )}
        </div>
      ) : null}
      {open !== null && slides[open] ? <Lightbox slides={slides} index={open} onClose={() => setOpen(null)} onMove={setOpen} /> : null}
      {error ? <p className="text-xs font-semibold text-red" data-upload-error>{error}</p> : null}
    </div>
  );
}

/**
 * One file still on the device: its own picture (made on the device), what is happening in plain words, and - when it
 * cannot go by itself - Try again and Remove. Never green: it is not on the server yet.
 */
function PendingRow({ p, compact, canRemove, onRetry, onRemove }: { p: PendingFile; compact: boolean; canRemove: boolean; onRetry: () => void; onRemove: () => void }) {
  const stopped = p.state === "stopped";
  const waiting = p.state === "waiting";
  const box = stopped ? "border-red-bar bg-red-soft" : waiting ? "border-amber-bar bg-amber-soft" : "border-line bg-white";
  const words = stopped ? "text-red" : waiting ? "text-amber" : "text-muted";
  const btnH = compact ? "min-h-10" : "min-h-11";
  return (
    <li className={`flex flex-wrap items-center gap-2 rounded-control border px-2 py-1.5 ${box}`} data-pending-file={p.id} data-pending-state={p.state}>
      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-control bg-chip">
        {p.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.previewUrl} alt="Waiting to send" className="h-full w-full object-cover opacity-80" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-muted">{p.kind === "pdf" ? "PDF" : p.kind === "video" ? "Video" : "File"}</span>
        )}
        {p.state === "sending" ? <span className="absolute bottom-0 left-0 h-1 bg-amber-bar" style={{ width: `${Math.max(4, Math.round(p.progress * 100))}%` }} aria-hidden /> : null}
      </span>
      <span className={`min-w-[8rem] flex-1 text-xs font-semibold ${words}`} aria-live="polite" data-pending-words>
        {p.kind === "pdf" && p.name ? `${p.name}: ` : ""}
        {pendingWords(p)}
      </span>
      {stopped || waiting ? (
        <button type="button" onClick={onRetry} className={`${btnH} shrink-0 rounded-control bg-ink px-3 text-xs font-bold text-white`} data-retry>
          Try again
        </button>
      ) : null}
      {canRemove ? (
        <button type="button" onClick={onRemove} className={`${btnH} shrink-0 rounded-control border border-line-strong bg-white px-3 text-xs font-bold`} data-remove-pending={p.id}>
          Remove
        </button>
      ) : null}
    </li>
  );
}
