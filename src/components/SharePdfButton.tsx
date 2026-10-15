"use client";

import { useState } from "react";

/**
 * "Share PDF" next to every "Send on WhatsApp": fetches the document, hands the file to the phone's share sheet
 * (WhatsApp, email, ...) with a clean name such as "OFJ Quotation Q-00005.pdf". On a PC, where browsers cannot
 * share files, the PDF downloads and a hint says where to attach it. Every share is written on the job.
 */
export function SharePdfButton({ href, fileName, jobId = null, kind = "document", className = "", size = "md" }: { href: string; fileName: string; jobId?: string | null; kind?: string; className?: string; size?: "md" | "lg" }) {
  const [state, setState] = useState<"idle" | "busy" | "shared" | "downloaded" | "error">("idle");

  function log(how: "shared" | "downloaded") {
    if (!jobId) return;
    fetch("/api/share-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId, kind, fileName, how }) }).catch(() => null);
  }

  async function share() {
    setState("busy");
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`PDF ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      // The share sheet is for phones and tablets; a PC (where Windows offers a sheet of its own that rarely reaches WhatsApp) downloads the file instead.
      const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mobile|Tablet/i.test(navigator.userAgent));
      if (phone && typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: fileName.replace(/\.pdf$/i, "") });
        setState("shared");
        log("shared");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      setState("downloaded");
      log("downloaded");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setState("idle");
        return;
      }
      setState("error");
    }
  }

  const h = size === "lg" ? "min-h-14 text-base" : "min-h-11 text-sm";
  return (
    <div className={`flex flex-col gap-1 ${className}`} data-share-pdf>
      <button type="button" onClick={share} disabled={state === "busy"} className={`inline-flex w-full items-center justify-center rounded-control border border-line-strong bg-white px-4 font-bold ${h} disabled:opacity-60`}>
        {state === "busy" ? "Getting the PDF…" : state === "shared" ? "Shared" : state === "downloaded" ? "Downloaded" : "Share PDF"}
      </button>
      {state === "downloaded" ? <span className="text-xs text-muted" data-share-hint>Saved to your Downloads as “{fileName}”. In WhatsApp Web tap the paper clip and attach it.</span> : null}
      {state === "error" ? <span className="text-xs font-semibold text-red">Could not get the PDF. Try again.</span> : null}
    </div>
  );
}
