import type { Metadata } from "next";
import Link from "next/link";
import { CustomerDocument, DocSection } from "@/components/CustomerDocument";
import { Button, Field, Input, Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { formatDate, formatDateTime } from "@/lib/format";
import { loadJobCard } from "@/lib/job-data";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS, labelOf, feeNotice } from "@/lib/jobs";
import { notifyStaff } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { customerPageMetadata } from "@/lib/customer-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { MediaGallery } from "@/app/(app)/jobs/[id]/MediaGallery";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return customerPageMetadata("OFJ Automotive, Vehicle Check-In", "Review your vehicle's check-in video and job card, then approve to begin");
}

/** The job card the customer opens from the WhatsApp link: the same document look as every other page, with Approve in the bar at the bottom. No login. */
export default async function ApprovalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const company = companyFromSettings(settings);
  const plain = (children: React.ReactNode) => <div className="min-h-screen bg-canvas"><main className="mx-auto max-w-2xl px-4 py-8">{children}</main></div>;

  const { data: req } = await admin
    .from("approval_requests")
    .select("id, job_id, status, opened_at, approved_at, approver_name, terms_text, terms_text_ar, declaration_text, declaration_text_ar, inspection_fee_aed, inspection_fee_notice, inspection_fee_notice_ar, sent_to_name, sent_by")
    .eq("token", token)
    .maybeSingle();
  if (!req) return plain(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  const card = await loadJobCard(admin, req.job_id);
  if (!card || !card.gateIn) return plain(<Notice tone="error">This job card is no longer available.</Notice>);
  const { vehicle, gateIn, requests, media, mediaUrls, job } = card;

  if (!req.opened_at) {
    await admin.from("approval_requests").update({ opened_at: new Date().toISOString(), status: req.status === "approved" ? "approved" : "opened" }).eq("id", req.id);
    await notifyStaff([req.sent_by, job.gated_in_by].filter((x): x is string => !!x), { type: "approval_opened", title: `${req.sent_to_name ?? "The customer"} opened the approval link`, body: `${formatPlate(vehicle)} · ${job.job_number}`, jobId: job.id, href: `/jobs/${job.id}` });
  }

  let advisor: { name: string; phone: string | null } | null = null;
  if (req.sent_by) {
    const [{ data: s }, { data: p }] = await Promise.all([admin.from("staff").select("display_name").eq("id", req.sent_by).maybeSingle(), admin.from("staff_private").select("phone").eq("staff_id", req.sent_by).maybeSingle()]);
    if (s) advisor = { name: s.display_name, phone: p?.phone ?? null };
  }
  const dirty = gateIn.cleanliness === "dirty" || gateIn.cleanliness === "very_dirty";
  const approved = !!req.approved_at;
  const car = [vehicle.make?.name, vehicle.model?.name, vehicle.model_year].filter(Boolean).join(" ");
  const customerName = req.sent_to_name ?? card.customer?.full_name ?? "Customer";
  const location = gateIn.location_type === "branch" ? (gateIn.location_name ?? "") : [gateIn.location_name, gateIn.location_address].filter(Boolean).join(", ");
  const declaration = req.declaration_text ?? settings.declaration_text;
  const declarationAr = req.declaration_text_ar ?? settings.declaration_text_ar;
  const feeNoticeEn = req.inspection_fee_notice ?? feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed);
  const feeNoticeAr = req.inspection_fee_notice_ar ?? feeNotice(settings.inspection_fee_notice_ar, settings.inspection_fee_aed);
  const waDigits = advisor?.phone ? advisor.phone.replace(/[^\d]/g, "") : "";
  const details: [string, string | null][] = [
    ["Received at", location || null],
    ["Arrived by", labelOf(ARRIVED_BY, gateIn.arrived_by)],
    ["Condition on arrival", labelOf(CONDITIONS, gateIn.condition)],
    [vehicle.fuel_type === "electric" ? "Battery" : "Fuel level", vehicle.fuel_type === "electric" ? (gateIn.battery_percent != null ? `${gateIn.battery_percent}%` : null) : labelOf(FUEL_LEVELS, gateIn.fuel_level)],
    ["Cleanliness", labelOf(CLEANLINESS, gateIn.cleanliness)],
    ["Major damage noted", gateIn.major_damage ? "Yes, see the damage photos" : "No"],
    ["Mileage", `${gateIn.mileage.toLocaleString("en-GB")} km`],
    ["Keys received", `${gateIn.keys_count} key${gateIn.keys_count === 1 ? "" : "s"}, ${gateIn.keys_keychain ? "with keychain" : "no keychain"}`],
    ["Old parts returned to you", gateIn.old_parts_return ? "Yes" : "No"],
    ["Promised date", job.promised_at ? formatDate(job.promised_at + "T12:00:00+04:00") : "To be confirmed after the inspection"],
  ];

  return (
    <CustomerDocument
      uppercase={settings.customer_documents_uppercase === true}
      company={company}
      title="Job card"
      meta={[{ label: "Job card", value: job.job_number }, { label: "Received", value: formatDateTime(job.gated_in_at) }]}
      boxes={[
        { title: "Customer", strong: card.customer?.company_name ?? customerName, rows: [["Name", card.customer?.company_name ? customerName : null], ["Mobile", card.customer?.phone ?? null]] },
        { title: "Vehicle", strong: car || "Vehicle", rows: [["Variant", vehicle.variant], ["Plate", formatPlate(vehicle)], ["VIN", vehicle.vin]] },
      ]}
      footer={<>{advisor ? <>Questions? {advisor.phone ? <a href={`tel:${advisor.phone}`} className="font-semibold underline underline-offset-4">Call {advisor.name}</a> : advisor.name}{waDigits ? <> · <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">WhatsApp</a></> : null}. </> : null}{company.legalName} · TRN {company.trn}.</>}
      bar={!approved ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold hidden sm:inline">Review, tick the declaration, then approve.</span>
          <Button type="submit" form="approval-form" size="lg" className="w-full sm:w-auto sm:min-w-56">Approve</Button>
        </div>
      ) : null}
    >
      {approved ? <Notice tone="success">Approved by {req.approver_name} on {formatDateTime(req.approved_at)}. Thank you.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="text-sm leading-relaxed">Dear {customerName}, your {car} ({formatPlate(vehicle)}) was received on {formatDateTime(job.gated_in_at)}{location ? ` at ${location}` : ""}. Please review the videos and details below, then approve so we can begin the inspection.</p>
      {advisor && (advisor.phone || waDigits) ? (
        <div className="grid grid-cols-2 gap-3">
          {advisor.phone ? <a href={`tel:${advisor.phone}`} className="flex min-h-14 items-center justify-center rounded-lg bg-[#111113] px-4 text-base font-extrabold text-white">Call {advisor.name.split(" ")[0]}</a> : null}
          {waDigits ? <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" className="flex min-h-14 items-center justify-center rounded-lg border-2 border-[#111113] bg-white px-4 text-base font-extrabold">WhatsApp</a> : null}
        </div>
      ) : null}
      <DocSection title="Your requests">
        <ol className="list-decimal pl-5 text-sm flex flex-col gap-0.5 py-1">
          {requests.length ? requests.map((r) => <li key={r.id}>{r.text}</li>) : <li className="whitespace-pre-wrap list-none -ml-5">{gateIn.customer_requests}</li>}
        </ol>
      </DocSection>
      <DocSection title="Check-in videos and photos">
        <div className="py-1"><MediaGallery media={media} urls={Object.fromEntries(mediaUrls)} damageNote={gateIn.damage_note} stacked /></div>
        {dirty ? <p className="text-xs font-semibold">Vehicle received dirty; existing scratches and marks may not be visible in the video.</p> : null}
      </DocSection>
      <DocSection title="Check-in details">
        <div className="text-sm grid grid-cols-[9rem_1fr] sm:grid-cols-[12rem_1fr] gap-y-1 py-1">
          {details.filter(([, v]) => v).map(([k, v]) => (<div key={k} className="contents"><span className="text-muted">{k}</span><span className="font-medium">{v}</span></div>))}
        </div>
        {gateIn.dash_cam ? <p className="text-xs font-semibold">Dash cam fitted: it will be disconnected as per the terms and conditions.</p> : null}
      </DocSection>
      <DocSection title="Terms and conditions">
        <p className="text-sm py-1">The full terms open on their own page, in English and Arabic. A button there brings you back here.{" "}
          <Link href={`/terms?t=${encodeURIComponent(token)}`} className="font-bold underline underline-offset-4">Read the terms and conditions</Link>
        </p>
      </DocSection>
      {!approved ? (
        <DocSection title="Your approval">
          <form id="approval-form" method="post" action={`/api/approve/${token}`} className="flex flex-col gap-3 py-1">
            <p className="text-xs text-muted">This authorises inspection and diagnosis only. Any work will be quoted separately for your approval.</p>
            {feeNoticeEn ? (
              <div className="rounded-control bg-chip px-3 py-2.5 flex flex-col gap-1.5">
                <span className="text-sm font-bold">{feeNoticeEn}</span>
                {feeNoticeAr ? <span className="text-sm font-bold" dir="rtl" lang="ar">{feeNoticeAr}</span> : null}
              </div>
            ) : null}
            <label className="flex items-start gap-3 cursor-pointer rounded-control border border-line-strong bg-white p-3 has-[:checked]:border-ink">
              <input type="checkbox" name="agree" required className="mt-1 h-5 w-5 accent-ink shrink-0" />
              <span className="flex flex-col gap-2">
                <span className="text-sm font-medium">{declaration}</span>
                <span className="text-sm font-medium" dir="rtl" lang="ar">{declarationAr}</span>
              </span>
            </label>
            <Field label="Your full name">
              <Input name="approver_name" defaultValue={req.sent_to_name ?? ""} required minLength={2} autoComplete="name" />
            </Field>
          </form>
        </DocSection>
      ) : null}
    </CustomerDocument>
  );
}
