"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button, Field, Input } from "@/components/ui";
import { formatDayTime } from "@/lib/format";
import type { ApprovalRequestRow } from "@/lib/types";
import { markApprovalSent, sendApproval } from "../actions";
import { createReportLink, markReportSent } from "../report-actions";

/* The send buttons on the stage cards. Each opens the centre window with the message, and the
   status (created, sent, opened, approved) shows on the card itself, where the click happened. */

const TONE_CLASS = { green: "text-green", amber: "text-amber", neutral: "text-muted", red: "text-red" } as const;

function StatusLine({ tone, text, onAgain }: { tone: keyof typeof TONE_CLASS; text: string; onAgain?: () => void }) {
  return (
    <span className={`text-xs font-semibold ${TONE_CLASS[tone]}`}>
      {text}
      {onAgain ? (
        <>
          {" · "}
          <button type="button" onClick={onAgain} className="underline underline-offset-4 font-bold text-ink">
            Send again
          </button>
        </>
      ) : null}
    </span>
  );
}

export type ReportLinkRow = { id: string; token: string; status: "created" | "sent" | "opened"; sent_at: string | null; opened_at: string | null; created_at: string };

/** Inspection report card: "Send to customer" creates the link and opens the window; afterwards the status and "Send again". */
export function ReportSendControl({ jobId, link, messageTemplate, siteUrl, phoneDigits, canSend }: { jobId: string; link: ReportLinkRow | null; messageTemplate: string; siteUrl: string; phoneDigits: string; canSend: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState<{ id: string; token: string } | null>(link ? { id: link.id, token: link.token } : null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const message = current ? messageTemplate.replaceAll("[link]", `${siteUrl}/report/${current.token}`) : null;

  function create() {
    setError(null);
    start(async () => {
      const res = await createReportLink(jobId, {});
      if (res.error || !res.token || !res.id) {
        setError(res.error ?? "Could not create the link.");
        return;
      }
      setCurrent({ id: res.id, token: res.token });
      setOpen(true);
      router.refresh();
    });
  }
  const sent = (method: "whatsapp" | "copy") => {
    if (!current) return;
    start(async () => {
      const res = await markReportSent(jobId, current.id, method);
      if (res.error) setError(res.error);
      router.refresh();
    });
  };

  const status = link ? (link.status === "opened" ? { tone: "green" as const, text: `Opened by the customer ${formatDayTime(link.opened_at)}` } : link.status === "sent" ? { tone: "amber" as const, text: `Sent ${formatDayTime(link.sent_at)}` } : { tone: "neutral" as const, text: "Link created, not sent yet" }) : null;

  return (
    <div className="flex flex-col gap-1.5">
      {status ? <StatusLine tone={status.tone} text={status.text} onAgain={canSend ? () => setOpen(true) : undefined} /> : null}
      {!link && canSend ? (
        <Button type="button" size="md" disabled={pending} onClick={create}>
          {pending ? "Creating the link…" : "Send to customer"}
        </Button>
      ) : null}
      {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
      {open ? <SendLinkDialog title="Inspection report to the customer" message={message} phoneDigits={phoneDigits} onSent={sent} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

type Recipient = { name: string; phone: string };

/** Job card approval: "Create the approval link" asks who it goes to, creates the link and opens the window; afterwards the status and "Send again". */
export function ApprovalSendControl({
  jobId,
  canSend,
  complete,
  latest,
  approvedAt,
  siteUrl,
  messageTemplate,
  customer,
  contacts,
  hidePhone = false,
}: {
  jobId: string;
  canSend: boolean;
  complete: boolean;
  latest: ApprovalRequestRow | null;
  approvedAt: string | null;
  siteUrl: string;
  /** The approval message with [name] and [link] still to fill. */
  messageTemplate: string;
  customer: Recipient | null;
  contacts: Recipient[];
  hidePhone?: boolean;
}) {
  const router = useRouter();
  const options: Recipient[] = [...(customer ? [customer] : []), ...contacts];
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"who" | "send">("send");
  const [phone, setPhone] = useState(latest?.sent_to_phone ?? options[0]?.phone ?? "");
  const [name, setName] = useState(latest?.sent_to_name ?? customer?.name ?? "");
  const [created, setCreated] = useState<{ id: string; link: string } | null>(latest && !latest.approved_at ? { id: latest.id, link: `${siteUrl}/approve/${latest.token}` } : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const approved = !!(approvedAt || latest?.approved_at);
  const message = created ? messageTemplate.replaceAll("[name]", name || "Customer").replaceAll("[link]", created.link) : null;

  function startNew() {
    setError(null);
    setStep("who");
    setOpen(true);
  }
  function createLink() {
    setError(null);
    const fd = new FormData();
    fd.set("sent_to_phone", phone);
    fd.set("sent_to_name", name);
    start(async () => {
      const res = await sendApproval(jobId, {}, fd);
      if (res.error || !res.values?.link || !res.values?.req) {
        setError(res.error ?? "Could not create the link.");
        return;
      }
      setCreated({ id: res.values.req, link: res.values.link });
      setStep("send");
      router.refresh();
    });
  }
  const sent = (method: "whatsapp" | "copy") => {
    if (!created) return;
    start(async () => {
      await markApprovalSent(jobId, created.id, method);
      router.refresh();
    });
  };

  const to = latest ? (hidePhone ? (latest.sent_to_name ?? "the customer") : latest.sent_to_name ? `${latest.sent_to_name} (${latest.sent_to_phone})` : latest.sent_to_phone) : "";
  const status = approved
    ? { tone: "green" as const, text: `Approved${latest?.approver_name ? ` by ${latest.approver_name}` : ""} ${formatDayTime(latest?.approved_at ?? approvedAt)}` }
    : latest?.opened_at
      ? { tone: "amber" as const, text: `Opened by the customer ${formatDayTime(latest.opened_at)}` }
      : latest?.sent_at
        ? { tone: "amber" as const, text: `Sent ${formatDayTime(latest.sent_at)} to ${to}` }
        : latest
          ? { tone: "neutral" as const, text: `Link created ${formatDayTime(latest.created_at)}, not sent yet` }
          : null;

  return (
    <div className="flex flex-col gap-1.5">
      {status ? <StatusLine tone={status.tone} text={status.text} onAgain={canSend && !approved ? () => { setStep(created ? "send" : "who"); setOpen(true); } : undefined} /> : null}
      {!latest && canSend && !approved ? (
        <>
          <Button type="button" size="md" disabled={!complete || pending} onClick={startNew}>
            Create the approval link
          </Button>
          {!complete ? <span className="text-xs font-semibold text-amber">Blocked until the gate-in media is complete.</span> : null}
        </>
      ) : null}
      {canSend && latest && !approved ? (
        <button type="button" onClick={startNew} className="self-start text-xs font-semibold text-muted underline underline-offset-4">
          Create a new link for someone else
        </button>
      ) : null}
      {error && !open ? <span className="text-xs font-semibold text-red">{error}</span> : null}
      {open ? (
        <SendLinkDialog title="Job card approval" message={step === "send" ? message : null} phoneDigits={(created ? phone : "").replace(/[^\d]/g, "")} onSent={sent} onClose={() => setOpen(false)}>
          {step === "who" ? (
            <div className="flex flex-col gap-3">
              {options.length ? (
                <Field label="Send to">
                  <div className="flex flex-col gap-2">
                    {options.map((o, i) => (
                      <label key={o.phone + i} className="flex items-center gap-3 rounded-control border border-line-strong px-3.5 py-2.5 cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-chip">
                        <input type="radio" name="recipient" value={o.phone} checked={phone === o.phone} onChange={() => { setPhone(o.phone); setName(o.name); }} className="h-4 w-4 accent-ink" />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold">{o.name}</span>
                          {!hidePhone ? <span className="text-xs text-muted">{o.phone}</span> : null}
                        </span>
                      </label>
                    ))}
                  </div>
                </Field>
              ) : (
                <Field label="Phone number">
                  <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                </Field>
              )}
              <Field label="Name of the person approving" optional>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
              <Button type="button" size="lg" className="w-full" disabled={pending} onClick={createLink}>
                {pending ? "Creating the link…" : "Create link"}
              </Button>
            </div>
          ) : null}
        </SendLinkDialog>
      ) : null}
    </div>
  );
}
