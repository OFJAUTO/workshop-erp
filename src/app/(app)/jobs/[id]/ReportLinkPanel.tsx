"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, SectionLabel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { createReportLink, markReportSent, type ReportLinkState } from "../report-actions";

export type ReportLinkRow = { id: string; token: string; status: "created" | "sent" | "opened"; sent_at: string | null; opened_at: string | null; created_at: string };

/**
 * "Send to customer": creates the link, shows a loading state while it works and an error if
 * anything fails, then refreshes the job card and scrolls to the panel with the WhatsApp message.
 */
export function SendReportButton({ jobId, label = "Send to customer", className = "", size = "md" }: { jobId: string; label?: string; className?: string; size?: "md" | "lg" }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ReportLinkState, FormData>(createReportLink.bind(null, jobId), {});
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      document.getElementById("report-link")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [state, router]);
  return (
    <form action={action} className={`flex flex-col gap-1 ${className}`}>
      <Button type="submit" size={size} disabled={pending} className="w-full">
        {pending ? "Creating the link…" : state.ok ? "Link created" : label}
      </Button>
      {state.error ? <span className="text-xs font-semibold text-red">{state.error}</span> : null}
    </form>
  );
}

/** Owner and advisors: the customer's link to the approved report, WhatsApp with the message ready, and its status. */
export function ReportLinkPanel({ jobId, link, url, message, phoneDigits, canSend }: { jobId: string; link: ReportLinkRow | null; url: string | null; message: string | null; phoneDigits: string; canSend: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [, start] = useTransition();
  const recordSent = (method: string) =>
    start(async () => {
      const res = await markReportSent(jobId, link!.id, method);
      if (res.error) setSendError(res.error);
      else router.refresh();
    });
  const status = link ? (link.status === "opened" ? { tone: "green" as const, text: `Opened by the customer ${formatDateTime(link.opened_at)}` } : link.status === "sent" ? { tone: "amber" as const, text: `Sent ${formatDateTime(link.sent_at)}, not yet opened` } : { tone: "neutral" as const, text: "Link created, not sent yet" }) : null;
  return (
    <div id="report-link">
      <Card className="flex flex-col gap-3">
        <SectionLabel>Inspection report to customer</SectionLabel>
        {status ? <Badge tone={status.tone}>{status.text}</Badge> : <p className="text-sm text-muted">Not sent yet.</p>}
        {!link && canSend ? <SendReportButton jobId={jobId} /> : null}
        {link && url && canSend ? (
          <div className="flex flex-col gap-2">
            <input readOnly value={url} className="min-h-11 w-full rounded-control border border-line bg-canvas px-3 text-xs" onFocus={(e) => e.currentTarget.select()} />
            {message ? <p className="rounded-control bg-chip px-3 py-2 text-xs whitespace-pre-wrap">{message}</p> : null}
            <div className="flex flex-wrap gap-2">
              {message && phoneDigits ? (
                <a
                  href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => recordSent("whatsapp")}
                  className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white"
                >
                  Open WhatsApp
                </a>
              ) : null}
              <Button
                type="button"
                tone="secondary"
                size="md"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    setSendError("Could not copy. Select the link above and copy it by hand.");
                  }
                  recordSent("copy");
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            {sendError ? <span className="text-xs font-semibold text-red">{sendError}</span> : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
