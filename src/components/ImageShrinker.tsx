"use client";

import { useEffect } from "react";

/** Above this a photo is redrawn before its form is sent (Vercel refuses requests above 4.5 MB; forms allow 4 MB). */
const SHRINK_ABOVE = 2.5 * 1024 * 1024;
const MAX_SIDE = 2560;

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size <= SHRINK_ABOVE) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    for (const quality of [0.85, 0.72, 0.6]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      if (blob && (blob.size <= SHRINK_ABOVE || quality === 0.6)) return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
    }
  } catch {
    // A picture the browser cannot read is sent as it is (the server's own check answers in words).
  }
  return file;
}

/**
 * ONE guard for every form that sends a photo through the server (30 October 2026, night batch section 10): a
 * full-size phone photo (4-12 MB) is redrawn in the browser to at most 2,560 px and about 2.5 MB before the form goes,
 * so no upload ever meets Vercel's 4.5 MB limit ("413", which the page could not even read). It looks only at NAMED
 * file inputs inside a form - the ones a form submits; the direct-to-storage uploaders (gate-in media, inspection media,
 * job files) have no name and are left alone. While a photo is being redrawn its form waits, then sends itself.
 * Opt out with data-no-shrink.
 */
export function ImageShrinker() {
  useEffect(() => {
    const busy = new WeakMap<HTMLFormElement, Promise<void>>();
    const onChange = (e: Event) => {
      const input = e.target as HTMLInputElement | null;
      if (!input || input.tagName !== "INPUT" || input.type !== "file" || !input.name || !input.form || input.hasAttribute("data-no-shrink")) return;
      const files = Array.from(input.files ?? []);
      if (!files.some((f) => f.type.startsWith("image/") && f.size > SHRINK_ABOVE)) return;
      const form = input.form;
      input.setAttribute("data-shrinking", "1");
      const job = (async () => {
        const out = await Promise.all(files.map(shrink));
        try {
          const dt = new DataTransfer();
          out.forEach((f) => dt.items.add(f));
          input.files = dt.files;
        } catch {
          // Very old browsers cannot replace the files: the original goes, as before.
        }
        input.removeAttribute("data-shrinking");
      })();
      busy.set(form, job);
    };
    // A form sent while its photo is still being redrawn waits for it, then sends itself once.
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || !form.querySelector("input[type=file][data-shrinking]")) return;
      const job = busy.get(form);
      if (!job) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const submitter = e.submitter as HTMLElement | null;
      // FormGuard locked the form for this first press; the real send happens now, so the lock is lifted for it.
      void job.then(() => { delete form.dataset.busyUntil; form.requestSubmit(submitter && "form" in submitter ? (submitter as HTMLButtonElement) : undefined); });
    };
    document.addEventListener("change", onChange, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);
  return null;
}
