import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button, Card, DescriptionList, Field, Input, Notice, SectionLabel } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS, labelOf } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The page the customer opens from the WhatsApp link. No login. Branded, white, black and grey. */
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
    .select("id, job_id, status, opened_at, approved_at, approver_name, terms_text, sent_to_name")
    .eq("token", token)
    .maybeSingle();

  if (!req) {
    return (
      <Branded companyName={settings.company_name}>
        <Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>
      </Branded>
    );
  }

  if (!req.opened_at) {
    await admin
      .from("approval_requests")
      .update({ opened_at: new Date().toISOString(), status: req.status === "sent" ? "opened" : req.status })
      .eq("id", req.id);
  }

  const card = await loadJobCard(admin, req.job_id);
  if (!card || !card.gateIn) {
    return (
      <Branded companyName={settings.company_name}>
        <Notice tone="error">This job card is no longer available.</Notice>
      </Branded>
    );
  }
  const { vehicle, gateIn, media, mediaUrls, job } = card;
  const video = media.find((m) => m.kind === "video");
  const videoUrl = video ? mediaUrls.get(video.storage_path) : null;
  const keysPhoto = media.find((m) => m.kind === "keys_photo");
  const keysUrl = keysPhoto ? mediaUrls.get(keysPhoto.storage_path) : null;
  const dirty = gateIn.cleanliness === "dirty" || gateIn.cleanliness === "very_dirty";
  const approved = !!req.approved_at;

  return (
    <Branded companyName={settings.company_name}>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold">{formatPlate(vehicle)}</h1>
        <p className="text-sm font-medium text-muted">
          {vehicleTitle(vehicle)} · Job card {job.job_number} · Received {formatDateTime(job.gated_in_at)}
        </p>
      </div>

      {videoUrl ? (
        <video src={videoUrl} controls playsInline preload="metadata" className="w-full rounded-card bg-black aspect-video" />
      ) : (
        <div className="w-full rounded-card bg-chip aspect-video flex items-center justify-center text-sm text-muted">Walk-around video</div>
      )}

      {approved ? (
        <Notice tone="success">
          Approved by {req.approver_name} on {formatDateTime(req.approved_at)}. Thank you.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-col gap-4">
        <SectionLabel>Job card</SectionLabel>
        <DescriptionList
          items={[
            { label: "Your requests", value: <span className="whitespace-pre-wrap">{gateIn.customer_requests}</span> },
            { label: "Arrived by", value: labelOf(ARRIVED_BY, gateIn.arrived_by) },
            { label: "Condition on arrival", value: labelOf(CONDITIONS, gateIn.condition) },
            {
              label: vehicle.fuel_type === "electric" ? "Battery" : "Fuel level",
              value: vehicle.fuel_type === "electric" ? (gateIn.battery_percent != null ? `${gateIn.battery_percent}%` : null) : labelOf(FUEL_LEVELS, gateIn.fuel_level),
            },
            { label: "Cleanliness", value: labelOf(CLEANLINESS, gateIn.cleanliness) },
            { label: "Mileage", value: `${gateIn.mileage.toLocaleString("en-GB")} km` },
            { label: "Old parts returned to you", value: gateIn.old_parts_return ? "Yes" : "No" },
            { label: "Promised date", value: job.promised_at ? formatDate(job.promised_at + "T12:00:00+04:00") : null },
          ]}
        />
        {gateIn.dash_cam ? <p className="text-sm font-semibold">Dash cam fitted: it will be disconnected as per the terms and conditions.</p> : null}
        {dirty ? <p className="text-sm font-semibold">Vehicle received dirty; existing scratches and marks may not be visible in the video.</p> : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Keys received</SectionLabel>
        <p className="text-sm">
          {gateIn.keys_count} key{gateIn.keys_count === 1 ? "" : "s"}, {gateIn.keys_keychain ? "with keychain" : "no keychain"}
        </p>
        {keysUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={keysUrl} alt="Keys received" className="w-full max-w-sm rounded-card object-cover aspect-[4/3] bg-chip" />
        ) : null}
      </Card>

      {!approved ? (
        <Card className="flex flex-col gap-4">
          <SectionLabel>Your approval</SectionLabel>
          <p className="text-sm text-muted">
            This authorises inspection and diagnosis only. Any work will be quoted separately for your approval. Read the{" "}
            <Link href={`/terms?t=${encodeURIComponent(token)}`} className="font-semibold text-ink underline underline-offset-4" target="_blank">
              terms and conditions
            </Link>
            .
          </p>
          <form method="post" action={`/api/approve/${token}`} className="flex flex-col gap-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" name="agree" required className="mt-1 h-5 w-5 accent-ink shrink-0" />
              <span className="text-sm font-medium">
                I agree to the terms and conditions and confirm I am the owner of the vehicle or a legal representative authorised to act on the owner&apos;s behalf.
              </span>
            </label>
            <Field label="Your full name">
              <Input name="approver_name" defaultValue={req.sent_to_name ?? ""} required minLength={2} autoComplete="name" />
            </Field>
            <Button type="submit" size="lg">
              Approve
            </Button>
          </form>
        </Card>
      ) : null}
    </Branded>
  );
}

function Branded({ companyName, children }: { companyName: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-sidebar text-white px-5 py-4 flex items-center justify-between">
        <Logo onDark className="h-10" alt={companyName} />
        <span className="text-xs text-white/70">{companyName}</span>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 flex flex-col gap-5">{children}</main>
    </div>
  );
}
