import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getCurrentStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "OFJ Automotive", robots: { index: false, follow: false } };

function Plain({ title, lines }: { title: string; lines: string[] }) {
  return (
    <main className="min-h-screen bg-white text-ink flex flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo className="h-16 w-auto" alt="OFJ Automotive" />
      <h1 className="text-2xl font-extrabold">{title}</h1>
      {lines.map((l) => <p key={l} className="text-base font-medium text-muted">{l}</p>)}
    </main>
  );
}

/**
 * The short link behind every sticker's QR. Logged-in staff land on the record; anyone else sees a
 * plain page with nothing about the customer or the car.
 */
export default async function QrPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const admin = createAdminClient();
  const { data: link } = await admin.from("qr_links").select("code, kind, job_id, vehicle_id, ref_id").eq("code", code.toUpperCase()).maybeSingle();
  if (!link) return <Plain title="OFJ Automotive" lines={["This code is not known."]} />;
  const staff = await getCurrentStaff();
  if (staff) {
    if (link.kind === "part" || link.kind === "battery") redirect(`/parts/trail/${link.job_id}`);
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
    return <Plain title="Serviced by OFJ Automotive" lines={v?.next_service_date ? [`Next service by ${formatDate(v.next_service_date)}${v.next_service_mileage ? ` or ${v.next_service_mileage.toLocaleString("en-GB")} ${v.mileage_unit === "miles" ? "miles" : "km"}` : ""}, whichever comes first.`] : []} />;
  }
  if (link.kind === "item") return <Plain title="Item with OFJ Automotive" lines={[]} />;
  return <Plain title="Part fitted by OFJ Automotive" lines={[]} />;
}
