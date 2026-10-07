"use client";

import { useState, useTransition } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Button, Card, Field, Input, SectionLabel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { ApprovalRequestRow } from "@/lib/types";
import { markApprovalSent, sendApproval } from "../actions";

type Contact = { value: string; label: string; hint: string };

function statusOf(r: ApprovalRequestRow | null, approvedAt: string | null) {
  if (approvedAt || r?.approved_at) return { tone: "green" as const, text: "Approved" };
  if (!r) return null;
  if (r.opened_at) return { tone: "amber" as const, text: "Opened by customer, not yet approved" };
  if (r.sent_at) return { tone: "amber" as const, text: "Sent, not yet opened" };
  return { tone: "neutral" as const, text: "Link created, not sent yet" };
}

export function ApprovalPanel({
  jobId,
  canSend,
  complete,
  latest,
  approvedAt,
  link,
  activeRequestId,
  customer,
  contacts,
  messageTemplate,
}: {
  jobId: string;
  canSend: boolean;
  complete: boolean;
  latest: ApprovalRequestRow | null;
  approvedAt: string | null;
  /** The link to send (built from the latest request). */
  link: string | null;
  activeRequestId: string | null;
  customer: { name: string; phone: string } | null;
  contacts: { id: string; name: string; phone: string }[];
  /** Ready-made WhatsApp message with the link already filled in. */
  messageTemplate: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const options: Contact[] = [
    ...(customer ? [{ value: customer.phone, label: customer.name, hint: customer.phone }] : []),
    ...contacts.map((c) => ({ value: c.phone, label: c.name, hint: c.phone })),
  ];
  const status = statusOf(latest, approvedAt);
  const showSendBox = !!link && !approvedAt && !latest?.approved_at;

  function recordSent(method: "whatsapp" | "copy") {
    if (!activeRequestId) return;
    startTransition(() => {
      void markApprovalSent(jobId, activeRequestId, method);
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(messageTemplate ?? link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
    recordSent("copy");
  }

  const waHref = link
    ? `https://wa.me/${(latest?.sent_to_phone ?? "").replace(/[^\d]/g, "")}?text=${encodeURIComponent(messageTemplate ?? link)}`
    : "#";

  return (
    <Card className="flex flex-col gap-4">
      <SectionLabel>Customer approval</SectionLabel>

      {status ? (
        <div className="flex flex-col gap-1">
          <Badge tone={status.tone}>{status.text}</Badge>
          <span className="text-xs text-muted">
            {latest?.approved_at
              ? `By ${latest.approver_name} · ${formatDateTime(latest.approved_at)}`
              : latest?.opened_at
                ? `Opened ${formatDateTime(latest.opened_at)}`
                : latest?.sent_at
                  ? `Sent ${formatDateTime(latest.sent_at)}`
                  : latest
                    ? `Created ${formatDateTime(latest.created_at)}`
                    : ""}
            {latest ? ` · to ${latest.sent_to_name ? `${latest.sent_to_name} (${latest.sent_to_phone})` : latest.sent_to_phone}` : ""}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted">Not sent yet.</p>
      )}

      {showSendBox ? (
        <div className="flex flex-col gap-3 rounded-control border border-line p-3">
          <span className="text-sm font-bold">Send the link to the customer</span>
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            onClick={() => recordSent("whatsapp")}
            className="inline-flex w-full items-center justify-center min-h-14 rounded-control bg-ink text-white text-base font-bold"
          >
            Open WhatsApp
          </a>
          <Button tone="secondary" onClick={copy} className="w-full">
            {copied ? "Copied message and link" : "Copy message and link"}
          </Button>
          <textarea readOnly value={messageTemplate ?? link ?? ""} rows={4} className="w-full rounded-control border border-line bg-canvas p-2 text-xs" />
        </div>
      ) : null}

      {canSend && !approvedAt && !latest?.approved_at && !showSendBox ? (
        <ActionForm action={sendApproval.bind(null, jobId)} className="flex flex-col gap-3 border-t border-line pt-4">
          {(v) => (
            <>
              <span className="text-sm font-bold">{latest ? "Create a new link" : "Create the approval link"}</span>
              {options.length ? (
                <Field label="Send to">
                  <div className="flex flex-col gap-2">
                    {options.map((o, i) => (
                      <label key={o.value + i} className="flex items-center gap-3 rounded-control border border-line-strong px-3.5 py-2.5 cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-chip">
                        <input type="radio" name="sent_to_phone" value={o.value} defaultChecked={(v.sent_to_phone ?? options[0]?.value) === o.value} className="h-4 w-4 accent-ink" />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold">{o.label}</span>
                          <span className="text-xs text-muted">{o.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </Field>
              ) : (
                <Field label="Phone number">
                  <Input name="sent_to_phone" type="tel" defaultValue={v.sent_to_phone} required />
                </Field>
              )}
              <Field label="Name of the person approving" optional>
                <Input name="sent_to_name" defaultValue={v.sent_to_name ?? customer?.name ?? ""} />
              </Field>
              <SubmitButton size="lg" className="w-full">
                Create link
              </SubmitButton>
              {!complete ? <p className="text-xs text-amber font-semibold">Blocked until the gate-in media is complete.</p> : null}
            </>
          )}
        </ActionForm>
      ) : null}
    </Card>
  );
}
