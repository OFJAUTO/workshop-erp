"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { putWithProgress, shrinkPhoto, uploadProblem, type UploadProblem } from "@/lib/upload-client";
import { queueDelete, queueList, queuePut, type QueuedUpload } from "@/lib/upload-queue";

/**
 * The driver's page, big buttons only. A DELIVERY is one step: "Delivered to the customer" with the photo, then the
 * price, SEND. A PICK-UP is two: "Car loaded" with a photo first (OFJ sees it is on the way), then "Delivered to OFJ"
 * with a photo and the price. Works once; afterwards "Done, thank you".
 *
 * 30 October 2026: the photo is shrunk on the phone (about 0.5 MB), KEPT ON THE PHONE until OFJ has it, and sent
 * straight to storage. No signal: "Saved – will send when the signal is back" in amber, the driver carries on, and it
 * goes by itself when the signal is back - even after the page was closed and opened again. Every failure is written
 * to the owner's upload log with its reason.
 */
type Step = "loaded" | "final";
const RETRY_MS = 10_000;

export function DriveClient({ token, kind, loadedAt = null, officePhone = null }: { token: string; kind: "delivery" | "pickup"; loadedAt?: string | null; officePhone?: string | null }) {
  const scope = `drive:${token}`;
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  // A phone that cannot keep the photo (no IndexedDB) still sends it from memory while the page is open.
  const queueMemory = useRef<QueuedUpload[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [loaded, setLoaded] = useState(!!loadedAt);
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [sending, setSending] = useState<{ step: Step; progress: number } | null>(null);
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const finalWaiting = queue.some((q) => q.step === "final");
  // The step on screen: a pick-up first loads the car, then delivers it to OFJ.
  const step: Step = kind === "pickup" && !loaded ? "loaded" : "final";
  const word = step === "loaded" ? "CAR LOADED" : kind === "pickup" ? "DELIVERED TO OFJ" : "DELIVERED TO THE CUSTOMER";

  /** Writes the item's waiting failures to the owner's log; a failure seen without signal is written once the signal is back. */
  const flushLogs = useCallback(
    async (item: QueuedUpload): Promise<QueuedUpload> => {
      const waitingLogs = item.pendingLogs ?? [];
      if (!waitingLogs.length) return item;
      const left: NonNullable<QueuedUpload["pendingLogs"]> = [];
      const logged = [...item.logged];
      for (const l of waitingLogs) {
        const ok = await fetch(`/api/drive/${token}/failure`, { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, body: JSON.stringify({ step: item.step, reason: l.reason, error: l.error, status: l.status, sizeBytes: item.blob.size, contentType: item.contentType, attempts: l.attempts, online: l.online, itemId: item.id }) }).then(
          (r) => r.ok,
          () => false,
        );
        if (ok) logged.push(l.reason);
        else left.push(l);
      }
      const next = { ...item, logged, pendingLogs: left };
      await queuePut(next);
      return next;
    },
    [token],
  );

  /** One item: a fresh signed address, the photo straight to storage, then the step with the photo's name. */
  const sendItem = useCallback(
    async (item: QueuedUpload): Promise<"ok" | "done" | { p: UploadProblem; err: unknown; status: number | null }> => {
      let status: number | null = null;
      try {
        const prep = await fetch(`/api/drive/${token}/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: item.step, contentType: item.contentType }) });
        status = prep.status;
        const pj = (await prep.json().catch(() => ({}))) as { path?: string; url?: string; code?: string; error?: string };
        if (prep.status === 409 || pj.code === "done") return "done";
        if (prep.status === 410 || pj.code === "link") return { p: uploadProblem(null, prep.status, { phone: officePhone, linkError: true }), err: pj.error, status };
        if (!prep.ok || !pj.path || !pj.url) return { p: uploadProblem(new Error(pj.error ?? "prepare failed"), prep.status), err: pj.error ?? "prepare failed", status };
        status = null;
        await putWithProgress(pj.url, item.blob, item.contentType, (x) => setSending({ step: item.step as Step, progress: x }));
        const fin = await fetch(`/api/drive/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: item.step, path: pj.path, contentType: item.contentType, price: item.fields.price ?? "" }) });
        status = fin.status;
        const fj = (await fin.json().catch(() => ({}))) as { code?: string; error?: string };
        if (fin.ok) return "ok";
        if (fin.status === 409 || fj.code === "done") return "done";
        if (fin.status === 410 || fj.code === "link") return { p: uploadProblem(null, fin.status, { phone: officePhone, linkError: true }), err: fj.error, status };
        return { p: uploadProblem(new Error(fj.error ?? "step failed"), fin.status), err: fj.error ?? "step failed", status };
      } catch (err) {
        const st = (err as { status?: number })?.status ?? status;
        return { p: uploadProblem(err, st ?? null), err, status: st ?? null };
      }
    },
    [token, officePhone],
  );

  /** Sends what waits, oldest first; stops at the first one that cannot go yet (tried again by itself). */
  const process = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      let items = await queueList(scope);
      if (!items.length) items = queueMemory.current;
      for (const stored of items) {
        const item = await flushLogs(stored);
        setSending({ step: item.step as Step, progress: 0 });
        const r = await sendItem(item);
        if (r === "ok" || r === "done") {
          await queueDelete(item.id);
          queueMemory.current = queueMemory.current.filter((x) => x.id !== item.id);
          setQueue((q) => q.filter((x) => x.id !== item.id));
          if (item.step === "final") setDone(true);
          setProblem(null);
          continue;
        }
        let next: QueuedUpload = { ...item, attempts: item.attempts + 1, lastError: r.p.words };
        // Each reason once per photo in the owner's log: written now, or with the next try when there is no signal.
        if (!item.logged.includes(r.p.reason) && !(item.pendingLogs ?? []).some((l) => l.reason === r.p.reason)) {
          next.pendingLogs = [...(item.pendingLogs ?? []), { reason: r.p.reason, error: r.err instanceof Error ? r.err.message : String(r.err ?? ""), status: r.status, attempts: next.attempts, online: navigator.onLine, at: Date.now() }];
          next = await flushLogs(next);
        }
        await queuePut(next);
        queueMemory.current = queueMemory.current.map((x) => (x.id === item.id ? next : x));
        setQueue((q) => q.map((x) => (x.id === item.id ? next : x)));
        setProblem(r.p);
        break;
      }
    } finally {
      setSending(null);
      busy.current = false;
    }
  }, [scope, sendItem, flushLogs]);

  // Opening the page: anything still waiting from before is shown and sent again.
  useEffect(() => {
    let alive = true;
    void queueList(scope).then((items) => {
      if (!alive || !items.length) return;
      setQueue(items);
      if (items.some((i) => i.step === "loaded")) setLoaded(true);
      void process();
    });
    return () => {
      alive = false;
    };
  }, [scope, process]);

  // Tried again when the signal comes back, when the screen is opened again, and every few seconds while something waits.
  useEffect(() => {
    if (!queue.length) return;
    const again = () => void process();
    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(again, RETRY_MS);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [queue.length, process]);

  const send = async () => {
    if (!photo) { setError("Take the photo first."); return; }
    if (step === "final" && !(Number(price.replace(",", ".")) > 0)) { setError("Enter the price in AED."); return; }
    setError(null);
    setPreparing(true);
    // Shrunk on the phone first: about 0.5 MB, the plate still readable.
    const small = await shrinkPhoto(photo);
    const item: QueuedUpload = { id: crypto.randomUUID(), scope, step, blob: small.blob, contentType: small.type, fields: step === "final" ? { price } : {}, createdAt: Date.now(), attempts: 0, lastError: null, logged: [] };
    const kept = await queuePut(item);
    if (!kept) queueMemory.current = [...queueMemory.current, item];
    setQueue((q) => [...q, item]);
    setPreparing(false);
    // The driver carries on at once: the photo is safe on the phone, the next step is open.
    if (step === "loaded") setLoaded(true);
    setPhoto(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
    void process();
  };

  if (done) {
    return <div className="flex min-h-[50vh] items-center justify-center p-6"><p className="text-center text-3xl font-extrabold" data-drive-done>Done. Thank you!</p></div>;
  }
  const waiting = queue.length;
  const failedOnce = queue.some((q) => q.attempts > 0);
  const linkDead = problem?.reason === "link";
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 p-5">
      {kind === "pickup" ? (
        <div className="flex items-center gap-2 text-sm font-extrabold" data-drive-steps>
          <span className={`rounded-full px-3 py-1 ${step === "loaded" ? "bg-[#111113] text-white" : "bg-[#E8F5EC] text-[#1b6b2f]"}`}>1 · Car loaded{loaded ? " ✓" : ""}</span>
          <span className={`rounded-full px-3 py-1 ${step === "final" ? "bg-[#111113] text-white" : "bg-[#F4F4F5] text-[#5F6368]"}`}>2 · Delivered to OFJ</span>
        </div>
      ) : null}
      {waiting && !linkDead ? (
        sending && !failedOnce ? (
          <div className="rounded-2xl border-2 border-[#111113] px-4 py-3 text-center text-lg font-extrabold" data-drive-sending>
            Sending the photo… {Math.round(sending.progress * 100)}%
          </div>
        ) : (
          <div className="flex flex-col gap-1 rounded-2xl border-2 border-[#B26A00] bg-[#FFF4E0] px-4 py-3 text-center" data-drive-waiting={waiting}>
            <span className="text-lg font-extrabold text-[#8A5300]">Saved – will send when the signal is back ({waiting} waiting)</span>
            {problem ? <span className="text-sm font-semibold text-[#8A5300]" data-drive-problem={problem.reason}>{problem.words}</span> : null}
            {sending ? <span className="text-sm font-semibold text-[#8A5300]">Trying now… {Math.round(sending.progress * 100)}%</span> : null}
          </div>
        )
      ) : null}
      {linkDead ? (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-[#B3261E] bg-[#FDECEA] px-4 py-3 text-center" data-drive-link-dead>
          <span className="text-lg font-extrabold text-[#B3261E]">{problem?.words}</span>
          {officePhone ? <a href={`tel:${officePhone.replace(/[^\d+]/g, "")}`} className="flex min-h-14 items-center justify-center rounded-xl bg-[#111113] px-4 text-xl font-extrabold text-white">Call OFJ</a> : null}
          <span className="text-sm font-semibold text-[#5F6368]">Your photo is kept on this phone.</span>
        </div>
      ) : null}
      {finalWaiting ? (
        <p className="text-center text-2xl font-extrabold" data-drive-final-saved>Done on your side. The photo goes to OFJ by itself.</p>
      ) : (
        <>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setPhoto(f); setPreview(f ? URL.createObjectURL(f) : null); setError(null); }} data-drive-file />
          {!photo ? (
            <button type="button" onClick={() => fileRef.current?.click()} className="flex min-h-40 w-full items-center justify-center rounded-2xl bg-[#111113] px-6 text-center text-3xl font-extrabold leading-tight text-white" data-drive-photo>
              {word}:<br />TAKE PHOTO
            </button>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview ? <img src={preview} alt="The photo" className="w-full rounded-2xl border-2 border-[#111113]" /> : null}
              <button type="button" onClick={() => fileRef.current?.click()} className="min-h-12 rounded-xl border-2 border-[#111113] bg-white px-4 text-base font-extrabold">Retake photo</button>
              {step === "final" ? (
                <label className="flex flex-col gap-2">
                  <span className="text-2xl font-extrabold">PRICE (AED)</span>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" className="min-h-16 rounded-xl border-2 border-[#111113] px-4 text-3xl font-extrabold" data-drive-price />
                </label>
              ) : null}
              <button type="button" disabled={preparing} onClick={send} className="min-h-16 rounded-2xl bg-[#111113] px-6 text-2xl font-extrabold text-white disabled:opacity-50" data-drive-send>
                {preparing ? "SAVING…" : "SEND"}
              </button>
            </>
          )}
        </>
      )}
      {error ? <p className="text-center text-base font-bold text-[#B3261E]">{error}</p> : null}
    </div>
  );
}
