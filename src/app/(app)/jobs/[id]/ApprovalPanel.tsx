"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Button, Card, ChoiceButtons, Field, Input, SectionLabel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { ApprovalRequestRow } from "@/lib/types";
import { sendApproval } from "../actions";

export function ApprovalPanel({
  jobId,
  canSend,
  complete,
  latest,
  approvedAt,
  link,
  sentTo,
  customer,
  contacts,
}: {
  jobId: string;
  canSend: boolean;
  complete: boolean;
  latest: ApprovalRequestRow | null;
  approvedAt: string | null;
  link: string | null;
  sentTo: string | null;
  customer: { name: string; phone: string } | null;
  contacts: { id: string; name: string; phone: string }[];
}) {
  const [copied, setCopied] = useState(false);
  const options = [
    ...(customer ? [{ value: customer.phone, label: `${customer.name}`, hint: customer.phone }] : []),
    ...contacts.map((c) => ({ value: c.phone, label: c.name, hint: c.phone })),
  ];

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const waText = link ? `Please review and approve the job card for your car: ${link}` : "";
  const waHref = link ? `https://wa.me/${(sentTo ?? "").replace(/[^\d]/g, "")}?text=${encodeURIComponent(waText)}` : "#";

  return (
    <Card className="flex flex-col gap-4">
      <SectionLabel>Customer approval</SectionLabel>

      {approvedAt ? (
        <div className="flex flex-col gap-1">
          <Badge tone="green">Approved</Badge>
          <span className="text-sm">
            {latest?.approver_name ? `By ${latest.approver_name}` : "Approved"} · {formatDateTime(approvedAt)}
          </span>
          <span className="text-xs text-muted">Sent to {latest?.sent_to_name ? `${latest.sent_to_name} (${latest.sent_to_phone})` : latest?.sent_to_phone}</span>
        </div>
      ) : latest ? (
        <div className="flex flex-col gap-1">
          <Badge tone="amber">{latest.opened_at ? "Opened, not yet approved" : "Sent, not yet opened"}</Badge>
          <span className="text-xs text-muted">
            Sent {formatDateTime(latest.sent_at)} to {latest.sent_to_name ? `${latest.sent_to_name} (${latest.sent_to_phone})` : latest.sent_to_phone}
            {latest.opened_at ? ` · opened ${formatDateTime(latest.opened_at)}` : ""}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted">Not sent yet.</p>
      )}

      {link ? (
        <div className="flex flex-col gap-2 rounded-control border border-line p-3">
          <span className="text-sm font-bold">Send this link on WhatsApp</span>
          <textarea readOnly value={link} rows={2} className="w-full rounded-control border border-line-strong bg-canvas p-2 text-xs break-all" />
          <div className="flex flex-wrap gap-2">
            <a href={waHref} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center min-h-11 px-5 rounded-control bg-ink text-white text-sm font-bold">
              Open WhatsApp
            </a>
            <Button tone="secondary" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      ) : null}

      {canSend && !approvedAt ? (
        <ActionForm action={sendApproval.bind(null, jobId)} className="flex flex-col gap-3 border-t border-line pt-4">
          {(v) => (
            <>
              <span className="text-sm font-bold">{latest ? "Send a new link" : "Send the approval link"}</span>
              {options.length ? (
                <Field label="Send to">
                  <ChoiceButtons name="sent_to_phone" columns={2} defaultValue={v.sent_to_phone ?? options[0]?.value} options={options} />
                </Field>
              ) : (
                <Field label="Phone number">
                  <Input name="sent_to_phone" type="tel" defaultValue={v.sent_to_phone} required />
                </Field>
              )}
              <Field label="Name of the person approving" optional>
                <Input name="sent_to_name" defaultValue={v.sent_to_name ?? customer?.name ?? ""} />
              </Field>
              <SubmitButton size="md" tone="secondary">
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
