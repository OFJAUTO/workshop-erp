"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/ui";
import { CopyText } from "@/components/CopyText";

/**
 * THE one trip component (section 7, 21 October 2026): pick-ups, deliveries, external trucks and the
 * package's auto-created trips all use the same row of actions - [Send to driver] (WhatsApp with the
 * one-button link), [Copy message], [Copy link], [Tell the customer] (editable "on its way", no links) -
 * and the same live status words. Advisors see these actions and never a price.
 */
export function TripActions({ kind, driverName, driverPhone, customerPhone = null, driverText, customerText = null, shortLink = null, sentAt, loadedAt = null, deliveredAt = null, onMarkSent, onCustomerSend }: {
  kind: "pickup" | "delivery";
  driverName: string | null;
  driverPhone: string | null;
  customerPhone?: string | null;
  driverText: string;
  customerText?: string | null;
  /** The short driver link (erp.ofjauto.com/d/xxxx) for [Copy link]. */
  shortLink?: string | null;
  sentAt: string | null;
  loadedAt?: string | null;
  deliveredAt?: string | null;
  /** Stamps "sent to the driver" (a bound server action). */
  onMarkSent?: () => Promise<unknown>;
  /** Deliveries: "Car loaded" marks on-its-way too; pick-ups just open WhatsApp. */
  onCustomerSend?: (message: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tellOpen, setTellOpen] = useState(false);
  const [message, setMessage] = useState(customerText ?? "");
  const time = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "");
  const driverDigits = (driverPhone ?? "").replace(/[^\d]/g, "");
  const custDigits = (customerPhone ?? "").replace(/[^\d]/g, "");
  const status = deliveredAt ? `Delivered ✓ ${time(deliveredAt)}` : loadedAt ? `${kind === "pickup" ? "Loaded, on the way to OFJ" : "On the way"} · ${time(loadedAt)}` : sentAt ? `Sent to ${driverName ?? "the driver"} · ${time(sentAt)}` : "Booked";

  return (
    <div className="flex flex-col gap-2" data-trip-actions data-trip-kind={kind}>
      <span className={`text-[13px] font-bold ${deliveredAt ? "text-green" : loadedAt || sentAt ? "" : "text-muted"}`} data-trip-state>{status}</span>
      {!deliveredAt ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="md" tone={sentAt ? "secondary" : "primary"} disabled={pending}
            onClick={() => start(async () => {
              try { await onMarkSent?.(); } catch { /* the WhatsApp window still opens */ }
              window.open(driverDigits ? `https://wa.me/${driverDigits}?text=${encodeURIComponent(driverText)}` : `https://wa.me/?text=${encodeURIComponent(driverText)}`, "_blank", "noopener");
              router.refresh();
            })} data-send-driver>
            {sentAt ? "Send to driver again" : `Send to ${driverName ?? "the driver"}`}
          </Button>
          <CopyText text={driverText} label="Copy message" />
          {shortLink ? <CopyText text={shortLink} label="Copy link" /> : null}
          {customerText ? (
            <Button type="button" tone="secondary" size="md" onClick={() => { setMessage(customerText); setTellOpen(true); }} data-tell-customer>Tell the customer</Button>
          ) : null}
        </div>
      ) : null}
      {tellOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-on-way-dialog>
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold">Tell the customer</span>
            <p className="text-xs text-muted">The wording from Settings, filled in: driver&apos;s name, mobile and truck plate - no links. Tweak it for this customer if you like.</p>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} aria-label="Message to the customer" data-on-way-text />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" disabled={pending}
                onClick={() => start(async () => {
                  try { await onCustomerSend?.(message); } catch { /* the WhatsApp window still opens */ }
                  window.open(custDigits ? `https://wa.me/${custDigits}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
                  setTellOpen(false);
                  router.refresh();
                })} data-on-way-send>
                Open WhatsApp
              </Button>
              <CopyText text={message} />
              <Button type="button" tone="ghost" size="md" onClick={() => setTellOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
