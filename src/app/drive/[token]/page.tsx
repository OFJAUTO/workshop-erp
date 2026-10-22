import type { Metadata } from "next";
import { tripByToken, tripCar } from "@/lib/delivery";
import { priceHistoryOf, scheduleWords } from "@/lib/recovery";
import { DriveClient } from "./DriveClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "OFJ Automotive · Driver", description: "One button when the car is handed over.", robots: { index: false } };

/**
 * The driver's one-button page (no login, big text): DELIVERED (or LOADED): TAKE PHOTO, then the price, then SEND.
 * It shows nothing about prices on the job or invoices, and stops working after it is used.
 */
export default async function DrivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const trip = await tripByToken(token);
  if (!trip) {
    return <main className="flex min-h-screen items-center justify-center bg-white p-6"><p className="text-center text-2xl font-extrabold">This link is no longer valid.<br /><span className="text-base font-semibold text-[#5F6368]">Ask the workshop for a new one.</span></p></main>;
  }
  if (trip.delivered_at) {
    // A price changed by OFJ after the trip shows here too, with the reason (the same words as the WhatsApp).
    const last = priceHistoryOf(trip.price_history).at(-1) ?? null;
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6">
        <p className="text-center text-3xl font-extrabold">Done. Thank you!</p>
        {last ? (
          <p className="max-w-md rounded-2xl border-2 border-[#111113] p-4 text-center text-lg font-bold" data-drive-price-change>
            Price changed from <span className="line-through">AED {last.from.toLocaleString("en-GB")}</span> to AED {last.to.toLocaleString("en-GB")}
            {last.reason ? <span className="block text-base font-semibold text-[#5F6368]">{last.reason}</span> : null}
          </p>
        ) : null}
      </main>
    );
  }
  const car = await tripCar(trip);
  return (
    <main className="min-h-screen bg-white text-[#111113]">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <p className="text-2xl font-extrabold">{car.plate || "OFJ Automotive"}</p>
        {car.car ? <p className="text-lg font-bold">{car.car}</p> : null}
        <p className="text-base font-semibold text-[#5F6368]">{scheduleWords(trip.scheduled_date, trip.scheduled_slot)}{trip.location_details ? ` · ${trip.location_details}` : ""}</p>
      </div>
      <DriveClient token={token} kind={trip.kind} loadedAt={trip.loaded_at ?? null} />
    </main>
  );
}
