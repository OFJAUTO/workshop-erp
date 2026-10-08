import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button, Card, DescriptionList, Field, Input, Notice } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { loadJobCard } from "@/lib/job-data";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS, labelOf, feeNotice } from "@/lib/jobs";
import { notifyStaff } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { MediaGallery } from "@/app/(app)/jobs/[id]/MediaGallery";

export const dynamic = "force-dynamic";

/** What WhatsApp shows in the link preview. Customers never see the words "Workshop ERP". */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "OFJ Automotive, Vehicle Check-In",
    description: "Review your vehicle's check-in video and job card, then approve to begin",
    openGraph: {
      title: "OFJ Automotive, Vehicle Check-In",
      description: "Review your vehicle's check-in video and job card, then approve to begin",
      siteName: "OFJ Automotive",
      images: [{ url: `${PRODUCTION_SITE_URL}/logo.jpg`, width: 1206, height: 618 }],
      type: "website",
    },
    twitter: { card: "summary_large_image", title: "OFJ Automotive, Vehicle Check-In", images: [`${PRODUCTION_SITE_URL}/logo.jpg`] },
    robots: { index: false, follow: false },
  };
}

/** The page the customer opens from the WhatsApp link. No login. Phone first. */
export default async function ApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();

  const { data: req } = await admin
    .from("approval_requests")
    .select("id, job_id, status, opened_at, approved_at, approver_name, terms_text, terms_text_ar, declaration_text, declaration_text_ar, inspection_fee_aed, inspection_fee_notice, inspection_fee_notice_ar, sent_to_name, sent_by")
    .eq("token", token)
    .maybeSingle();

  if (!req) {
    return (
      <Branded companyName={settings.company_name}>
        <Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>
      </Branded>
    );
  }

  const card = await loadJobCard(admin, req.job_id);
  if (!card || !card.gateIn) {
    return (
      <Branded companyName={settings.company_name}>
        <Notice tone="error">This job card is no longer available.</Notice>
      </Branded>
    );
  }
  const { vehicle, gateIn, requests, media, mediaUrls, job } = card;

  if (!req.opened_at) {
    await admin
      .from("approval_requests")
      .update({ opened_at: new Date().toISOString(), status: req.status === "approved" ? "approved" : "opened" })
      .eq("id", req.id);
    await notifyStaff([req.sent_by, job.gated_in_by].filter((x): x is string => !!x), {
      type: "approval_opened",
      title: `${req.sent_to_name ?? "The customer"} opened the approval link`,
      body: `${formatPlate(vehicle)} · ${job.job_number}`,
      jobId: job.id,
      href: `/jobs/${job.id}`,
    });
  }

  // The advisor the customer can contact.
  let advisor: { name: string; phone: string | null } | null = null;
  if (req.sent_by) {
    const [{ data: s }, { data: p }] = await Promise.all([
      admin.from("staff").select("display_name").eq("id", req.sent_by).maybeSingle(),
      admin.from("staff_private").select("phone").eq("staff_id", req.sent_by).maybeSingle(),
    ]);
    if (s) advisor = { name: s.display_name, phone: p?.phone ?? null };
  }

  const dirty = gateIn.cleanliness === "dirty" || gateIn.cleanliness === "very_dirty";
  const approved = !!req.approved_at;
  const carName = [vehicle.make?.name, vehicle.model?.name].filter(Boolean).join(" ");
  const customerName = req.sent_to_name ?? card.customer?.full_name ?? "Customer";
  const location = gateIn.location_type === "branch" ? (gateIn.location_name ?? "") : [gateIn.location_name, gateIn.location_address].filter(Boolean).join(", ");
  const declaration = req.declaration_text ?? settings.declaration_text;
  const declarationAr = req.declaration_text_ar ?? settings.declaration_text_ar;
  // Approvals created before the notice existed fall back to the current setting.
  const feeNoticeEn = req.inspection_fee_notice ?? feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed);
  const feeNoticeAr = req.inspection_fee_notice_ar ?? feeNotice(settings.inspection_fee_notice_ar, settings.inspection_fee_aed);
  const waDigits = advisor?.phone ? advisor.phone.replace(/[^\d]/g, "") : "";

  return (
    <Branded companyName={settings.company_name} advisor={advisor} waDigits={waDigits}>
      <h1 className="text-2xl font-extrabold">Your Vehicle&apos;s Job Card</h1>
      <p className="text-[15px] leading-relaxed">
        Dear {customerName}, your {carName} ({formatPlate(vehicle)}) was received on {formatDateTime(job.gated_in_at)}
        {location ? ` at ${location}` : ""}. Please review the videos and details below, then approve so we can begin the inspection.
      </p>

      <ol className="grid grid-cols-3 gap-2">
        {[
          { n: 1, label: "Review", done: true },
          { n: 2, label: "Agree to terms", done: approved },
          { n: 3, label: "Approve", done: approved },
        ].map((s) => (
          <li key={s.n} className={`rounded-control px-3 py-2 text-center text-xs font-bold ${s.done ? "bg-ink text-white" : "bg-white border border-line-strong"}`}>
            {s.n}. {s.label}
          </li>
        ))}
      </ol>

      {approved ? (
        <Notice tone="success">
          Approved by {req.approver_name} on {formatDateTime(req.approved_at)}. Thank you.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">Check-in videos and photos</h2>
        <MediaGallery media={media} urls={Object.fromEntries(mediaUrls)} damageNote={gateIn.damage_note} stacked />
        {dirty ? <p className="text-sm font-semibold">Vehicle received dirty; existing scratches and marks may not be visible in the video.</p> : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">Job card</h2>
        <DescriptionList
          items={[
            {
              label: "Your requests",
              value: requests.length ? (
                <ol className="list-decimal pl-5 flex flex-col gap-0.5">
                  {requests.map((r) => (
                    <li key={r.id}>{r.text}</li>
                  ))}
                </ol>
              ) : (
                <span className="whitespace-pre-wrap">{gateIn.customer_requests}</span>
              ),
            },
            { label: "Received at", value: location || null },
            { label: "Arrived by", value: labelOf(ARRIVED_BY, gateIn.arrived_by) },
            { label: "Condition on arrival", value: labelOf(CONDITIONS, gateIn.condition) },
            {
              label: vehicle.fuel_type === "electric" ? "Battery" : "Fuel level",
              value: vehicle.fuel_type === "electric" ? (gateIn.battery_percent != null ? `${gateIn.battery_percent}%` : null) : labelOf(FUEL_LEVELS, gateIn.fuel_level),
            },
            { label: "Cleanliness", value: labelOf(CLEANLINESS, gateIn.cleanliness) },
            { label: "Major damage noted", value: gateIn.major_damage ? "Yes, see the damage photos above" : "No" },
            { label: "Mileage", value: `${gateIn.mileage.toLocaleString("en-GB")} km` },
            { label: "Keys received", value: `${gateIn.keys_count} key${gateIn.keys_count === 1 ? "" : "s"}, ${gateIn.keys_keychain ? "with keychain" : "no keychain"}` },
            { label: "Old parts returned to you", value: gateIn.old_parts_return ? "Yes" : "No" },
            { label: "Promised date", value: job.promised_at ? formatDate(job.promised_at + "T12:00:00+04:00") : "To be confirmed after inspection" },
          ]}
        />
        {gateIn.dash_cam ? <p className="text-sm font-semibold">Dash cam fitted: it will be disconnected as per the terms and conditions.</p> : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">Terms and conditions</h2>
        <p className="text-sm text-muted">The full terms open on their own page, in English and Arabic. A button there brings you back here.</p>
        <Link href={`/terms?t=${encodeURIComponent(token)}`} className="inline-flex min-h-12 w-full items-center justify-center rounded-control border-2 border-ink bg-white px-4 text-sm font-bold">
          Read the terms and conditions
        </Link>
      </Card>

      {!approved ? (
        <section id="approval" className="rounded-card border border-line bg-chip p-5 flex flex-col gap-4 scroll-mt-4">
          <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">Your approval</h2>
          <p className="text-sm text-muted">This authorises inspection and diagnosis only. Any work will be quoted separately for your approval.</p>
          <form method="post" action={`/api/approve/${token}`} className="flex flex-col gap-4">
            {feeNoticeEn ? (
              <div className="rounded-control border border-line-strong bg-white px-3 py-2.5 flex flex-col gap-1.5">
                <span className="text-sm font-bold">{feeNoticeEn}</span>
                {feeNoticeAr ? (
                  <span className="text-sm font-bold" dir="rtl" lang="ar">
                    {feeNoticeAr}
                  </span>
                ) : null}
              </div>
            ) : null}
            <label className="flex items-start gap-3 cursor-pointer rounded-control border border-line-strong bg-white p-3 has-[:checked]:border-ink">
              <input type="checkbox" name="agree" required className="mt-1 h-5 w-5 accent-ink shrink-0" />
              <span className="flex flex-col gap-2">
                <span className="text-sm font-medium">{declaration}</span>
                <span className="text-sm font-medium" dir="rtl" lang="ar">
                  {declarationAr}
                </span>
              </span>
            </label>
            <Field label="Your full name">
              <Input name="approver_name" defaultValue={req.sent_to_name ?? ""} required minLength={2} autoComplete="name" />
            </Field>
            <Button type="submit" size="lg" className="w-full">
              Approve
            </Button>
          </form>
        </section>
      ) : null}
    </Branded>
  );
}

function Branded({
  companyName,
  advisor,
  waDigits,
  children,
}: {
  companyName: string;
  advisor?: { name: string; phone: string | null } | null;
  waDigits?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-sidebar text-white px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Logo onDark className="h-9" alt={companyName} />
          {/* On a PC the title sits in the bar; on a phone it moves to its own line below. */}
          <span className="hidden sm:inline text-sm font-bold truncate">Vehicle Check-In</span>
        </div>
        {advisor?.phone ? (
          <div className="flex items-center gap-2 shrink-0">
            {/* Phone: two round icon buttons. */}
            <a href={`tel:${advisor.phone}`} aria-label={`Call ${advisor.name}`} title={`Call ${advisor.name}`} className="sm:hidden inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/50">
              <PhoneIcon />
            </a>
            {waDigits ? (
              <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" aria-label="WhatsApp the advisor" title="WhatsApp" className="sm:hidden inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink">
                <WhatsAppIcon />
              </a>
            ) : null}
            {/* PC: buttons with text. */}
            <a href={`tel:${advisor.phone}`} className="hidden sm:inline-flex min-h-10 items-center gap-2 rounded-control border border-white/40 px-3 text-xs font-bold">
              <PhoneIcon /> Call {advisor.name}
            </a>
            {waDigits ? (
              <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" className="hidden sm:inline-flex min-h-10 items-center gap-2 rounded-control bg-white px-3 text-xs font-bold text-ink">
                <WhatsAppIcon /> WhatsApp
              </a>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="sm:hidden bg-white border-b border-line px-4 py-2.5">
        <span className="block text-base font-extrabold">Vehicle Check-In</span>
      </div>
      <main className="mx-auto max-w-2xl px-4 py-5 flex flex-col gap-4">{children}</main>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.8 2.1z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 1 1-4.2 15.3l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8zm-3.3 4.4c-.2 0-.5 0-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 2.4 1 2.9.8 3.4.7.5 0 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.2-.7.2l-.9 1.1c-.2.2-.3.2-.6.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.6-.5h-.6z" />
    </svg>
  );
}
