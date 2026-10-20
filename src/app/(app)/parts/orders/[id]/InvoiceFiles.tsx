"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";

/**
 * The supplier invoice's files on the LPO page: every scan or photo as a thumbnail with an X to remove
 * it, and a button to add more (several files are fine - a photographed invoice page by page).
 */
export function InvoiceFiles({ jobId, poId, files, canEdit }: { jobId: string; poId: string; files: JobFile[]; canEdit: boolean }) {
  const [list, setList] = useState<JobFile[]>(files);
  return (
    <div className="flex flex-col gap-1" data-invoice-files>
      <span className="text-xs font-semibold text-muted">Invoice files{list.length ? ` (${list.length})` : ""}</span>
      <JobFileUpload
        jobId={jobId}
        kind="supplier_invoice"
        refId={poId}
        files={list}
        accept="pdf"
        label="Add invoice file"
        disabled={!canEdit}
        removable={canEdit}
        onAdded={(f) => setList((xs) => [...xs, f])}
        onRemoved={(f) => setList((xs) => xs.filter((x) => x.id !== f.id))}
      />
      {!list.length && !canEdit ? <p className="text-xs text-muted">No file yet.</p> : null}
    </div>
  );
}
