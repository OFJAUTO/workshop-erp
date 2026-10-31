/**
 * THE send queue for every staff upload screen (31 October 2026, uploads section 10). A file is kept ON THE DEVICE
 * (IndexedDB) from the moment it is picked until the server confirms it: no signal in a basement, the page closed, a new
 * version, the shared tablet's idle lock - it is still there and goes by itself when the signal is back. Every ERP tab
 * runs two lanes (files up to 6 MB, and bigger ones), each taking the next due file after every send, so a photo never
 * waits behind a long video; a per-file Web Lock makes sure no two tabs ever send the same file. Each file carries its
 * own uuid (the same object path on every try: a resumable video carries on, a repeated register answers with the same
 * row), the person who took it, a sending permit for that person (it outlives the session) and the time it was taken.
 * Browser only; everything fails soft - without IndexedDB a file is kept in this page's memory and sent while it stays open.
 */
import { putWithProgress, reportUploadFailure, uploadProblem } from "./upload-client";
import { newUuid } from "./uuid";

export type SendTarget = "gate_in" | "inspection" | "job_file" | "supplier_proof" | "commission_proof" | "credit_note" | "loose_item";

/** What a component hands the queue for one file. */
export type SendInput = {
  target: SendTarget;
  scopeId: string;
  blob: Blob;
  contentType: string;
  /** Extra details the place records with the file: kind, caption, refId, itemKey, isPrescan, duration, token, itemId. */
  fields?: Record<string, unknown>;
  /** The original file name (a PDF's caption). */
  name?: string | null;
  /** A video's picture (a frame taken on the device). */
  poster?: Blob | null;
  takenAt?: number;
  /** A permit the caller already has (the section tablet's PIN step hands one over). */
  grant?: string | null;
  /** Its own id, when the caller must know it in advance. */
  id?: string;
};

export type SendRecord = {
  id: string;
  target: SendTarget;
  scopeId: string;
  scope: string;
  /** The person who took the file: it is only ever recorded under them. */
  staffId: string | null;
  staffName: string | null;
  grant: string | null;
  grantExp: number | null;
  fields: Record<string, unknown>;
  blob: Blob;
  contentType: string;
  name: string | null;
  size: number;
  poster: Blob | null;
  posterId: string | null;
  takenAt: number;
  createdAt: number;
  path: string | null;
  posterPath: string | null;
  uploaded: boolean;
  posterDone: boolean;
  attempts: number;
  nextAt: number;
  lastError: string | null;
  /** Stopped: trying again can never help (the server said so). Needs a person: Remove, or ask. */
  permanent: boolean;
  logged: string[];
  /** Kept in memory only (the device would not keep it): sent while this page stays open. */
  memoryOnly?: boolean;
};

/** What the server answered for a file, handed to the screen that queued it. */
export type SentResult = { ok: true; id: string | null; path: string; url: string | null } & Record<string, unknown>;

export type SendEvent =
  | { type: "queued"; id: string; scope: string }
  | { type: "sending"; id: string; scope: string; progress: number }
  | { type: "waiting"; id: string; scope: string; error: string; attempts: number }
  | { type: "stopped"; id: string; scope: string; error: string }
  | { type: "sent"; id: string; scope: string; result: SentResult; fields: Record<string, unknown> }
  | { type: "removed"; id: string; scope: string };

export const scopeOf = (target: SendTarget, scopeId: string) => `${target}:${scopeId}`;
export const SMALL_BYTES = 6 * 1024 * 1024;
const DB_NAME = "erp-send-queue";
const STORE = "files";
const CHANNEL = "erp-send-queue";

/** Who is signed in on this page (the app layout's meta tag); null on the public phone and tablet pages. */
export function currentStaffId(): string | null {
  try {
    return document.querySelector('meta[name="erp-staff-id"]')?.getAttribute("content") || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The store on the device: the file's state (small, rewritten often) and its bytes (written ONCE, at the pick)   */
/* ------------------------------------------------------------------------------------------------------------ */

/** A file's state without its bytes: what is rewritten as it goes (attempts, retry time, path, permit). */
type SendState = Omit<SendRecord, "blob" | "poster">;
type SendBytes = { id: string; blob: Blob; poster: Blob | null };

const BYTES = "bytes";
const stateOf = (r: SendRecord): SendState => {
  const { blob: _b, poster: _p, ...rest } = r;
  void _b;
  void _p;
  return rest;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = (ev) => {
        const d = req.result;
        const files = d.objectStoreNames.contains(STORE) ? req.transaction!.objectStore(STORE) : d.createObjectStore(STORE, { keyPath: "id" });
        if (!files.indexNames.contains("scope")) files.createIndex("scope", "scope", { unique: false });
        if (!d.objectStoreNames.contains(BYTES)) {
          const bytes = d.createObjectStore(BYTES, { keyPath: "id" });
          // Version 1 kept the bytes inside each record: they move to their own store once.
          if ((ev as IDBVersionChangeEvent).oldVersion >= 1) {
            const cur = files.openCursor();
            cur.onsuccess = () => {
              const c = cur.result;
              if (!c) return;
              const r = c.value as SendRecord;
              if (r.blob) {
                bytes.put({ id: r.id, blob: r.blob, poster: r.poster ?? null } satisfies SendBytes);
                c.update(stateOf(r));
              }
              c.continue();
            };
          }
        }
      };
      req.onsuccess = () => {
        const d = req.result;
        // A connection the browser closed (Safari after the iPad slept, site data cleared): the next call opens a new one.
        d.onversionchange = () => { d.close(); dbPromise = null; };
        d.onclose = () => { dbPromise = null; };
        resolve(d);
      };
      req.onerror = () => { dbPromise = null; resolve(null); };
      req.onblocked = () => { dbPromise = null; resolve(null); };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });
  return dbPromise;
}

/**
 * One transaction over the given stores; resolves only when it really committed (a quota abort is a failure). A connection
 * that turned out to be dead is dropped and the transaction tried once more on a fresh one.
 */
async function withStores<T>(names: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction, done: (v: T) => void) => void, again = true): Promise<{ ok: boolean; value: T | null }> {
  const d = await db();
  if (!d) return { ok: false, value: null };
  try {
    return await new Promise((resolve) => {
      const t = d.transaction(names, mode);
      let value: T | null = null;
      fn(t, (v) => { value = v; });
      t.oncomplete = () => resolve({ ok: true, value });
      t.onerror = () => resolve({ ok: false, value: null });
      t.onabort = () => resolve({ ok: false, value: null });
    });
  } catch {
    dbPromise = null;
    return again ? withStores(names, mode, fn, false) : { ok: false, value: null };
  }
}

/** Files kept only in this page's memory (the device refused to keep them). */
const memory = new Map<string, SendRecord>();

/** Keeps a NEW file: its state and its bytes together, the bytes for the only time. */
async function putNewRecord(r: SendRecord): Promise<boolean> {
  if (r.memoryOnly) {
    memory.set(r.id, r);
    return true;
  }
  return (
    await withStores<null>([STORE, BYTES], "readwrite", (t) => {
      t.objectStore(STORE).put(stateOf(r));
      t.objectStore(BYTES).put({ id: r.id, blob: r.blob, poster: r.poster } satisfies SendBytes);
    })
  ).ok;
}

async function getRecord(id: string): Promise<SendRecord | null> {
  if (memory.has(id)) return memory.get(id)!;
  const res = await withStores<SendRecord | null>([STORE, BYTES], "readonly", (t, done) => {
    const g = t.objectStore(STORE).get(id);
    g.onsuccess = () => {
      const st = g.result as SendState | undefined;
      if (!st) return done(null);
      const b = t.objectStore(BYTES).get(id);
      b.onsuccess = () => {
        const bytes = b.result as SendBytes | undefined;
        done(bytes ? { ...st, blob: bytes.blob, poster: bytes.poster } : null);
      };
    };
  });
  return res.value ?? null;
}

/**
 * Changes one file's state in ONE transaction (never its bytes): a file that was sent or removed meanwhile (another tab)
 * is never brought back. "missing" when it is gone; "failed" when the device could not write.
 */
async function updateRecord(id: string, fn: (r: SendState) => SendState): Promise<SendState | "missing" | "failed"> {
  const mem = memory.get(id);
  if (mem) {
    const next = { ...mem, ...fn(stateOf(mem)) };
    memory.set(id, next);
    return stateOf(next);
  }
  let found = false;
  const res = await withStores<SendState>([STORE], "readwrite", (t, done) => {
    const s = t.objectStore(STORE);
    const g = s.get(id);
    g.onsuccess = () => {
      const cur = g.result as SendState | undefined;
      if (!cur) return;
      found = true;
      const next = fn(cur);
      s.put(next);
      done(next);
    };
  });
  if (!res.ok) return "failed";
  return found && res.value ? res.value : "missing";
}

/** Forgets a file (state and bytes together). False when the device could not do it. */
async function deleteRecord(id: string): Promise<boolean> {
  memory.delete(id);
  return (
    await withStores<null>([STORE, BYTES], "readwrite", (t) => {
      t.objectStore(STORE).delete(id);
      t.objectStore(BYTES).delete(id);
    })
  ).ok;
}

/** Every file waiting on this device (or only those of one place), oldest first, with its bytes. */
export async function listRecords(scope?: string): Promise<SendRecord[]> {
  const stored =
    (
      await withStores<SendRecord[]>([STORE, BYTES], "readonly", (t, done) => {
        const files = t.objectStore(STORE);
        const g = scope ? files.index("scope").getAll(scope) : files.getAll();
        g.onsuccess = () => {
          const states = g.result as SendState[];
          const b = t.objectStore(BYTES).getAll();
          b.onsuccess = () => {
            const bytes = new Map((b.result as SendBytes[]).map((x) => [x.id, x]));
            done(states.flatMap((st) => {
              const x = bytes.get(st.id);
              return x ? [{ ...st, blob: x.blob, poster: x.poster }] : [];
            }));
          };
        };
      })
    ).value ?? [];
  const mem = Array.from(memory.values()).filter((r) => !scope || r.scope === scope);
  const seen = new Set(stored.map((r) => r.id));
  return [...stored, ...mem.filter((r) => !seen.has(r.id))].sort((a, b) => a.createdAt - b.createdAt);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* News between the queue and the screens (this tab and the others)                                             */
/* ------------------------------------------------------------------------------------------------------------ */

const local = typeof window !== "undefined" ? new EventTarget() : null;
let channel: BroadcastChannel | null = null;
function bc(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (m) => {
      const d = m.data as { kind?: string; event?: SendEvent };
      if (d?.kind === "event" && d.event) local?.dispatchEvent(new CustomEvent("send", { detail: d.event }));
      if (d?.kind === "wake") wakeRunner();
    };
  } catch {
    channel = null;
  }
  return channel;
}

function emit(e: SendEvent) {
  local?.dispatchEvent(new CustomEvent("send", { detail: e }));
  try {
    bc()?.postMessage({ kind: "event", event: { ...e } });
  } catch {
    // A result that cannot be copied to the other tabs: they read the page again later.
  }
}

function wakeEverywhere() {
  wakeRunner();
  try {
    bc()?.postMessage({ kind: "wake" });
  } catch {
    // The other tabs look again on their own.
  }
}

/** Listens to the queue's news (this tab and the others). Returns the "stop listening". */
export function onSendEvent(fn: (e: SendEvent) => void): () => void {
  bc();
  const h = (e: Event) => fn((e as CustomEvent<SendEvent>).detail);
  local?.addEventListener("send", h);
  return () => local?.removeEventListener("send", h);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Sending permits: kept per person (the next person on a shared tablet never sends under the last one's)        */
/* ------------------------------------------------------------------------------------------------------------ */

type GrantInfo = { grant: string; expiresAt: number; staffId: string | null; staffName: string | null };
const grants = new Map<string, GrantInfo>();
const grantAsks = new Map<string, Promise<GrantInfo | null>>();
const grantKey = (target: SendTarget, scopeId: string) => `${scopeOf(target, scopeId)}|${currentStaffId() ?? "-"}`;

/** Forgets every permit this page holds (a sign-out, a sign-in, the end of "Act as"). */
export function forgetGrants() {
  grants.clear();
  grantAsks.clear();
}

/**
 * A sending permit for one place, asked while the person is signed in (or holds the phone link), kept for its life for
 * that person. The screens ask for it when they open (`fresh`), so a file picked later without signal already has one.
 */
export function askGrant(target: SendTarget, scopeId: string, body: Record<string, unknown> = {}, opts: { fresh?: boolean } = {}): Promise<GrantInfo | null> {
  const key = grantKey(target, scopeId);
  const have = grants.get(key);
  if (have && !opts.fresh && have.expiresAt - Date.now() > 3_600_000) return Promise.resolve(have);
  const asking = grantAsks.get(key);
  if (asking) return asking;
  const p = (async () => {
    try {
      const r = await fetch("/api/uploads/grant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, scopeId, ...body }), signal: AbortSignal.timeout(20_000), cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as Partial<GrantInfo> & { error?: string };
      if (!r.ok || !j.grant || !j.expiresAt) return have ?? null;
      const info: GrantInfo = { grant: j.grant, expiresAt: j.expiresAt, staffId: j.staffId ?? null, staffName: j.staffName ?? null };
      // A permit for someone else than this page's person (a sign-in changed under it) is never kept.
      const me = currentStaffId();
      if (me && info.staffId && info.staffId !== me) return null;
      grants.set(key, info);
      return info;
    } catch {
      return have ?? null;
    } finally {
      grantAsks.delete(key);
    }
  })();
  grantAsks.set(key, p);
  return p;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Putting a file in the queue                                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */

let persistAsked = false;

/**
 * Keeps the file on the device and wakes the runner. Returns at once with its id; the screen follows it with
 * `onSendEvent` (or `useSendQueue`). A device that refuses to keep it (no space) keeps it in this page's memory.
 */
export async function enqueue(input: SendInput): Promise<SendRecord> {
  const scope = scopeOf(input.target, input.scopeId);
  const me = currentStaffId();
  const cached = input.grant ? null : (grants.get(grantKey(input.target, input.scopeId)) ?? null);
  const g = input.grant ? { grant: input.grant, expiresAt: Date.now() + 11 * 3_600_000, staffId: grantPerson(input.grant), staffName: null } : cached && (!me || !cached.staffId || cached.staffId === me) ? cached : null;
  const rec: SendRecord = {
    id: input.id ?? newUuid(),
    target: input.target,
    scopeId: input.scopeId,
    scope,
    staffId: g?.staffId ?? me,
    staffName: g?.staffName ?? null,
    grant: g?.grant ?? null,
    grantExp: g?.expiresAt ?? null,
    fields: input.fields ?? {},
    blob: input.blob,
    contentType: input.contentType,
    name: input.name ?? null,
    size: input.blob.size,
    poster: input.poster ?? null,
    posterId: input.poster ? newUuid() : null,
    takenAt: input.takenAt ?? Date.now(),
    createdAt: Date.now(),
    path: null,
    posterPath: null,
    uploaded: false,
    posterDone: !input.poster,
    attempts: 0,
    nextAt: 0,
    lastError: null,
    permanent: false,
    logged: [],
  };
  if (!persistAsked && typeof navigator !== "undefined" && navigator.storage?.persist) {
    persistAsked = true;
    void navigator.storage.persist().catch(() => false);
  }
  const kept = await putNewRecord(rec);
  if (!kept) {
    rec.memoryOnly = true;
    memory.set(rec.id, rec);
  }
  try {
    localStorage.setItem("erp-send-queue-used", "1");
  } catch {
    // Only a hint for the runner on pages that never sent anything.
  }
  emit({ type: "queued", id: rec.id, scope });
  // A file picked without a permit asks for one now (still signed in), so it can outlive the session - only one for the
  // same person who took it.
  if (!rec.grant) void askGrant(rec.target, rec.scopeId, grantBodyOf(rec)).then(async (info) => {
    if (!info || (rec.staffId && info.staffId && info.staffId !== rec.staffId)) return;
    await updateRecord(rec.id, (cur) => (cur.grant ? cur : { ...cur, grant: info.grant, grantExp: info.expiresAt, staffId: cur.staffId ?? info.staffId, staffName: info.staffName }));
  });
  try {
    window.dispatchEvent(new Event("erp:send-queued"));
  } catch {
    // No window (a test): the runner looks again on its own.
  }
  wakeEverywhere();
  return rec;
}

/** The person a permit names (its signed body says so; the server checks the signature, this only reads who). */
function grantPerson(grant: string): string | null {
  try {
    const body = grant.slice(0, grant.lastIndexOf(".")).replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(body + "=".repeat((4 - (body.length % 4)) % 4))) as { u?: unknown };
    return typeof json.u === "string" ? json.u : null;
  } catch {
    return null;
  }
}

/** What a place's permit check needs to see (the kind, the phone link, a found-after caption, a PDF). */
function grantBodyOf(r: Pick<SendRecord, "fields" | "contentType">): Record<string, unknown> {
  const f = r.fields;
  return { kind: f.kind, token: f.token, caption: f.caption, itemKey: f.itemKey, itemId: f.itemId, contentType: r.contentType };
}

/** Tries a waiting (or stopped) file again now. */
export async function retryNow(id: string): Promise<void> {
  heldBack.delete(id);
  const r = await updateRecord(id, (cur) => ({ ...cur, nextAt: 0, permanent: false, lastError: cur.permanent ? null : cur.lastError }));
  if (r === "missing") return;
  wakeEverywhere();
}

/** Takes a file off the queue (it will not be sent). */
export async function removeQueued(id: string): Promise<void> {
  const r = await getRecord(id);
  await deleteRecord(id);
  if (r) emit({ type: "removed", id, scope: r.scope });
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The runner: two lanes in every tab, one file at a time per lane, a per-file lock across tabs                   */
/* ------------------------------------------------------------------------------------------------------------ */

const wakers = new Set<() => void>();
/**
 * Files this tab holds back in memory, until a time: their state could not be written on the device (no space), so the
 * stored retry time is stale - without this a lane would take them again at once, in a loop. Also a file already sent
 * whose removal from the device did not go through (never sent twice).
 */
const heldBack = new Map<string, number>();
let started = false;
/** Files being sent from this tab right now. */
const inFlight = new Set<string>();

export function wakeRunner() {
  for (const w of Array.from(wakers)) w();
}

const BACKOFF_S = [5, 15, 30, 60, 120, 300];

function backoffMs(attempts: number) {
  return BACKOFF_S[Math.min(attempts - 1, BACKOFF_S.length - 1)] * 1000;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      wakers.delete(finish);
      resolve();
    };
    const t = setTimeout(finish, ms);
    wakers.add(finish);
  });

type Answer = { ok: boolean; status: number; json: Record<string, unknown> };

async function post(url: string, body: Record<string, unknown>, timeoutMs = 60_000): Promise<Answer> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  // A redirect (signed out on a page that is not public) or an HTML error page: not an answer from the door.
  const json = res.redirected || !(res.headers.get("content-type") ?? "").includes("json") ? {} : ((await res.json().catch(() => ({}))) as Record<string, unknown>);
  return { ok: res.ok && !res.redirected, status: res.redirected ? 401 : res.status, json };
}

class Stop extends Error {
  constructor(message: string, readonly permanent: boolean, readonly status: number | null) {
    super(message);
  }
}

const OFFLINE_WORDS = "No signal – it will send by itself when the signal is back.";

function stopOf(a: Answer, fallback: string): Stop {
  const words = typeof a.json.error === "string" && a.json.error ? String(a.json.error) : fallback;
  return new Stop(words, a.json.permanent === true, a.status);
}

/** Saves a file's progress, unless it was removed meanwhile (then the send stops and it stays removed). */
async function keep(r: SendRecord): Promise<void> {
  const res = await updateRecord(r.id, () => stateOf(r));
  if (res === "missing") throw new Stop("Removed.", true, null);
}

/** Prepare -> send -> (a video's picture) -> record, for one file. Throws a Stop with plain words when it cannot finish. */
async function sendOne(rec: SendRecord): Promise<SentResult> {
  let r = rec;
  // A permit that has run out: renewed while the SAME person is still signed in on this device (never someone else's).
  // Not before: the first permit is the proof of when the file was taken, for a report closed meanwhile.
  if (!r.grant || (r.grantExp ?? 0) - Date.now() < 60_000) {
    const info = await askGrant(r.target, r.scopeId, grantBodyOf(r)).catch(() => null);
    if (info && (!r.staffId || info.staffId === r.staffId)) {
      r = { ...r, grant: info.grant, grantExp: info.expiresAt, staffId: r.staffId ?? info.staffId, staffName: r.staffName ?? info.staffName };
      await keep(r);
    }
  }
  // takenBy: when the permit has run out, the server sends it under the signed-in person only if that is the taker.
  const base = { ...r.fields, target: r.target, scopeId: r.scopeId, grant: r.grant, takenAt: r.takenAt, takenBy: r.staffId ?? undefined };
  // Already in storage on an earlier try: only the record step is left (never "Sending… 0%" again).
  if (r.uploaded) emit({ type: "sending", id: r.id, scope: r.scope, progress: 0.97 });
  // 1. The main file, unless it already arrived on an earlier try.
  if (!r.uploaded) {
    const prep = await post("/api/uploads/prepare", { ...base, fileId: r.id, contentType: r.contentType });
    if (!prep.ok) throw stopOf(prep, "Could not prepare the upload.");
    const path = String(prep.json.path ?? "");
    if (!path) throw new Stop("Could not prepare the upload.", false, prep.status);
    if (!prep.json.exists) {
      const url = String(prep.json.url ?? "");
      try {
        await putWithProgress(url, r.blob, r.contentType, (p) => emit({ type: "sending", id: r.id, scope: r.scope, progress: Math.min(0.97, p) }));
      } catch (err) {
        const status = (err as { status?: number }).status ?? null;
        const said = `${err instanceof Error ? err.message : ""} ${String((err as { body?: string }).body ?? "")}`;
        // Too big for storage: no try can ever fix it - say so instead of trying for ever.
        if (status === 413 || /exceeded the maximum allowed size|payload too large|entity too large|"413"/i.test(said)) throw new Stop(`Too big to send (${Math.round(r.size / 1024 / 1024)} MB is over the limit) – record a shorter video or take a smaller photo.`, true, 413);
        // "Already there" (a try that finished while its answer was lost): straight to the record step. Anything else
        // (an address that expired, a server hiccup) is tried again with a fresh address.
        if (!(/already exists|duplicate|"409"/i.test(said) || status === 409)) throw new Stop(status ? uploadProblem(err, status).words : err instanceof Error ? err.message : "Upload failed.", false, status);
      }
    }
    r = { ...r, path, uploaded: true };
    await keep(r);
  }
  // 2. A video's picture: tried on the first two tries; after that the video goes without it rather than wait.
  if (!r.posterDone && r.poster && r.posterId) {
    let failed = false;
    try {
      const pp = await post("/api/uploads/prepare", { ...base, fileId: r.posterId, contentType: "image/jpeg" });
      if (pp.ok && pp.json.path) {
        if (!pp.json.exists && pp.json.url) await putWithProgress(String(pp.json.url), r.poster, "image/jpeg", () => undefined);
        r = { ...r, posterPath: String(pp.json.path), posterDone: true };
      } else if (pp.json.permanent === true) {
        r = { ...r, posterDone: true };
      } else {
        failed = true;
      }
    } catch {
      failed = true;
    }
    if (failed && r.attempts === 0) throw new Stop("Sending the video's picture – it tries again by itself.", false, null);
    if (failed) r = { ...r, posterDone: true };
    await keep(r);
  }
  // 3. Record it.
  const reg = await post("/api/uploads/register", { ...base, path: r.path, contentType: r.contentType, posterPath: r.posterPath ?? undefined, caption: r.fields.caption ?? (r.contentType === "application/pdf" ? r.name : undefined) });
  if (!reg.ok) {
    if (reg.status === 409) await keep({ ...r, uploaded: false });
    throw stopOf(reg, "Could not record the file.");
  }
  return reg.json as SentResult;
}

/** Sends one file (it was claimed for this tab). */
async function sendRecord(id: string): Promise<void> {
  const cur = await getRecord(id);
  if (!cur || cur.permanent || cur.nextAt > Date.now()) return;
  emit({ type: "sending", id: cur.id, scope: cur.scope, progress: cur.uploaded ? 0.97 : 0 });
  try {
    const result = await sendOne(cur);
    // Sent: if the device could not forget it, this tab never takes it again (another tab's register answers the same row).
    if (!(await deleteRecord(cur.id))) heldBack.set(cur.id, Number.POSITIVE_INFINITY);
    emit({ type: "sent", id: cur.id, scope: cur.scope, result, fields: cur.fields });
  } catch (err) {
    const stop = err instanceof Stop ? err : new Stop(err instanceof Error ? err.message : "Upload failed.", false, null);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    // No signal only when there was no answer at all (no HTTP status): "Upload failed (403)" is a refusal, not a dead
    // signal - and it must never read "No signal" (Safari's own words for no signal are exactly "Load failed").
    const noAnswer = stop.status === null || stop.status === 0;
    const words = offline || (noAnswer && /^(failed to fetch|load failed)$|networkerror|network error|check the connection|timed? ?out|abort|stopped/i.test(stop.message.trim())) ? OFFLINE_WORDS : stop.message;
    const reason = stop.permanent ? `stopped:${words}` : offline ? "offline" : `status:${stop.status ?? "none"}`;
    let firstTime = false;
    const next = await updateRecord(cur.id, (latest) => {
      firstTime = !latest.logged.includes(reason);
      const attempts = latest.attempts + 1;
      return { ...latest, attempts, lastError: words, permanent: stop.permanent, nextAt: Date.now() + backoffMs(attempts), logged: firstTime ? [...latest.logged, reason] : latest.logged };
    });
    // Removed while it was on its way (or the "Removed." stop itself): it stays removed.
    if (next === "missing") return;
    if (next === "failed") {
      // The device would not write the new state (no space): held back in memory instead, and still said on screen.
      const attempts = cur.attempts + 1;
      heldBack.set(cur.id, stop.permanent ? Number.POSITIVE_INFINITY : Date.now() + backoffMs(attempts));
      emit(stop.permanent ? { type: "stopped", id: cur.id, scope: cur.scope, error: words } : { type: "waiting", id: cur.id, scope: cur.scope, error: words, attempts });
      return;
    }
    if (firstTime && !offline) {
      reportUploadFailure({ jobId: ["gate_in", "job_file", "loose_item"].includes(cur.target) ? cur.scopeId : null, inspectionId: cur.target === "inspection" ? cur.scopeId : null, kind: `${cur.target}:${String(cur.fields.kind ?? "file")}`, step: next.uploaded ? "register" : "upload", error: words, sizeBytes: cur.size, contentType: cur.contentType, extra: { attempts: next.attempts, permanent: stop.permanent, status: stop.status, queued: true } });
    }
    emit(stop.permanent ? { type: "stopped", id: cur.id, scope: cur.scope, error: words } : { type: "waiting", id: cur.id, scope: cur.scope, error: words, attempts: next.attempts });
  }
}

/**
 * Takes one file for this tab: never one this tab is already sending, and - with Web Locks - never one another tab is
 * sending (a per-file lock, so a tab the browser put to sleep holds back only its own file, never the queue).
 */
async function claimAndSend(id: string): Promise<boolean> {
  if (inFlight.has(id)) return false;
  inFlight.add(id);
  try {
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (locks?.request) {
      let ran = false;
      await locks.request(`erp-send:${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        ran = true;
        await sendRecord(id);
      });
      return ran;
    }
    await sendRecord(id);
    return true;
  } catch {
    return false;
  } finally {
    inFlight.delete(id);
  }
}

const inLane = (r: SendRecord, big: boolean) => (r.size > SMALL_BYTES) === big;

/** One lane: the next due file of its size after every send, so a file queued meanwhile starts as soon as the lane is free. */
async function laneLoop(big: boolean, stopped: { value: boolean }) {
  while (!stopped.value) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await sleep(60_000);
      continue;
    }
    const all = await listRecords().catch(() => [] as SendRecord[]);
    const now = Date.now();
    const due = all.filter((r) => inLane(r, big) && !r.permanent && r.nextAt <= now && !inFlight.has(r.id) && !((heldBack.get(r.id) ?? 0) > now));
    let sent = false;
    for (const r of due) {
      if (stopped.value) return;
      if (await claimAndSend(r.id)) {
        sent = true;
        break;
      }
    }
    if (sent) continue;
    // The next time each waiting file of this lane is due (a file held back in memory counts from that time).
    const nextTimes = all.filter((r) => inLane(r, big) && !r.permanent).map((r) => Math.max(r.nextAt, heldBack.get(r.id) ?? 0)).filter((t) => Number.isFinite(t));
    // Due files another tab is sending: look again shortly. Otherwise sleep until the earliest retry (at most a minute),
    // or ten minutes when this lane has nothing; a new file, the signal or the page coming back wakes it at once.
    const wait = due.length ? 5_000 : nextTimes.length ? Math.min(60_000, Math.max(1_000, Math.min(...nextTimes) - now)) : 10 * 60_000;
    await sleep(wait);
  }
}

/**
 * Starts the runner on this page, once for the whole page life (never restarted by a page change). Two lanes; wakes on a
 * new file, the signal coming back and the page coming back to view.
 */
export function startSendRunner(): () => void {
  if (typeof window === "undefined" || started) return () => undefined;
  started = true;
  const stopped = { value: false };
  const kick = () => wakeRunner();
  const back = () => {
    // The signal is back: everything waiting goes now, not at its retry time (each record changed in one step).
    void listRecords().then(async (all) => {
      for (const r of all) if (!r.permanent && r.nextAt > Date.now()) await updateRecord(r.id, (cur) => (cur.permanent ? cur : { ...cur, nextAt: 0 }));
      kick();
    });
  };
  window.addEventListener("online", back);
  window.addEventListener("erp:send-queued", kick);
  document.addEventListener("visibilitychange", kick);
  bc();
  void laneLoop(false, stopped);
  void laneLoop(true, stopped);
  return () => {
    stopped.value = true;
    started = false;
    wakeRunner();
    window.removeEventListener("online", back);
    window.removeEventListener("erp:send-queued", kick);
    document.removeEventListener("visibilitychange", kick);
  };
}
