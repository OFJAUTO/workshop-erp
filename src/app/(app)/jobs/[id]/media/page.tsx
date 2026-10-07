import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { LiveRefresh } from "@/components/LiveRefresh";
import { MediaChecklist } from "@/components/MediaChecklist";
import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
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
  const check = mediaChecklist(card.media, { majorDamage: card.gateIn?.major_damage ?? false, wheelsRequired: card.gateIn?.wheels_required ?? false, damageNote: card.gateIn?.damage_note ?? "" });

  const token = await createUploadLinkToken(id);
  const site = await getSiteUrl();
  const phoneUrl = `${site}/u/${token}`;
  const qr = await QRCode.toDataURL(phoneUrl, { width: 260, margin: 1, color: { dark: "#111113", light: "#ffffff" } });

  return (
    <>
      <LiveRefresh tables={["gate_in_media", "gate_ins"]} filter={`job_id=eq.${id}`} />
      <PageHeader
        title={`Photos and video · ${formatPlate(card.vehicle)}`}
        subtitle={`${vehicleTitle(card.vehicle)} · ${card.job.job_number}`}
        actions={
          <LinkButton href={`/jobs/${id}`} tone={check.complete ? "primary" : "secondary"} size="lg">
            {check.complete ? "Open job card" : "Finish later (video pending)"}
          </LinkButton>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <MediaChecklist jobId={id} check={check} />
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3 items-center text-center">
            <SectionLabel>Use a phone instead</SectionLabel>
            <p className="text-sm text-muted">Scan this with the phone camera. The page opens with the same buttons, no login needed. Valid for 30 minutes. This page updates by itself as the phone uploads.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code for phone upload" width={260} height={260} className="rounded-card border border-line" />
            <Link href={phoneUrl} className="text-xs text-muted underline underline-offset-4 break-all" target="_blank" rel="noreferrer">
              {phoneUrl}
            </Link>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${card.media.length}`}>Uploaded so far</SectionLabel>
            <MediaGallery media={card.media} urls={Object.fromEntries(card.mediaUrls)} damageNote={card.gateIn?.damage_note} compact />
          </Card>
        </div>
      </div>
    </>
  );
}
