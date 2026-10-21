"use client";

import { Card, Button, SectionLabel } from "@/components/ui";
import { TripActions } from "@/components/TripActions";
import { carLoaded, markDriverSent } from "@/app/(app)/jobs/delivery-actions";

/**
 * Out for delivery on the gate-out page: the ONE trip component (TripActions) carries Send to driver,
 * Copy message, Copy link and Tell the customer; "Mark delivered" stays as the advisor's backup. The job
 * closes itself when the driver presses Delivered with the photo and his price.
 */
export function DeliveryPanel({ jobId, trip, driverText, customerText, customerPhone, shortLink = null, markDeliveredAction }: {
  jobId: string;
  trip: { driverName: string | null; driverPhone: string | null; truckPlate: string | null; sentAt: string | null; loadedAt: string | null; leftAt: string | null };
  driverText: string;
  customerText: string;
  customerPhone: string;
  shortLink?: string | null;
  markDeliveredAction: (formData: FormData) => void;
}) {
  const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "");
  return (
    <Card className="flex flex-col gap-3" data-delivery-panel>
      <SectionLabel>Out for delivery</SectionLabel>
      <p className="text-sm font-bold" data-delivery-status>
        {trip.loadedAt ? `On the way: left ${time(trip.loadedAt)}` : `Left the workshop ${time(trip.leftAt)}`}
        {trip.driverName ? ` · Driver: ${trip.driverName}` : ""}
        {trip.truckPlate ? ` · Truck ${trip.truckPlate}` : ""}
      </p>
      <p className="text-xs text-muted">The job closes itself when the driver presses Delivered, takes the photo and enters his price (it lands on the Recovery page and the job&apos;s recovery cost).</p>
      <TripActions
        kind="delivery"
        driverName={trip.driverName}
        driverPhone={trip.driverPhone}
        customerPhone={customerPhone}
        driverText={driverText}
        customerText={customerText}
        shortLink={shortLink}
        sentAt={trip.sentAt}
        loadedAt={trip.loadedAt}
        onMarkSent={markDriverSent.bind(null, jobId)}
        onCustomerSend={async (message) => {
          const fd = new FormData();
          fd.set("message", message);
          await carLoaded(jobId, fd);
        }}
      />
      <form action={markDeliveredAction} className="self-end">
        <Button type="submit" tone="ghost" size="md" data-mark-delivered>Mark delivered (no driver button)</Button>
      </form>
    </Card>
  );
}
