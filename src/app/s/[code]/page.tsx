import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// No details in a link preview (11 November 2026, Section 12): the name only, the same for every label.
export const metadata: Metadata = { title: "OFJ Automotive", description: "OFJ Automotive", openGraph: { title: "OFJ Automotive", description: "OFJ Automotive" }, robots: { index: false, follow: false } };

function Plain({ title, lines }: { title: string; lines: string[] }) {
  return (
    <main className="min-h-screen bg-white text-ink flex flex-col items-center justify-center gap-5 px-6 text-center" data-qr-public>
      <Logo className="h-16 w-auto" alt="OFJ Automotive" />
      <h1 className="text-2xl font-extrabold">{title}</h1>
      {lines.map((l) => <p key={l} className="text-base font-medium text-muted">{l}</p>)}
    </main>
  );
}

/** THE signed-out label page (11 November 2026, Section 12): the logo and one sentence, nothing to tap. */
function SignedOut() {
  return (
    <main className="min-h-screen bg-white text-ink flex flex-col items-center justify-center gap-5 px-6 text-center" data-qr-signed-out>
      <Logo className="h-16 w-auto" alt="OFJ Automotive" />
      <p className="max-w-md text-xl font-extrabold uppercase leading-snug">OFJ AUTOMOTIVE - TO VIEW THIS LABEL YOU MUST BE SIGNED IN TO THE ERP.</p>
    </main>
  );
}

/**
 * The short link behind every sticker's QR. Logged-in staff land on the record (a part: its own page, 9 November 2026);
 * anyone else sees a plain page with nothing about the customer or the car - except a PART, which shows nothing at
 * all without a sign-in (the battery and service stickers stay public: they are the customer's).
 */
export default async function QrPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const admin = createAdminClient();
  const { data: link } = await admin.from("qr_links").select("code, kind, job_id, vehicle_id, ref_id").eq("code", code.toUpperCase()).maybeSingle();
  const staff = await getCurrentStaff();
  // 11 November 2026, Section 12: a part or item label (or an unknown code) shows nothing at all without a sign-in,
  // and never sends anyone to the sign-in page: the one sentence, no button, no link.
  if (!link || (!staff && (link.kind === "part" || link.kind === "item"))) return <SignedOut />;
  // 9 November 2026, Section 5: a PART sticker's QR is for staff only. Signed in: the part's own page with everything
  // the sticker no longer carries. Not signed in: the sign-in page, nothing else.
  if (link.kind === "part") {
    if (link.ref_id) redirect(`/parts/label/${link.ref_id}`);
  }
  if (staff) {
    if (link.kind === "part" || link.kind === "battery") redirect(`/parts/trail/${link.job_id}${link.ref_id ? `?part=${link.ref_id}#part-${link.ref_id}` : ""}`);
    if (link.kind === "service") redirect(`/vehicles/${link.vehicle_id}`);
    if (link.kind === "item") redirect(`/jobs/${link.job_id}`);
  }
  if (link.kind === "battery") {
    const { data: w } = await admin.from("battery_warranties").select("installed_on, warranty_until").eq("qr_code", link.code).eq("is_active", true).maybeSingle();
    if (!w) return <Plain title="Battery fitted by OFJ Automotive" lines={["Valid for this vehicle only."]} />;
    const expired = w.warranty_until < new Date().toISOString().slice(0, 10);
    return <Plain title={expired ? "Battery warranty: expired" : "Battery warranty: in warranty"} lines={[`Installed ${formatDate(w.installed_on)}`, `Warranty until ${formatDate(w.warranty_until)}`, "Valid for this vehicle only."]} />;
  }
  if (link.kind === "service") {
    const { data: v } = await admin.from("vehicles").select("next_service_date, next_service_mileage, mileage_unit").eq("id", link.vehicle_id ?? "").maybeSingle();
    return <Plain title="Serviced by OFJ Automotive" lines={v?.next_service_date ? [`Next service by ${formatDate(v.next_service_date)}${v.next_service_mileage ? ` or ${v.next_service_mileage.toLocaleString("en-GB")} ${v.mileage_unit === "mi" ? "miles" : "km"}` : ""}.`] : []} />;
  }
  if (link.kind === "item") return <Plain title="Item with OFJ Automotive" lines={[]} />;
  // A part: genuine, fitted on the day it was handed to the technician (or fitted), nothing more.
  const { data: p } = link.ref_id ? await admin.from("part_items").select("fitted_at, issue_confirmed_at, received_qty, created_at").eq("id", link.ref_id).maybeSingle() : { data: null };
  const fitted = (p?.fitted_at as string | null) ?? (p?.issue_confirmed_at as string | null) ?? null;
  return <Plain title="OFJ Automotive: genuine part" lines={[fitted ? `Fitted on ${formatDate(fitted)}` : "Supplied by OFJ Automotive"]} />;
}
