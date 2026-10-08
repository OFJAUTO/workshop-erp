"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Full-screen thank-you after the technician submits a report, then back to the list. */
export function SubmittedOverlay({ jobNumber }: { jobNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    router.replace("/my-jobs");
  };
  useEffect(() => {
    const t = setTimeout(close, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-ink text-white flex flex-col items-center justify-center gap-6 p-8 text-center">
      <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-green text-4xl font-bold">✓</span>
      <h1 className="text-3xl font-extrabold">Thank you.</h1>
      <p className="text-xl font-semibold">Inspection submitted{jobNumber ? ` for ${jobNumber}` : ""}.</p>
      <p className="text-lg text-white/80">Waiting for the workshop manager.</p>
      <button type="button" onClick={close} className="mt-4 min-h-14 rounded-control bg-white px-8 text-base font-bold text-ink">
        Back to my jobs
      </button>
    </div>
  );
}
