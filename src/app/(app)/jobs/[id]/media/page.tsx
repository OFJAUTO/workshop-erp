import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { MediaCapture } from "@/components/MediaCapture";
import { VideoRecorder } from "@/components/VideoRecorder";
import { Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { mediaChecklist } from "@/lib/media";
import { getSiteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { createUploadLinkToken } from "../../actions";
import { MediaGallery } from "../MediaGallery";

export const dynamic = "force-dynamic";

export default async function JobMediaPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("editGateIn");
  const { id } = await params;
  const supabase = await createClient();
  const card = await loadJobCard(supabase, id);
  if (!card) notFound();
  const check = mediaChecklist(card.media);

  const token = await createUploadLinkToken(id);
  const site = await getSiteUrl();
  const phoneUrl = `${site}/u/${token}`;
  const qr = await QRCode.toDataURL(phoneUrl, { width: 260, margin: 1, color: { dark: "#111113", light: "#ffffff" } });

  return (
    <>
      <PageHeader
        title={`Photos and video · ${formatPlate(card.vehicle)}`}
        subtitle={`${vehicleTitle(card.vehicle)} · ${card.job.job_number}`}
        actions={
          <LinkButton href={`/jobs/${id}`} tone={check.complete ? "primary" : "secondary"} size="lg">
            {check.complete ? "Open job card" : "Finish later (video pending)"}
          </LinkButton>
        }
      />

      {check.complete ? (
        <Notice tone="success">Gate-in complete. The approval link can now be sent and the car can be assigned.</Notice>
      ) : (
        <Notice tone="info">
          The gate-in stays &quot;incomplete, video pending&quot; until the walk-around video, the dashboard photo and the keys photo are uploaded.
        </Notice>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <VideoRecorder jobId={id} done={check.video} />
          <MediaCapture jobId={id} kind="dashboard_photo" label="Dashboard photo (mileage)" done={check.dashboard} />
          <MediaCapture jobId={id} kind="keys_photo" label="Keys photo" done={check.keys} />
          <MediaCapture jobId={id} kind="damage_photo" label="Damage close-ups (optional)" multiple done={card.media.some((m) => m.kind === "damage_photo")} />
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3 items-center text-center">
            <SectionLabel>Use a phone instead</SectionLabel>
            <p className="text-sm text-muted">Scan this with the phone camera. The page opens with the same buttons, no login needed. Valid for 30 minutes.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code for phone upload" width={260} height={260} className="rounded-card border border-line" />
            <Link href={phoneUrl} className="text-xs text-muted underline underline-offset-4 break-all" target="_blank" rel="noreferrer">
              {phoneUrl}
            </Link>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${card.media.length}`}>Uploaded so far</SectionLabel>
            <MediaGallery media={card.media} urls={Object.fromEntries(card.mediaUrls)} compact />
          </Card>
        </div>
      </div>
    </>
  );
}
