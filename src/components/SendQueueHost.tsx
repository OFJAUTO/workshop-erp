"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { forgetGrants, listRecords, onSendEvent, removeQueued, retryNow, startSendRunner, wakeRunner, type SendRecord } from "@/lib/send-queue";

/** Pages a customer or a driver opens: no staff queue there (the driver page keeps its own). */
const NOT_STAFF = ["/approve", "/report", "/quote", "/invoice", "/proforma", "/warranty", "/handover", "/progress", "/p/", "/lpo", "/terms", "/drive", "/m/", "/d/", "/i/", "/r/", "/q/", "/s/"];
const isStaffPage = (path: string) => !NOT_STAFF.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));

const KIND_WORDS: Record<string, string> = {
  payment_proof: "Payment proof",
  supplier_invoice: "Supplier invoice",
  odometer_out: "Gate-out km photo",
  gate_out_photo: "Gate-out photo",
  handover_photo: "Handover photo",
  delivery_photo: "Delivery photo",
  bodyshop_photo: "Bodyshop photo",
  bodyshop_removed: "Removed part photo",
  qc_postscan: "QC post-scan",
  additional_work: "Additional work photo",
  work_photo: "Work photo",
};

function whatWords(r: SendRecord): string {
  const kind = String(r.fields.kind ?? "");
  const media = r.contentType.startsWith("video/") ? "Video" : r.contentType === "application/pdf" ? "PDF" : "Photo";
  if (r.target === "gate_in") return `Gate-in ${media.toLowerCase()}`;
  if (r.target === "inspection") return `Inspection ${media.toLowerCase()}`;
  if (r.target === "job_file") return KIND_WORDS[kind] ?? media;
  if (r.target === "supplier_proof") return "Supplier payment proof";
  if (r.target === "commission_proof") return "Commission proof";
  if (r.target === "credit_note") return "Credit note scan";
  if (r.target === "loose_item") return "Loose item photo";
  return media;
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Runs THE send queue on every staff page (31 October 2026) and shows a small "n files waiting" pill only while files are
 * on this device, so a photo or video picked anywhere keeps going after the person moves on, and nobody wonders where it
 * went. Tapping it lists each file with what is happening, Try again now and Remove.
 */
export function SendQueueHost() {
  const path = usePathname() ?? "/";
  const staffPage = isStaffPage(path);
  const [rows, setRows] = useState<SendRecord[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);

  // Read through a ref: the runner starts once for the page's life, never stopped and restarted by a page change.
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
    // A sign-in page: whoever comes next gets their own sending permits, never the last person's.
    if (/^\/(tablet|login|k)(\/|$)/.test(path)) forgetGrants();
  }, [path]);

  useEffect(() => {
    if (!staffPage) return;
    const path = pathRef.current;
    let used = false;
    try {
      used = localStorage.getItem("erp-send-queue-used") === "1";
    } catch {
      used = true;
    }
    // A device that never queued anything has nothing to send: the runner starts with the first file instead.
    const startNow = used || path.startsWith("/u/") || path.startsWith("/tablet") || path.startsWith("/gate-in") || path.startsWith("/my-jobs") || path.startsWith("/jobs");
    let stop: (() => void) | null = startNow ? startSendRunner() : null;
    if (stop) wakeRunner();
    const onFirst = () => {
      if (!stop) stop = startSendRunner();
    };
    window.addEventListener("erp:send-queued", onFirst);
    return () => {
      window.removeEventListener("erp:send-queued", onFirst);
      stop?.();
    };
  }, [staffPage]);

  useEffect(() => {
    if (!staffPage) return;
    let live = true;
    const read = () => void listRecords().then((r) => live && setRows(r));
    read();
    const off = onSendEvent((e) => {
      if (e.type === "sending") setProgress((p) => ({ ...p, [e.id]: e.progress }));
      else {
        // Not on its way any more (waiting, stopped, sent, removed): its old percentage goes.
        setProgress((p) => {
          if (!(e.id in p)) return p;
          const next = { ...p };
          delete next[e.id];
          return next;
        });
        read();
      }
    });
    const t = setInterval(read, 30_000);
    return () => {
      live = false;
      off();
      clearInterval(t);
    };
  }, [staffPage]);

  if (!staffPage || !rows.length) return null;
  const stopped = rows.filter((r) => r.permanent).length;
  const sending = rows.filter((r) => !r.permanent && progress[r.id] !== undefined && (progress[r.id] ?? 0) > 0).length;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const label = stopped
    ? `${stopped} file${stopped === 1 ? "" : "s"} could not be sent`
    : offline
      ? `${rows.length} file${rows.length === 1 ? "" : "s"} saved on this device – no signal`
      : sending
        ? `Sending ${rows.length} file${rows.length === 1 ? "" : "s"}…`
        : `${rows.length} file${rows.length === 1 ? "" : "s"} waiting to send`;

  return (
    // Above the fixed bottom bars on phones and tablets (they span the whole width there); beside them on a computer.
    <div className="fixed bottom-24 left-3 nav:bottom-3 z-[60] max-w-[calc(100vw-1.5rem)] print:hidden" data-send-queue>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold shadow-lg ${stopped ? "bg-red text-white" : "bg-ink text-white"}`}
        aria-expanded={open}
        data-send-queue-pill
        data-send-queue-count={rows.length}
      >
        <span aria-hidden>↑</span>
        <span>{label}</span>
      </button>
      {open ? (
        <div className="mt-2 w-[min(26rem,calc(100vw-1.5rem))] max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-white p-3 shadow-xl flex flex-col gap-2" data-send-queue-panel>
          <p className="text-xs text-muted">Files stay on this device until OFJ&apos;s server has them. They send by themselves when the signal is back – you can close this.</p>
          {rows.map((r) => (
            <div key={r.id} className="flex flex-col gap-1 rounded-control border border-line p-2" data-send-queue-row={r.id} data-send-queue-state={r.permanent ? "stopped" : r.attempts ? "waiting" : "queued"}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">{whatWords(r)}</span>
                <span className="text-xs text-muted">{mb(r.size)}</span>
              </div>
              <span className={`text-xs ${r.permanent ? "font-semibold text-red" : "text-muted"}`}>
                {r.permanent ? r.lastError ?? "Could not be sent." : progress[r.id] ? `Sending… ${Math.round((progress[r.id] ?? 0) * 100)}%` : r.lastError ?? "Waiting to send"}
                {r.staffName ? ` · taken by ${r.staffName}` : ""}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => void retryNow(r.id)} className="min-h-10 rounded-control border border-line-strong px-3 text-xs font-bold" data-send-queue-retry>
                  Try again now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Remove this file? It will not be sent.")) void removeQueued(r.id).then(() => setRows((x) => x.filter((y) => y.id !== r.id)));
                  }}
                  className="min-h-10 rounded-control border border-line px-3 text-xs font-semibold text-muted"
                  data-send-queue-remove
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
