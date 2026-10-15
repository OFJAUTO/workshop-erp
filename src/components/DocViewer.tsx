"use client";

import { useEffect, useState } from "react";

/**
 * "View quotation": the PDF shown inside the link page, page by page as pictures, with pinch zoom (the page is not
 * locked against zooming) and Zoom buttons, a Back button that returns to the first page, and Download at the
 * bottom. Nothing opens in a new tab.
 */
export function DocViewer({ href, label, fileName }: { href: string; label: string; fileName: string }) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const src = `/api/pdf-pages?src=${encodeURIComponent(href)}`;

  useEffect(() => {
    if (!open || pages !== null) return;
    let gone = false;
    fetch(`${src}&info=1`)
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { pages?: number; error?: string };
        if (gone) return;
        if (!r.ok || !j.pages) setError(j.error ?? "The document could not be opened. Download it instead.");
        else setPages(j.pages);
      })
      .catch(() => { if (!gone) setError("The document could not be opened. Download it instead."); });
    return () => { gone = true; };
  }, [open, pages, src]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-16 w-full items-center justify-center rounded-lg bg-[#111113] px-4 text-lg font-extrabold text-white" data-doc-viewer-open>
        {label}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#E9E9EC]" role="dialog" aria-modal="true" aria-label={label} data-doc-viewer>
          <div className="flex items-center gap-2 border-b border-[#D4D4D8] bg-white px-3 py-2">
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-[#D4D4D8] px-4 text-sm font-bold" data-doc-back>← Back</button>
            <span className="flex-1 truncate text-sm font-bold">{fileName.replace(/\.pdf$/i, "")}</span>
            <button type="button" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))} aria-label="Zoom out" className="min-h-11 min-w-11 rounded-lg border border-[#D4D4D8] text-lg font-bold">−</button>
            <button type="button" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.2) * 10) / 10))} aria-label="Zoom in" className="min-h-11 min-w-11 rounded-lg border border-[#D4D4D8] text-lg font-bold">+</button>
          </div>
          <div className="flex-1 overflow-auto px-2 py-3" style={{ touchAction: "pinch-zoom pan-x pan-y" }}>
            {error ? <p className="mx-auto max-w-md rounded-lg bg-white p-4 text-sm font-semibold text-[#B42318]" data-doc-error>{error}</p> : null}
            {!error && pages === null ? <p className="py-10 text-center text-sm font-semibold text-[#5F6368]">Getting the document…</p> : null}
            {pages ? (
              <div className="mx-auto flex flex-col gap-3" style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom <= 1 ? 820 : undefined }}>
                {Array.from({ length: pages }, (_, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={`${src}&page=${i + 1}`} alt={`Page ${i + 1} of ${pages}`} className="w-full rounded-md bg-white shadow-sm" loading={i < 2 ? "eager" : "lazy"} data-doc-page={i + 1} />
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2 border-t border-[#D4D4D8] bg-white px-3 py-2">
            <a href={href} download={fileName} className="flex min-h-12 flex-1 items-center justify-center rounded-lg bg-[#111113] px-4 text-sm font-extrabold text-white" data-doc-download>Download PDF</a>
            <button type="button" onClick={() => setOpen(false)} className="min-h-12 rounded-lg border border-[#D4D4D8] px-4 text-sm font-bold">Back</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
