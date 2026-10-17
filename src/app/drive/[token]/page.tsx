import type { Metadata } from "next";
import { tripByToken, tripCar } from "@/lib/delivery";
import { scheduleWords } from "@/lib/recovery";
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
    return <main className="flex min-h-screen items-center justify-center bg-white p-6"><p className="text-center text-3xl font-extrabold">Done. Thank you!</p></main>;
  }
  const car = await tripCar(trip);
  return (
    <main className="min-h-screen bg-white text-[#111113]">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <p className="text-2xl font-extrabold">{car.plate || "OFJ Automotive"}</p>
        {car.car ? <p className="text-lg font-bold">{car.car}</p> : null}
        <p className="text-base font-semibold text-[#5F6368]">{scheduleWords(trip.scheduled_date, trip.scheduled_slot)}{trip.location_details ? ` · ${trip.location_details}` : ""}</p>
      </div>
      <DriveClient token={token} kind={trip.kind} />
    </main>
  );
}
