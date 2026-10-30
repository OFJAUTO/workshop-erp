/**
 * Photos waiting to be sent, kept ON THE PHONE (IndexedDB) until the server confirms them (30 October 2026). No signal
 * in a basement, the page closed, the phone restarted: the photo is still there and is sent by itself when the signal
 * is back. Browser only; every call fails soft (a browser without IndexedDB just sends at once, as before).
 */
export type QueuedUpload = {
  id: string;
  /** What the item belongs to, e.g. "drive:<token>". */
  scope: string;
  /** The step it completes, e.g. "loaded" / "final". */
  step: string;
  blob: Blob;
  contentType: string;
  /** Extra fields the step needs (the driver's price). */
  fields: Record<string, string>;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Reasons already written to the server's failure log (each once per item). */
  logged: string[];
  /** Failures not written to the log yet (no signal to write them): sent with the next try. */
  pendingLogs?: { reason: string; error: string; status: number | null; attempts: number; online: boolean; at: number }[];
};

const DB_NAME = "erp-upload-queue";
const STORE = "items";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(null);
    }
  });
}

/** Keeps the item (a second call with the same id replaces it). False when the phone cannot keep it. */
export async function queuePut(item: QueuedUpload): Promise<boolean> {
  return (await run("readwrite", (s) => s.put(item))) !== null;
}

/** The items of one scope, oldest first. */
export async function queueList(scope: string): Promise<QueuedUpload[]> {
  const all = ((await run("readonly", (s) => s.getAll())) ?? []) as QueuedUpload[];
  return all.filter((i) => i.scope === scope).sort((a, b) => a.createdAt - b.createdAt);
}

export async function queueDelete(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}
