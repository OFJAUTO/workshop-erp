import type { Metadata } from "next";
import { tripByToken, tripCar, tripContact } from "@/lib/delivery";
import { companyFromSettings } from "@/lib/company";
import { formatPhone } from "@/lib/messages";
import { getSettings } from "@/lib/settings";
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
  const [car, contact, settings] = await Promise.all([tripCar(trip), tripContact(trip), getSettings()]);
  const officePhone = companyFromSettings(settings).phone || null;
  const digits = (p: string) => p.replace(/[^\d]/g, "");
  return (
    <main className="min-h-screen bg-white text-[#111113]">
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-5 pt-6">
        <div>
          <p className="text-2xl font-extrabold">{car.plate || "OFJ Automotive"}</p>
          {car.car ? <p className="text-lg font-bold">{car.car}</p> : null}
          <p className="text-base font-semibold text-[#5F6368]">{scheduleWords(trip.scheduled_date, trip.scheduled_slot)}</p>
        </div>
        {/* 30 October 2026: the driver calls the customer - for HIS OWN open trip only, never after it is done. */}
        {contact && (contact.name || contact.phone || contact.address || contact.mapUrl) ? (
          <div className="flex flex-col gap-2 rounded-2xl border-2 border-[#111113] p-4" data-drive-contact>
            {contact.name ? <p className="text-xl font-extrabold uppercase" data-drive-customer>{contact.name}</p> : null}
            {contact.phone ? (
              <>
                <p className="text-base font-semibold text-[#5F6368]">{formatPhone(contact.phone)}</p>
                <div className="grid grid-cols-2 gap-2">
                  <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="flex min-h-14 items-center justify-center rounded-xl bg-[#111113] px-3 text-lg font-extrabold text-white" data-drive-call>Call</a>
                  <a href={`https://wa.me/${digits(contact.phone)}`} target="_blank" rel="noreferrer" className="flex min-h-14 items-center justify-center rounded-xl bg-[#1b6b2f] px-3 text-lg font-extrabold text-white" data-drive-whatsapp>WhatsApp</a>
                </div>
              </>
            ) : null}
            {contact.other ? (
              <div className="flex flex-col gap-2 border-t border-[#D4D4D8] pt-2" data-drive-other-contact>
                <p className="text-base font-extrabold">Pick-up contact{contact.other.name ? `: ${contact.other.name}` : ""}</p>
                {contact.other.phone ? (
                  <div className="grid grid-cols-2 gap-2">
                    <a href={`tel:${contact.other.phone.replace(/[^\d+]/g, "")}`} className="flex min-h-14 items-center justify-center rounded-xl bg-[#111113] px-3 text-lg font-extrabold text-white">Call</a>
                    <a href={`https://wa.me/${digits(contact.other.phone)}`} target="_blank" rel="noreferrer" className="flex min-h-14 items-center justify-center rounded-xl bg-[#1b6b2f] px-3 text-lg font-extrabold text-white">WhatsApp</a>
                  </div>
                ) : null}
              </div>
            ) : null}
            {contact.address ? <p className="text-base font-bold" data-drive-address>{contact.address}</p> : null}
            {contact.mapUrl ? <a href={contact.mapUrl} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center rounded-xl border-2 border-[#111113] px-3 text-base font-extrabold" data-drive-map>Open the map</a> : null}
          </div>
        ) : null}
      </div>
      <DriveClient token={token} kind={trip.kind} loadedAt={trip.loaded_at ?? null} officePhone={officePhone ? formatPhone(officePhone) : null} />
    </main>
  );
}
