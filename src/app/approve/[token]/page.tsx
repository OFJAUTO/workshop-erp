import type { Metadata } from "next";
import { staffPreview } from "@/lib/customer-preview";
import Link from "next/link";
import { ContactButtons, CustomerFront, customerBoxes } from "@/components/CustomerFront";
import { Button, Field, Input, Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { formatDate, formatDateTime } from "@/lib/format";
import { loadJobCard } from "@/lib/job-data";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS, labelOf, feeNotice } from "@/lib/jobs";
import { jobAdvisorIds, notifyStaff } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { customerPageMetadata } from "@/lib/customer-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { MediaGallery } from "@/app/(app)/jobs/[id]/MediaGallery";
import { CustomerVideos } from "@/components/CustomerVideos";
import { photoSizesFor } from "@/lib/photo-sizes";
import { GATE_IN_BUCKET } from "@/lib/media";
import { DamageSection } from "@/components/DamageSection";
import { DAMAGE_CONFIRM_EN, DAMAGE_WORDS_AR, damageCountWords } from "@/lib/damage";
import { CHECK_IN, approvedLine, checkInFileName } from "@/lib/check-in";
import { loadCarDamage } from "@/lib/damage-data";
import { checkInCharges, chargesReady } from "@/lib/charges";
import { CHARGES_AGREE_AR, CHARGES_AGREE_EN, chargeWordsAr, chargeWordsEn } from "@/lib/charge-rules";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return customerPageMetadata(CHECK_IN.pageTitle, CHECK_IN.pageDescription);
}

/**
 * The VEHICLE CHECK-IN the customer opens from the WhatsApp link (31 October 2026: for the customer it is never the
 * "job card" - that is the workshop's own work order, and staff screens keep the word): the plain logo banner, the number and date, the
 * customer and the car, the requests, the videos and photos, then one light green box with the terms tick,
 * the name and the only Approve button, and Call and WhatsApp. No bar, no greeting, no small print.
 */
export default async function ApprovalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; preview?: string }> }) {
  const { token } = await params;
  const { error, preview } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const company = companyFromSettings(settings);
  const plain = (children: React.ReactNode) => <div className="min-h-screen bg-canvas"><main className="mx-auto max-w-2xl px-4 py-8">{children}</main></div>;

  const { data: req } = await admin
    .from("approval_requests")
    .select("id, job_id, status, opened_at, approved_at, approver_name, terms_text, terms_text_ar, declaration_text, declaration_text_ar, inspection_fee_aed, no_fee, inspection_fee_notice, inspection_fee_notice_ar, sent_to_name, sent_by")
    .eq("token", token)
    .maybeSingle();
  if (!req) return plain(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  // Queue of 4 November 2026: a resend EXPIRES the earlier links - an old one says so, with the phone.
  if ((req as { status?: string }).status === "cancelled") {
    return plain(
      <div className="flex flex-col gap-4" data-checkin-expired>
        <Notice tone="error">This link has expired – ask OFJ for a new one.</Notice>
        <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="flex min-h-12 items-center justify-center rounded-lg border-2 border-[#111113] bg-white px-4 text-sm font-extrabold">Call OFJ · {company.phone}</a>
      </div>,
    );
  }
  const card = await loadJobCard(admin, req.job_id, { customerPage: true });
  if (!card || !card.gateIn) return plain(<Notice tone="error">{CHECK_IN.gone}</Notice>);
  const { vehicle, gateIn, requests, media, mediaUrls, job } = card;

  // "View as customer" from the gate-in details page: the same page, but a staff preview never counts as
  // the customer opening the link and never rings anyone.
  if (!req.opened_at && preview !== "1") {
    await admin.from("approval_requests").update({ opened_at: new Date().toISOString(), status: req.status === "approved" ? "approved" : "opened" }).eq("id", req.id);
    await notifyStaff(Array.from(new Set([req.sent_by, ...(await jobAdvisorIds(job.id))])).filter((x): x is string => !!x), { type: "approval_opened", title: `${req.sent_to_name ?? "The customer"} opened the approval link`, body: `${formatPlate(vehicle)} · ${job.job_number}`, jobId: job.id, href: `/jobs/${job.id}` });
  }

  // The videos go to their own player: fresh addresses on Play, and a "getting ready" slot for one still on its way.
  const videoRows = media
    .filter((m) => m.kind === "video" || m.kind === "video_exterior" || m.kind === "video_interior")
    .map((m) => ({ id: m.id, kind: m.kind, url: mediaUrls.get(m.storage_path) ?? "", duration_s: m.duration_s, taken_at: m.taken_at }))
    .filter((v) => v.url);
  const videosComplete = videoRows.some((v) => v.kind === "video") || (videoRows.some((v) => v.kind === "video_exterior") && videoRows.some((v) => v.kind === "video_interior"));
  // A server page: rendered once per request, the clock is read once (the players renew their addresses from it).
  // eslint-disable-next-line react-hooks/purity
  const signedAt = Date.now();
  // Small pictures for the page; the viewer opens the sharp ones (videos keep their own tiles).
  const { thumb: photoThumbs, medium: photoMediums } = await photoSizesFor(GATE_IN_BUCKET, media.filter((m) => !String(m.kind).startsWith("video")).map((m) => m.storage_path));
  // Section 4 (30 October 2026): the damage already on the car, with each panel's photos, above the approval box.
  const damage = await loadCarDamage(job.id, { media, urls: mediaUrls });
  const hasDamage = damage.items.length > 0 || damage.loose.length > 0;
  const dirty = gateIn.cleanliness === "dirty" || gateIn.cleanliness === "very_dirty";
  // Queue of 4 November 2026: once the JOB is approved, EVERY link of this check-in is read-only — a
  // fresh link sent after the approval shows the approved snapshot ("Approved by <name> on <date>"),
  // never the approve button. The approving request's own name and time carry the line.
  const jobApprovedAt = (job as { first_approval_at?: string | null }).first_approval_at ?? null;
  const approvedReq = req.approved_at
    ? { id: req.id, approver_name: req.approver_name, approved_at: req.approved_at }
    : jobApprovedAt
      ? (((await admin.from("approval_requests").select("id, approver_name, approved_at").eq("job_id", req.job_id).eq("status", "approved").order("approved_at").limit(1).maybeSingle()).data as { id: string; approver_name: string | null; approved_at: string | null } | null) ?? { id: req.id, approver_name: null, approved_at: jobApprovedAt })
      : null;
  const approved = !!approvedReq;
  const car = [vehicle.make?.name, vehicle.model?.name, vehicle.model_year].filter(Boolean).join(" ");
  const customerName = req.sent_to_name ?? card.customer?.full_name ?? "Customer";
  const location = gateIn.location_type === "branch" ? (gateIn.location_name ?? "") : [gateIn.location_name, gateIn.location_address].filter(Boolean).join(", ");
  const declaration = req.declaration_text ?? settings.declaration_text;
  const declarationAr = req.declaration_text_ar ?? settings.declaration_text_ar;
  // 30 October 2026: No inspection fee = nothing about a fee on this page; a fee shows the wording copied onto the link
  // (with VAT) - an older link without one falls back to the Settings wording.
  const noFee = (req as { no_fee?: boolean }).no_fee === true;
  const feeNoticeEn = noFee ? null : (req.inspection_fee_notice ?? feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed));
  const feeNoticeAr = noFee ? null : (req.inspection_fee_notice_ar ?? feeNotice(settings.inspection_fee_notice_ar, settings.inspection_fee_aed));
  // 1 November 2026 (B2): charges already incurred before this approval (recovery, fuel, other), with the VAT the agreed way.
  const vatPct = Number((settings as unknown as Record<string, unknown>).vat_percent) || 5;
  // The agreed charges come from the APPROVING request's snapshot (a fresh post-approval link shows the
  // same agreed figures, never a later change).
  const incurred = approved
    ? (((await chargesReady()) ? ((await createAdminClient().from("approval_requests").select("charges_snapshot").eq("id", approvedReq!.id).maybeSingle()).data?.charges_snapshot ?? []) : []) as { description: string; charge_aed: number; free: boolean }[])
    : (await checkInCharges(req.job_id)).map((l) => ({ description: l.description, charge_aed: l.charge_aed, free: l.free }));
  const details: [string, string | null][] = [
    ["Received at", location || null],
    ["Arrived by", labelOf(ARRIVED_BY, gateIn.arrived_by)],
    ["Condition on arrival", labelOf(CONDITIONS, gateIn.condition)],
    [vehicle.fuel_type === "electric" ? "Battery" : "Fuel level", vehicle.fuel_type === "electric" ? (gateIn.battery_percent != null ? `${gateIn.battery_percent}%` : null) : labelOf(FUEL_LEVELS, gateIn.fuel_level)],
    ["Cleanliness", labelOf(CLEANLINESS, gateIn.cleanliness)],
    ["Damage noted", damageCountWords(damage)],
    ["Mileage", `${gateIn.mileage.toLocaleString("en-GB")} km`],
    ["Keys received", `${gateIn.keys_count} key${gateIn.keys_count === 1 ? "" : "s"}, ${gateIn.keys_keychain ? "with keychain" : "no keychain"}`],
    ["Old parts returned to you", gateIn.old_parts_return ? "Yes" : "No"],
    ["Promised date", job.promised_at ? formatDate(job.promised_at + "T12:00:00+04:00") : "To be confirmed after the inspection"],
  ];

  return (
    <CustomerFront
      preview={preview === "1" && (await staffPreview(preview)) ? { notSent: req.status === "created" } : null}
      company={company}
      header="plain"
      title={CHECK_IN.title}
      titleAr={CHECK_IN.titleAr}
      meta={[{ label: "Reference", value: job.job_number }, { label: "Received", value: formatDateTime(job.gated_in_at) }]}
      view={{ href: `/api/pdf/jobcard/${token}`, label: CHECK_IN.download, fileName: checkInFileName(job.job_number) }}
      boxes={customerBoxes({ full_name: customerName, company_name: card.customer?.company_name ?? null, phone: card.customer?.phone ?? null }, { kind: vehicle.kind ?? null, variant: vehicle.variant ?? null, vin: vehicle.vin ?? null, plate: formatPlate(vehicle), title: car || "Vehicle" })}
      action={
        !approved ? (
          <div id="approval" className="rounded-lg border-2 border-green bg-green-soft p-4 flex flex-col gap-1">
            <span className="text-xs font-bold tracking-[0.08em] uppercase text-[#5F6368]">Your approval</span>
            <form id="approval-form" method="post" action={`/api/approve/${token}`} className="flex flex-col gap-3 py-1">
              <p className="text-xs text-[#5F6368]">This authorises inspection and diagnosis only. Any work will be quoted separately for your approval.</p>
              {incurred.length ? (
                <div className="rounded-lg bg-white px-3 py-2.5 flex flex-col gap-1.5" data-charges-incurred>
                  <span className="text-xs font-bold tracking-[0.08em] uppercase text-[#5F6368]">Charges already incurred · رسوم مستحقة</span>
                  {incurred.map((c, i) => (
                    <span key={i} className="flex flex-col gap-0.5" data-charge-incurred>
                      <span className="text-sm font-bold">{chargeWordsEn(c.description, c, vatPct)}</span>
                      <span className="text-sm font-bold" dir="rtl" lang="ar">{chargeWordsAr(c.description, c, vatPct)}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {feeNoticeEn ? (
                <div className="rounded-lg bg-white px-3 py-2.5 flex flex-col gap-1.5" data-fee-notice>
                  <span className="text-sm font-bold">{feeNoticeEn}</span>
                  {feeNoticeAr ? <span className="text-sm font-bold" dir="rtl" lang="ar">{feeNoticeAr}</span> : null}
                </div>
              ) : null}
              <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-[#D4D4D8] bg-white p-3 has-[:checked]:border-[#111113]">
                <input type="checkbox" name="agree" required className="mt-1 h-5 w-5 accent-ink shrink-0" />
                <span className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{declaration}</span>
                  {incurred.length ? <span className="text-sm font-medium" data-charges-agree>{CHARGES_AGREE_EN}</span> : null}
                  {hasDamage ? <span className="text-sm font-medium" data-damage-confirm>{DAMAGE_CONFIRM_EN}</span> : null}
                  <span className="text-sm font-medium" dir="rtl" lang="ar">{declarationAr}</span>
                  {incurred.length ? <span className="text-sm font-medium" dir="rtl" lang="ar">{CHARGES_AGREE_AR}</span> : null}
                  {hasDamage ? <span className="text-sm font-medium" dir="rtl" lang="ar">{DAMAGE_WORDS_AR.confirm}</span> : null}
                  <Link href={`/terms?t=${encodeURIComponent(token)}`} className="text-xs font-bold underline underline-offset-4">Read the terms and conditions</Link>
                </span>
              </label>
              <Field label="Your full name">
                {/* Empty on purpose: the person approving types their own name (never the company's, never pre-filled). */}
                <Input name="approver_name" defaultValue="" placeholder="Type your full name" required minLength={2} autoComplete="name" className="bg-white" data-approver-name />
              </Field>
              <Button type="submit" size="lg" className="w-full">Approve</Button>
            </form>
          </div>
        ) : null
      }
      contact={<ContactButtons phone={company.phone} />}
    >
      {approved && approvedReq ? <div data-approved-line><Notice tone="success">{approvedLine(approvedReq.approver_name, card.customer?.company_name, formatDateTime(approvedReq.approved_at))} Thank you.</Notice></div> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-bold tracking-[0.08em] uppercase text-[#5F6368] border-b-2 border-[#111113] pb-1.5">Your requests</h2>
        <ol className="list-decimal pl-5 text-sm flex flex-col gap-0.5 py-1">
          {requests.length ? requests.map((r) => <li key={r.id}>{r.text}</li>) : <li className="whitespace-pre-wrap list-none -ml-5">{gateIn.customer_requests}</li>}
        </ol>
      </section>
      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-bold tracking-[0.08em] uppercase text-[#5F6368] border-b-2 border-[#111113] pb-1.5">Check-in videos and photos</h2>
        <div className="py-1 flex flex-col gap-4">
          <CustomerVideos token={token} initial={videoRows} expected={videoRows.some((v) => v.kind === "video") ? ["video"] : ["video_exterior", "video_interior"]} complete={videosComplete} signedAt={signedAt} />
          <MediaGallery media={media} urls={Object.fromEntries(mediaUrls)} thumbs={Object.fromEntries(photoThumbs)} mediums={Object.fromEntries(photoMediums)} stacked hideVideos damageElsewhere />
        </div>
        {dirty ? <p className="text-xs font-semibold">Vehicle received dirty; existing scratches and marks may not be visible in the video.</p> : null}
        {gateIn.dash_cam ? <p className="text-xs font-semibold">Dash cam fitted: it will be disconnected as per the terms and conditions.</p> : null}
      </section>
      <DamageSection damage={damage} />
      <details className="rounded-lg border border-[#D4D4D8]">
        <summary className="cursor-pointer min-h-12 flex items-center px-4 text-sm font-bold">Check-in details</summary>
        <div className="px-4 pb-4 text-sm grid grid-cols-[9rem_1fr] sm:grid-cols-[12rem_1fr] gap-y-1">
          {details.filter(([, v]) => v).map(([k, v]) => (<div key={k} className="contents"><span className="text-[#5F6368]">{k}</span><span className="font-medium">{v}</span></div>))}
        </div>
      </details>
    </CustomerFront>
  );
}
