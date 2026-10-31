import { useCallback, useEffect, useRef, useState } from "react";
import { askGrant, enqueue, listRecords, onSendEvent, removeQueued, retryNow, scopeOf, type SendInput, type SendRecord, type SendTarget, type SentResult } from "./send-queue";

/** One file of this screen still on the device: its picture (made on the device), its state and what went wrong. */
export type PendingFile = {
  id: string;
  kind: "image" | "video" | "pdf" | "file";
  /** A picture made on the device (photo, or a video's frame); null for a PDF. Freed when the file leaves. */
  previewUrl: string | null;
  name: string | null;
  /** queued: not tried yet · sending: on its way (progress) · waiting: will try again by itself · stopped: needs a person. */
  state: "queued" | "sending" | "waiting" | "stopped";
  progress: number;
  error: string | null;
  fields: Record<string, unknown>;
  /** The device would not keep it: it is sent while this page stays open. */
  memoryOnly: boolean;
  takenAt: number;
  size: number;
};

const kindOf = (contentType: string): PendingFile["kind"] => (contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : contentType === "application/pdf" ? "pdf" : "file");

/**
 * THE hook every staff uploader uses (31 October 2026): hand it files, it keeps them on the device and the runner sends
 * them; the screen shows each one with its own picture and state until the server confirms it, then `onSent` gets the
 * server's answer (the same shape the old prepare/register gave). Files of this place still waiting from an earlier visit
 * (a reload, a new version, the tablet's idle lock) come back on screen by themselves. `match` keeps one uploader to its
 * own files when several share a place (an item key, a kind, a reference).
 */
export function useSendQueue(opts: {
  target: SendTarget;
  scopeId: string | null;
  /** What the place's permit check needs (the kind, the phone link token, a found-after caption). */
  grantBody?: Record<string, unknown>;
  match?: (fields: Record<string, unknown>) => boolean;
  onSent?: (result: SentResult, fields: Record<string, unknown>, id: string) => void;
}) {
  const { target, scopeId } = opts;
  const scope = scopeId ? scopeOf(target, scopeId) : null;
  const [pending, setPending] = useState<PendingFile[]>([]);
  // Another place for the same uploader (it was re-pointed): start from that place's own files.
  const [forScope, setForScope] = useState(scope);
  if (forScope !== scope) {
    setForScope(scope);
    setPending([]);
  }
  const urls = useRef(new Map<string, string>());
  /** Files already sent or removed: a listing that answers late never brings them back on screen. */
  const gone = useRef(new Set<string>());
  const onSent = useRef(opts.onSent);
  const match = useRef(opts.match);
  const grantBody = useRef(opts.grantBody);
  useEffect(() => {
    onSent.current = opts.onSent;
    match.current = opts.match;
    grantBody.current = opts.grantBody;
  });

  const view = useCallback((r: Pick<SendRecord, "id" | "blob" | "poster" | "contentType" | "name" | "permanent" | "lastError" | "attempts" | "fields" | "memoryOnly" | "takenAt" | "size">, state?: PendingFile["state"]): PendingFile => {
    let url = urls.current.get(r.id) ?? null;
    if (!url) {
      const pic = r.contentType.startsWith("image/") ? r.blob : r.poster;
      if (pic) {
        try {
          url = URL.createObjectURL(pic);
          urls.current.set(r.id, url);
        } catch {
          url = null;
        }
      }
    }
    return {
      id: r.id,
      kind: kindOf(r.contentType),
      previewUrl: url,
      name: r.name,
      state: state ?? (r.permanent ? "stopped" : r.attempts > 0 ? "waiting" : "queued"),
      progress: 0,
      error: r.lastError,
      fields: r.fields,
      memoryOnly: !!r.memoryOnly,
      takenAt: r.takenAt,
      size: r.size,
    };
  }, []);

  const free = useCallback((id: string) => {
    const u = urls.current.get(id);
    if (u) URL.revokeObjectURL(u);
    urls.current.delete(id);
  }, []);

  // Files of this place still on the device (an earlier visit), and the permit for new ones.
  useEffect(() => {
    if (!scope || !scopeId) return;
    let live = true;
    const urlMap = urls.current;
    void listRecords(scope).then((rows) => {
      if (!live) return;
      const mine = rows.filter((r) => !gone.current.has(r.id) && (!match.current || match.current(r.fields)));
      setPending((cur) => {
        const have = new Set(cur.map((p) => p.id));
        const add = mine.filter((r) => !have.has(r.id));
        return add.length ? [...cur, ...add.map((r) => view(r))] : cur;
      });
    });
    void askGrant(target, scopeId, grantBody.current ?? {});
    const again = setInterval(() => void askGrant(target, scopeId, grantBody.current ?? {}), 30 * 60_000);
    return () => {
      live = false;
      clearInterval(again);
      // Leaving this place: its pictures made on the device are freed (the new place makes its own).
      for (const u of urlMap.values()) URL.revokeObjectURL(u);
      urlMap.clear();
    };
  }, [scope, scopeId, target, view]);

  // The queue's news for this place.
  useEffect(() => {
    if (!scope) return;
    return onSendEvent((e) => {
      if (e.scope !== scope) return;
      if (e.type === "sent" || e.type === "removed") {
        gone.current.add(e.id);
        setPending((cur) => (cur.some((p) => p.id === e.id) ? cur.filter((p) => p.id !== e.id) : cur));
        free(e.id);
        if (e.type === "sent" && (!match.current || match.current(e.fields))) onSent.current?.(e.result, e.fields, e.id);
        return;
      }
      if (e.type === "queued") {
        // A file of this place queued by another uploader or another tab: shown here too when it is this uploader's.
        if (gone.current.has(e.id)) return;
        void listRecords(scope).then((rows) => {
          const r = rows.find((x) => x.id === e.id);
          if (!r || gone.current.has(r.id) || (match.current && !match.current(r.fields))) return;
          setPending((cur) => (cur.some((p) => p.id === r.id) ? cur : [...cur, view(r)]));
        });
        return;
      }
      setPending((cur) => {
        // Only this uploader's own files: another file's progress never re-draws it.
        if (!cur.some((p) => p.id === e.id)) return cur;
        return cur.map((p) => {
          if (p.id !== e.id) return p;
          if (e.type === "sending") return { ...p, state: "sending", progress: e.progress, error: null };
          if (e.type === "waiting") return { ...p, state: "waiting", progress: 0, error: e.error };
          if (e.type === "stopped") return { ...p, state: "stopped", progress: 0, error: e.error };
          return p;
        });
      });
    });
  }, [scope, free, view]);

  useEffect(() => {
    const map = urls.current;
    return () => {
      for (const u of map.values()) URL.revokeObjectURL(u);
      map.clear();
    };
  }, []);

  /** Puts files in the queue (each shows at once with its own picture). Returns their ids. */
  const add = useCallback(
    async (files: Omit<SendInput, "target" | "scopeId">[]): Promise<string[]> => {
      if (!scopeId) return [];
      const ids: string[] = [];
      for (const f of files) {
        const rec = await enqueue({ ...f, target, scopeId });
        ids.push(rec.id);
        setPending((cur) => (cur.some((p) => p.id === rec.id) ? cur : [...cur, view(rec)]));
      }
      return ids;
    },
    [scopeId, target, view],
  );

  return { pending, add, retry: retryNow, remove: removeQueued };
}

/** "Saved on this device – sending 40%", "No signal – it will send by itself …", in one line for a pending file. */
export function pendingWords(p: PendingFile): string {
  // The runner does not try while there is no signal, so a file picked in a basement says so itself.
  if ((p.state === "queued" || p.state === "waiting") && typeof navigator !== "undefined" && navigator.onLine === false) return "Saved on this device – no signal, it sends by itself when the signal is back.";
  if (p.state === "sending") return `Sending… ${Math.round(p.progress * 100)}%`;
  if (p.state === "stopped") return p.error ?? "Could not be sent.";
  if (p.state === "waiting") return p.error ?? "Waiting to send – it will try again by itself.";
  return p.memoryOnly ? "Waiting to send – keep this page open" : "Saved on this device – sending";
}

export type { SentResult };
