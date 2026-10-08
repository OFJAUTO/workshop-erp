import { notFound, redirect } from "next/navigation";
import { Card, DescriptionList, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { STATUS_LABELS } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { gateOutJob } from "../../actions";
import { GateOutForm } from "./GateOutForm";

export default async function GateOutPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("gateOut");
  const { id } = await params;
  const supabase = await createClient();
  const card = await loadJobCard(supabase, id);
  if (!card || !card.gateIn) notFound();
  if (!card.job.is_open) redirect(`/jobs/${id}`);
  const g = card.gateIn;
  const keysPhotos = card.media.filter((m) => m.kind === "keys_photo_front" || m.kind === "keys_photo_back" || m.kind === "keys_photo");
  const role = staff.role_id as RoleId;

  return (
    <>
      <PageHeader title={`Gate out · ${formatPlate(card.vehicle)}`} subtitle={`${vehicleTitle(card.vehicle)} · ${card.job.job_number} · ${STATUS_LABELS[card.job.status]}`} />

      {card.job.inspection_fee_due ? <Notice tone="error">Inspection fee due: the customer declined the quotation. Collect the inspection fee before the car leaves (amount in Settings). Invoicing comes in a later phase.</Notice> : null}
      {card.job.status !== "ready" && card.job.status !== "pending_payment" ? (
        <Notice tone="info">This car is not marked ready yet ({STATUS_LABELS[card.job.status]}). Gate-out is still allowed and will be logged.</Notice>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <Card>
            <GateOutForm action={gateOutJob.bind(null, id)} keysCount={g.keys_count} keychain={g.keys_keychain} dashCam={g.dash_cam} canOverride={can(role, "overrideKeys")} />
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Keys at gate-in</SectionLabel>
            {keysPhotos.length ? (
              <div className="grid grid-cols-2 gap-2">
                {keysPhotos.map((p) => {
                  const url = card.mediaUrls.get(p.storage_path);
                  return url ? (
                    <a key={p.id} href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Keys at gate-in" className="w-full rounded-card object-cover aspect-[4/3] bg-chip" />
                    </a>
                  ) : null;
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">No keys photos on record.</p>
            )}
            <DescriptionList
              items={[
                { label: "Keys received", value: `${g.keys_count}` },
                { label: "Keychain", value: g.keys_keychain ? "Yes" : "No" },
                { label: "Dash cam", value: g.dash_cam ? "Fitted, was disconnected" : "Not fitted" },
              ]}
            />
          </Card>
          <Card className="flex flex-col gap-2">
            <SectionLabel>Balance due</SectionLabel>
            <p className="text-sm text-muted">Starts with invoicing (Phase 4). Until then no balance blocks a release.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
