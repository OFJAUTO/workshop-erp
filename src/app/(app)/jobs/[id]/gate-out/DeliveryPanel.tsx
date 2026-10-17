"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, SectionLabel, Textarea } from "@/components/ui";
import { carLoaded, markDriverSent } from "@/app/(app)/jobs/delivery-actions";

/**
 * Out for delivery: only status and the three buttons. "Send to driver" opens WhatsApp with his one-button link;
 * "Car loaded: send 'on its way'" opens WhatsApp to the customer (template, editable for this one customer) and marks
 * On the way; the job closes itself when the driver presses Delivered. "Mark delivered" is the advisor's backup.
 */
export function DeliveryPanel({ jobId, trip, driverText, customerText, customerPhone, markDeliveredAction }: {
  jobId: string;
  trip: { driverName: string | null; driverPhone: string | null; truckPlate: string | null; sentAt: string | null; loadedAt: string | null; leftAt: string | null };
  driverText: string;
  customerText: string;
  customerPhone: string;
  markDeliveredAction: (formData: FormData) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loadOpen, setLoadOpen] = useState(false);
  const [message, setMessage] = useState(customerText);
  const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "");
  const driverDigits = (trip.driverPhone ?? "").replace(/[^\d]/g, "");
  const custDigits = customerPhone.replace(/[^\d]/g, "");

  return (
    <Card className="flex flex-col gap-3" data-delivery-panel>
      <SectionLabel>Out for delivery</SectionLabel>
      <p className="text-sm font-bold" data-delivery-status>
        {trip.loadedAt ? `On the way: left ${time(trip.loadedAt)}` : `Left the workshop ${time(trip.leftAt)}`}
        {trip.driverName ? ` · Driver: ${trip.driverName}` : ""}
        {trip.truckPlate ? ` · Truck ${trip.truckPlate}` : ""}
      </p>
      <p className="text-xs text-muted">The job closes itself when the driver presses Delivered, takes the photo and enters his price (it lands on the Recovery page and the job&apos;s recovery cost).</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="md"
          tone={trip.sentAt ? "secondary" : "primary"}
          onClick={() => start(async () => {
            await markDriverSent(jobId);
            window.open(driverDigits ? `https://wa.me/${driverDigits}?text=${encodeURIComponent(driverText)}` : `https://wa.me/?text=${encodeURIComponent(driverText)}`, "_blank", "noopener");
            router.refresh();
          })}
          data-send-driver
        >
          {trip.sentAt ? "Send to driver again" : "Send to driver"}
        </Button>
        {!trip.loadedAt ? (
          <Button type="button" size="md" onClick={() => setLoadOpen(true)} data-car-loaded>
            Car loaded: send &quot;on its way&quot;
          </Button>
        ) : null}
        <form action={markDeliveredAction} className="ml-auto">
          <Button type="submit" tone="ghost" size="md" data-mark-delivered>Mark delivered (no driver button)</Button>
        </form>
      </div>
      {loadOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-on-way-dialog>
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold">Send &quot;on its way&quot; to the customer</span>
            <p className="text-xs text-muted">The owner&apos;s wording from Settings, filled in. You can tweak it for this customer; the driver&apos;s name and mobile are allowed in this message only.</p>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} aria-label="Message to the customer" data-on-way-text />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="md"
                disabled={pending}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  fd.set("message", message);
                  await carLoaded(jobId, fd);
                  window.open(custDigits ? `https://wa.me/${custDigits}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
                  setLoadOpen(false);
                  router.refresh();
                })}
                data-on-way-send
              >
                Open WhatsApp and mark on its way
              </Button>
              <Button type="button" tone="ghost" size="md" onClick={() => setLoadOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
