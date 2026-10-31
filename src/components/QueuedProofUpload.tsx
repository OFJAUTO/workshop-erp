"use client";

import { useEffect, useRef, useState } from "react";
import type { SendTarget } from "@/lib/send-queue";
import { pendingWords, useSendQueue, type PendingFile, type SentResult } from "@/lib/use-send-queue";
import { shrinkPhoto } from "@/lib/upload-client";
import { newUuid } from "@/lib/uuid";

/** The proof places this uploader serves: one document (a photo or a PDF) for one record. */
export type ProofTarget = Extract<SendTarget, "supplier_proof" | "commission_proof" | "credit_note">;

/**
 * Where each place keeps its files (the server's own rule, src/lib/upload-targets): a file still on its way can be named
 * before it arrives, so a save made in the meantime picks it up the moment it lands (the server checks it really did).
 */
const FOLDER: Record<ProofTarget, string> = { supplier_proof: "supplier-payments", commission_proof: "commission-payments", credit_note: "credit-notes" };
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const MAX_BYTES = 20 * 1024 * 1024;

type DataAttrs = { [key: `data-${string}`]: string };

/** The newest file the server has confirmed: its stored path, and a short-lived address to look at it. */
export type SentProof = { id: string; path: string; url: string | null; name: string | null; kind: PendingFile["kind"] };

/**
 * One proof document for one record (31 October 2026, uploads section 10): picked with one button, made small on the device
 * when it is a photo, kept there until OFJ's server confirms it, and sent by THE send queue. The newest pick is the one a
 * form hands over: `ready` once the server has it (its path), `waiting` while it is still on its way (the path it will have).
 */
export function useQueuedProof({ target, scopeId, onSent }: { target: ProofTarget; scopeId: string; onSent?: (result: SentResult) => void }) {
  const [latest, setLatest] = useState<string | null>(null);
  const [sent, setSent] = useState<SentProof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The files as last shown (their names and kinds), read when the server's answer arrives.
  const shown = useRef<PendingFile[]>([]);
  const queue = useSendQueue({
    target,
    scopeId,
    onSent: (result, _fields, id) => {
      // A file replaced by a newer pick still lands, but only the newest one is handed over.
      if (!latest || id === latest) {
        const p = shown.current.find((x) => x.id === id);
        setSent({ id, path: result.path, url: result.url, name: p?.name ?? null, kind: p?.kind ?? "file" });
      }
      onSent?.(result);
    },
  });
  useEffect(() => {
    shown.current = queue.pending;
  });

  // The newest file still on the device: this visit's pick, or (after a reload) the newest one that came back.
  const newest = latest ? (queue.pending.find((p) => p.id === latest) ?? null) : queue.pending.reduce<PendingFile | null>((a, p) => (!a || p.takenAt >= a.takenAt ? p : a), null);
  const ready = !newest && sent && (!latest || sent.id === latest) ? sent : null;
  const waiting = !!newest && newest.state !== "stopped";
  const stopped = newest?.state === "stopped";
  const ext = newest ? EXT[String(newest.fields.fileType ?? "")] : undefined;
  const waitingPath = waiting && newest && ext ? `${FOLDER[target]}/${scopeId}/${newest.id}.${ext}` : null;

  async function pick(file: File) {
    setError(null);
    const rawType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    if (!rawType.startsWith("image/") && rawType !== "application/pdf") {
      setError("Use a photo or a PDF.");
      return;
    }
    setBusy(true);
    try {
      const small = rawType.startsWith("image/") ? await shrinkPhoto(file) : { blob: file as Blob, type: rawType };
      if (!EXT[small.type]) {
        setError("That kind of file is not accepted. Use a JPG or PNG photo, or a PDF.");
        return;
      }
      if (small.blob.size > MAX_BYTES) {
        setError("That file is over 20 MB. Use a smaller one.");
        return;
      }
      // The earlier pick, when it has not started sending yet, leaves the device: only the newest pick is the proof.
      if (latest && queue.pending.some((p) => p.id === latest && p.state !== "sending")) await queue.remove(latest);
      const id = newUuid();
      setLatest(id);
      setSent(null);
      await queue.add([{ id, blob: small.blob, contentType: small.type, name: file.name || null, fields: { fileType: small.type }, takenAt: Date.now() }]);
    } catch {
      setError("Could not keep the file on this device. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return { pending: queue.pending, retry: queue.retry, remove: queue.remove, pick, busy, error, ready, waiting, stopped, waitingPath };
}

export type QueuedProof = ReturnType<typeof useQueuedProof>;

/** One file still on the device: its own picture, what is happening in plain words, and Try again / Remove when stopped. */
function QueuedTile({ p, onRetry, onRemove }: { p: PendingFile; onRetry: () => void; onRemove: () => void }) {
  const stopped = p.state === "stopped";
  return (
    <span className={`inline-flex max-w-full flex-wrap items-center gap-2 rounded-control border px-2 py-1.5 ${stopped ? "border-red-bar bg-red-soft" : "border-amber-bar bg-amber-soft"}`} data-queued-file={p.id} data-queued-state={p.state}>
      {p.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.previewUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
      ) : (
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white text-[11px] font-bold">{p.kind === "pdf" ? "PDF" : "FILE"}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        {p.name ? <span className="truncate text-xs font-semibold text-ink">{p.name}</span> : null}
        <span className={`text-xs ${stopped ? "font-semibold text-red" : "text-amber"}`}>{pendingWords(p)}</span>
      </span>
      {stopped ? (
        <span className="flex gap-1.5">
          <button type="button" onClick={onRetry} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-xs font-bold text-ink" data-queued-retry>Try again</button>
          <button type="button" onClick={onRemove} className="min-h-11 rounded-control border border-line bg-white px-3 text-xs font-semibold text-muted" data-queued-remove>Remove</button>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The button, the hidden picker, the files still on their way and, once the server has the newest one, a tick. In a form,
 * `pathName` carries the stored path and `pendingName` the path a file still on its way will have.
 */
export function QueuedProofView({
  proof,
  label,
  buttonClass = "min-h-11 rounded-control border-2 border-amber-bar bg-white px-3 text-xs font-bold disabled:opacity-50",
  buttonData,
  inputData,
  pathName,
  pendingName,
  readyWords = "Saved",
  waitingHint,
}: {
  proof: QueuedProof;
  label: string;
  buttonClass?: string;
  /** Test hooks kept from the old uploaders. */
  buttonData?: DataAttrs;
  inputData?: DataAttrs;
  pathName?: string;
  pendingName?: string;
  /** The words next to the tick once the server has the file. */
  readyWords?: string;
  /** A line under a file still on its way (what the person may do meanwhile). */
  waitingHint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span className="inline-flex max-w-full flex-col gap-1.5" data-queued-proof>
      <span className="inline-flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void proof.pick(f);
          }}
          {...inputData}
        />
        <button
          type="button"
          disabled={proof.busy}
          onClick={() => {
            const el = inputRef.current;
            if (!el) return;
            el.value = "";
            el.click();
          }}
          className={buttonClass}
          {...buttonData}
        >
          {proof.busy ? "Preparing…" : label}
        </button>
        {proof.error ? <span className="text-xs font-semibold text-red" data-queued-error>{proof.error}</span> : null}
      </span>
      {proof.pending.map((p) => (
        <QueuedTile
          key={p.id}
          p={p}
          onRetry={() => void proof.retry(p.id)}
          onRemove={() => void proof.remove(p.id)}
        />
      ))}
      {proof.waiting && waitingHint ? <span className="text-xs text-muted">{waitingHint}</span> : null}
      {proof.ready ? (
        <span className="inline-flex flex-wrap items-center gap-2 text-xs font-bold text-green" data-queued-sent>
          <span>✓ {readyWords}</span>
          {proof.ready.url ? (
            <a href={proof.ready.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">{proof.ready.name ?? (proof.ready.kind === "pdf" ? "the PDF" : "the photo")}</a>
          ) : proof.ready.name ? <span>{proof.ready.name}</span> : null}
        </span>
      ) : null}
      {pathName && proof.ready ? <input type="hidden" name={pathName} value={proof.ready.path} /> : null}
      {pendingName && proof.waitingPath ? <input type="hidden" name={pendingName} value={proof.waitingPath} /> : null}
    </span>
  );
}

type QueuedProofUploadProps = { target: ProofTarget; scopeId: string; onSent?: (result: SentResult) => void } & Omit<Parameters<typeof QueuedProofView>[0], "proof">;

/**
 * The hook and the view in one, for a place that only needs the file to land (the page refreshes in `onSent`). A new
 * record starts afresh (the key), so nothing picked for one record is ever handed over for another.
 */
export function QueuedProofUpload(props: QueuedProofUploadProps) {
  return <QueuedProofUploadOne key={`${props.target}:${props.scopeId}`} {...props} />;
}

function QueuedProofUploadOne({ target, scopeId, onSent, ...view }: QueuedProofUploadProps) {
  const proof = useQueuedProof({ target, scopeId, onSent });
  return <QueuedProofView proof={proof} {...view} />;
}
