"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { nothingToReceiveAction } from "./loose-flow-actions";

/** Items received: photos of what came in, or "Nothing to receive" for a parts sale. */
export function LooseReceive({ jobId, canAct, files }: { jobId: string; canAct: boolean; files: JobFile[] }) {
  const router = useRouter();
  const [list, setList] = useState(files);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canAct) return <p className="text-sm text-muted">Waiting for the items received (photos, or &quot;nothing to receive&quot;).</p>;
  return (
    <div className="flex flex-col gap-2" data-loose-receive>
      <p className="text-sm font-semibold">Items received: take photos of what came in, or tap Nothing to receive for a parts sale.</p>
      <div className="flex flex-wrap items-start gap-3">
        <JobFileUpload jobId={jobId} kind="work_photo" caption="Items received" files={list} label="Photo of the items" compact onAdded={(f) => { setList((xs) => [...xs, f]); router.refresh(); }} />
        <Button type="button" tone="secondary" disabled={pending} onClick={() => start(async () => { const r = await nothingToReceiveAction(jobId); if (r.error) setError(r.error); else router.refresh(); })} data-loose-nothing>Nothing to receive</Button>
      </div>
      {error ? <p className="rounded-control bg-red-soft px-3 py-2 text-sm font-semibold text-red">{error}</p> : null}
    </div>
  );
}
