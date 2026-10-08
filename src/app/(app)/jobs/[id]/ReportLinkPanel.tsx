"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, SectionLabel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { createReportLink, markReportSent } from "../report-actions";

export type ReportLinkRow = { id: string; token: string; status: "created" | "sent" | "opened"; sent_at: string | null; opened_at: string | null; created_at: string };

/** Owner and advisors: create the customer's link to the approved report, open WhatsApp with the message ready, record that it was sent. */
export function ReportLinkPanel({ jobId, link, url, message, phoneDigits, canSend }: { jobId: string; link: ReportLinkRow | null; url: string | null; message: string | null; phoneDigits: string; canSend: boolean }) {
  const [copied, setCopied] = useState(false);
  const [, start] = useTransition();
  const status = link ? (link.status === "opened" ? { tone: "green" as const, text: `Opened by the customer ${formatDateTime(link.opened_at)}` } : link.status === "sent" ? { tone: "amber" as const, text: `Sent ${formatDateTime(link.sent_at)}, not yet opened` } : { tone: "neutral" as const, text: "Link created, not sent yet" }) : null;
  return (
    <div id="report-link">
    <Card className="flex flex-col gap-3">
      <SectionLabel>Inspection report to customer</SectionLabel>
      {status ? <Badge tone={status.tone}>{status.text}</Badge> : <p className="text-sm text-muted">Not sent yet.</p>}
      {!link && canSend ? (
        <form action={() => start(() => createReportLink(jobId))}>
          <Button type="submit" size="md" className="w-full">
            Send to customer
          </Button>
        </form>
      ) : null}
      {link && url && canSend ? (
        <div className="flex flex-col gap-2">
          <input readOnly value={url} className="min-h-11 w-full rounded-control border border-line bg-canvas px-3 text-xs" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            {message && phoneDigits ? (
              <a
                href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => start(() => markReportSent(jobId, link.id, "whatsapp"))}
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
                  start(() => markReportSent(jobId, link.id, "copy"));
                } catch {}
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
    </div>
  );
}
