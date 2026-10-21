import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CarHeaderThumb } from "@/components/CarHeaderThumb";
import { VinCopy } from "@/components/VinCopy";
import { Badge, Card, DescriptionList, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime, formatDayTime } from "@/lib/format";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS, labelOf } from "@/lib/jobs";
import { JOB_DEPARTMENTS } from "@/lib/inspection";
import { describeMileage } from "@/lib/mileage";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { signJobFiles } from "@/lib/work-data";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { mediaChecklist } from "@/lib/media";
import { MediaGallery } from "../MediaGallery";

/**
 * Section 9: ONE staff page with everything recorded at gate-in - the details, the car and customer,
 * every photo and video - plus "View as customer" (the exact approval-link view, with the approval name
 * and time) and the internal PDF. Reached from the Job card approval box at every stage. Staff only.
 */
export default async function GateInDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("viewJobs");
  const { id } = await params;
  const role = staff.role_id as RoleId;
  const supabase = await createClient();
  const [card, settings] = await Promise.all([loadJobCard(supabase, id), getSettings()]);
  if (!card) notFound();
  if (card.job.status === "booked") redirect(`/bodyshop/${id}`);
  const { job, vehicle, customer, customerPublic, gateIn, requests, media, mediaUrls, approvals, gateOut } = card;

  const admin = createAdminClient();
  const { data: oldPartsRows } = gateOut
    ? await admin.from("job_files").select("id, storage_path, taken_at, uploaded_by").eq("job_id", id).eq("kind", "gate_out_photo").eq("caption", "Old parts handed over").is("removed_at", null).order("taken_at")
    : { data: [] };
  const oldPartsUrls = await signJobFiles(((oldPartsRows ?? []) as { storage_path: string }[]).map((r) => r.storage_path));
  const opByIds = Array.from(new Set((oldPartsRows ?? []).map((r) => r.uploaded_by as string | null).filter((x): x is string => !!x)));
  const { data: opByRows } = opByIds.length ? await admin.from("staff").select("id, display_name").in("id", opByIds) : { data: [] as { id: string; display_name: string }[] };
  const opNames = new Map((opByRows ?? []).map((x) => [x.id, x.display_name]));
  const oldPartsPhotos = ((oldPartsRows ?? []) as { id: string; storage_path: string; taken_at: string; uploaded_by: string | null }[]).map((r) => ({ id: r.id, url: oldPartsUrls[r.storage_path] ?? null, taken_at: r.taken_at, byName: r.uploaded_by ? (opNames.get(r.uploaded_by) ?? null) : null }));

  const seesCustomerDetails = can(role, "viewCustomers");
  const customerName = customer?.company_name ?? customer?.full_name ?? customerPublic?.company_name ?? customerPublic?.full_name ?? "Customer";
  const check = mediaChecklist(media, { majorDamage: gateIn?.major_damage ?? false, wheelsRequired: gateIn?.wheels_required ?? false, damageNote: gateIn?.damage_note ?? "", hasCarPicture: !!vehicle.photo_path });
  const canEditGateIn = can(role, "editGateIn") && job.is_open && job.status !== "in_delivery";
  const canRemoveMedia = canEditGateIn && (role === "owner" || !check.complete);
  const mapHref = gateIn?.location_lat != null && gateIn.location_lng != null ? `https://maps.google.com/?q=${gateIn.location_lat},${gateIn.location_lng}` : null;
  // The newest link the customer can open; "View as customer" shows exactly that page, without marking it opened.
  const latestApproval = approvals[0] ?? null;
  const approvedApproval = approvals.find((a) => a.approved_at) ?? null;
  const fee = Number(job.inspection_fee_aed ?? settings.inspection_fee_aed) || 0;

  return (
    <>
      <PageHeader
        picture={<CarHeaderThumb vehicleId={job.vehicle_id} />}
        title={`Gate-in details · ${formatPlate(vehicle)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(vehicle)}</span>
            <span>· {job.job_number}</span>
            <VinCopy vin={vehicle.vin} />
          </span>
        }
        actions={
          <>
            <LinkButton href={`/jobs/${id}`} tone="secondary">
              ← Job card
            </LinkButton>
            {canEditGateIn ? (
              <LinkButton href={`/jobs/${id}/gate-in/edit`} tone="secondary" data-edit-gate-in>
                Edit gate-in
              </LinkButton>
            ) : null}
            {canEditGateIn ? (
              <LinkButton href={`/jobs/${id}/media`} tone="secondary" data-add-media>
                Photos and video
              </LinkButton>
            ) : null}
            {latestApproval?.token ? (
              <LinkButton href={`/approve/${latestApproval.token}?preview=1`} tone="secondary" target="_blank" data-view-as-customer>
                View as customer
              </LinkButton>
            ) : null}
            <LinkButton href={`/api/pdf/gate-in/${id}`} target="_blank" data-gate-in-pdf>
              Download PDF
            </LinkButton>
          </>
        }
      />

      <div className="flex flex-col gap-6 max-w-5xl">
        <Card className="flex flex-col gap-3" data-gate-in-approval>
          <SectionLabel>Job card approval</SectionLabel>
          {approvedApproval ? (
            <p className="text-sm">
              <Badge tone="green">Approved</Badge>{" "}
              <span className="font-semibold">{approvedApproval.approver_name ?? approvedApproval.sent_to_name ?? "The customer"}</span> approved the job card on {formatDateTime(approvedApproval.approved_at!)}.
            </p>
          ) : latestApproval ? (
            <p className="text-sm text-muted">
              Link created {formatDateTime(latestApproval.created_at)}
              {latestApproval.sent_at ? `, sent ${formatDayTime(latestApproval.sent_at)}` : ", not sent yet"}
              {latestApproval.opened_at ? `, opened by the customer ${formatDayTime(latestApproval.opened_at)}` : ""}. Not approved yet.
            </p>
          ) : (
            <p className="text-sm text-muted">No approval link yet. It is created from the job card once the photos and videos are complete.</p>
          )}
          <p className="text-sm">
            Inspection fee if no work is approved: <span className="font-bold">AED {fee.toLocaleString("en-GB")}</span>
            {job.first_approval_at ? <span className="text-muted"> · locked (the customer approved the job card)</span> : null}
          </p>
        </Card>

        <Card className="flex flex-col gap-3" data-gate-in-car>
          <SectionLabel>Vehicle and customer</SectionLabel>
          <DescriptionList
            items={[
              { label: "Customer", value: seesCustomerDetails && customer ? <Link href={`/customers/${customer.id}`} className="font-semibold underline underline-offset-4">{customerName}</Link> : customerName },
              ...(seesCustomerDetails && customer ? [{ label: "Phone", value: customer.phone }, { label: "Customer number", value: customer.customer_number }] : []),
              { label: "Car", value: <Link href={`/vehicles/${vehicle.id}`} className="font-semibold underline underline-offset-4">{vehicleTitle(vehicle)}</Link> },
              { label: "Plate", value: formatPlate(vehicle) },
              { label: "VIN", value: vehicle.vin ? <span className="font-mono">{vehicle.vin}</span> : null },
              { label: "Colour", value: vehicle.colour },
            ]}
          />
        </Card>

        <Card className="flex flex-col gap-3" data-gate-in-details>
          <SectionLabel right={gateIn ? formatDateTime(job.gated_in_at) : undefined}>Gate-in</SectionLabel>
          {gateIn ? (
            <DescriptionList
              items={[
                { label: "Gated in", value: `${formatDateTime(job.gated_in_at)} by ${card.gatedInBy ?? "unknown"}` },
                { label: "Department", value: JOB_DEPARTMENTS.find((d) => d.value === job.department)?.label ?? "Not set" },
                {
                  label: "Location",
                  value: (
                    <span>
                      {gateIn.location_name ?? ""}
                      {gateIn.location_type !== "branch" && gateIn.location_address ? ` · ${gateIn.location_address}` : ""}
                      {mapHref ? (
                        <>
                          {" · "}
                          <a href={mapHref} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                            Map
                          </a>
                        </>
                      ) : null}
                    </span>
                  ),
                },
                { label: "Arrived by", value: labelOf(ARRIVED_BY, gateIn.arrived_by) },
                { label: "Condition", value: labelOf(CONDITIONS, gateIn.condition) },
                { label: vehicle.fuel_type === "electric" ? "Battery" : "Fuel level", value: vehicle.fuel_type === "electric" ? (gateIn.battery_percent != null ? `${gateIn.battery_percent}%` : null) : labelOf(FUEL_LEVELS, gateIn.fuel_level) },
                { label: "Cleanliness", value: labelOf(CLEANLINESS, gateIn.cleanliness) },
                { label: "Dash cam", value: gateIn.dash_cam ? "Fitted, to be disconnected" : "Not fitted" },
                { label: "Major damage", value: gateIn.major_damage ? "Yes" : "No" },
                { label: "Damage note", value: gateIn.damage_note ? <span className="whitespace-pre-wrap">{gateIn.damage_note}</span> : null },
                { label: "Mileage", value: describeMileage(gateIn.mileage, gateIn.mileage_unit ?? "km") },
                { label: "Keys", value: `${gateIn.keys_count} key${gateIn.keys_count === 1 ? "" : "s"}, ${gateIn.keys_keychain ? "with keychain" : "no keychain"}` },
                { label: "Old parts returned to customer", value: gateIn.old_parts_return ? "Yes" : "No" },
                { label: "Notes", value: gateIn.notes ? <span className="whitespace-pre-wrap">{gateIn.notes}</span> : null },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">No gate-in record.</p>
          )}
          {requests.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Customer requests</span>
              <ol className="list-decimal pl-5 text-sm flex flex-col gap-0.5">
                {requests.map((r) => (
                  <li key={r.id}>{r.text}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </Card>

        {gateOut ? (
          <Card className="flex flex-col gap-3" data-gate-out-details>
            <SectionLabel right={job.gated_out_at ? formatDateTime(job.gated_out_at) : undefined}>Gate-out</SectionLabel>
            <DescriptionList
              items={[
                { label: "Gated out", value: `${formatDateTime(job.gated_out_at)} by ${card.gatedOutBy ?? "unknown"}` },
                { label: "Old parts", value: gateOut.old_parts_handed == null ? null : gateOut.old_parts_handed ? `Handed over${oldPartsPhotos.length ? ` · ${oldPartsPhotos.length} photo${oldPartsPhotos.length === 1 ? "" : "s"} below` : ""}` : "Not handed" },
                { label: "Keys returned", value: `${gateOut.keys_returned}, ${gateOut.keychain_returned ? "with keychain" : "no keychain"}${gateOut.keys_match ? "" : " (did not match gate-in)"}` },
                { label: "Keys override", value: gateOut.keys_override_reason },
                { label: "Dash cam reconnected", value: gateOut.dash_cam_reconnected == null ? "Not fitted" : gateOut.dash_cam_reconnected ? "Yes" : "No" },
                { label: "Gate-out notes", value: gateOut.notes },
              ]}
            />
            {oldPartsPhotos.length ? (
              <div className="flex flex-col gap-1" data-old-parts-history>
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Old parts handed over</span>
                <div className="flex flex-wrap gap-2">
                  {oldPartsPhotos.map((p) => (
                    <figure key={p.id} className="flex flex-col gap-0.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <a href={p.url ?? "#"} target="_blank" rel="noreferrer"><img src={p.url ?? ""} alt="Old parts handed over" className="h-24 w-24 rounded-control object-cover" /></a>
                      <figcaption className="text-[11px] text-muted">{formatDayTime(p.taken_at)}{p.byName ? ` · ${p.byName}` : ""}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card className="flex flex-col gap-3" data-gate-in-media>
          <SectionLabel right={`${media.length}`}>Photos and videos</SectionLabel>
          <MediaGallery media={media} urls={Object.fromEntries(mediaUrls)} carPictureUrl={card.vehiclePhotoUrl} damageNote={gateIn?.damage_note} canRemove={canRemoveMedia} />
        </Card>
      </div>
    </>
  );
}
