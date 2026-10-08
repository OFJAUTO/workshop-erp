import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, DescriptionList, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type VehiclePhotoRow, type VehicleRow } from "@/lib/types";
import { addVehiclePhoto, setVehicleActive, setVehicleProfilePhoto } from "../actions";
import { PhotoUploadForm } from "./PhotoUploadForm";
import { ProfilePhotoForm } from "./ProfilePhotoForm";

type Row = VehicleRow & {
  make: { name: string } | null;
  model: { name: string } | null;
  customer: { id: string; customer_number: string; full_name: string; company_name: string | null; phone: string } | null;
};

export default async function VehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const staff = await requirePermission("viewVehicles");
  const { id } = await params;
  const { message, error } = await searchParams;
  const role = staff.role_id as RoleId;
  const canEdit = can(role, "editVehicles");
  const seesCustomers = can(role, "viewCustomers");

  const supabase = await createClient();
  const [{ data: vData }, { data: photosData }] = await Promise.all([
    supabase
      .from("vehicles")
      .select(
        "id, customer_id, photo_path, plate_country, plate_emirate, plate_code, plate_number, vin, make_id, model_id, variant, model_year, colour, fuel_type, last_mileage, notes, is_active, created_at, updated_at, make:vehicle_makes(name), model:vehicle_models(name), customer:customers(id, customer_number, full_name, company_name, phone)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("vehicle_photos")
      .select("id, vehicle_id, storage_path, caption, taken_at, uploaded_by")
      .eq("vehicle_id", id)
      .order("taken_at", { ascending: false }),
  ]);
  if (!vData) notFound();
  const v = vData as unknown as Row;
  const photos = (photosData ?? []) as VehiclePhotoRow[];

  const [{ data: vipRow }, { data: pub }, { data: visitRows }] = await Promise.all([
    supabase.from("customer_vip_flags").select("is_vip, vip_note").eq("id", v.customer_id).maybeSingle(),
    supabase.from("customer_public").select("full_name, company_name").eq("id", v.customer_id).maybeSingle(),
    supabase.from("jobs").select("id, job_number, status, gated_in_at, gated_out_at, is_open").eq("vehicle_id", id).order("gated_in_at", { ascending: false }),
  ]);
  const visits = (visitRows ?? []) as { id: string; job_number: string; status: JobStatus; gated_in_at: string; gated_out_at: string | null; is_open: boolean }[];

  const allPaths = [...photos.map((p) => p.storage_path), ...(v.photo_path ? [v.photo_path] : [])];
  const signed = allPaths.length ? await supabase.storage.from("vehicle-photos").createSignedUrls(allPaths, 3600) : { data: [] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const profileUrl = v.photo_path ? (urlByPath.get(v.photo_path) ?? null) : null;

  const title = [v.make?.name, v.model?.name, v.variant].filter(Boolean).join(" ");

  return (
    <>
      <PageHeader
        title={formatPlate(v)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{title || "Make and model not set"}</span>
            {vipRow?.is_vip ? <Badge tone="ink">VIP</Badge> : null}
            {!v.is_active ? <Badge tone="red">Inactive</Badge> : null}
          </span>
        }
        actions={canEdit ? <LinkButton href={`/vehicles/${v.id}/edit`}>Edit</LinkButton> : undefined}
      />

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {vipRow?.is_vip && vipRow.vip_note ? (
        <Card className="border-ink flex flex-col gap-1">
          <SectionLabel>VIP handling note</SectionLabel>
          <p className="text-[15px] font-medium whitespace-pre-wrap">{vipRow.vip_note}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <SectionLabel>Car picture</SectionLabel>
            <div className="flex flex-col xl:flex-row gap-5">
              <div className="w-full xl:w-96 shrink-0 aspect-[16/10] rounded-card bg-chip overflow-hidden">
                {profileUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profileUrl} alt={formatPlate(v)} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-sm font-semibold text-faint">No picture yet</div>
                )}
              </div>
              {canEdit ? (
                <div className="flex-1">
                  <ProfilePhotoForm action={setVehicleProfilePhoto.bind(null, v.id)} />
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Details</SectionLabel>
            <DescriptionList
              items={[
                { label: "Plate", value: formatPlate(v) },
                { label: "VIN", value: v.vin ? <span className="font-mono">{v.vin}</span> : null },
                { label: "Make and model", value: title || null },
                { label: "Model year", value: v.model_year },
                { label: "Colour", value: v.colour },
                { label: "Fuel", value: v.fuel_type ? v.fuel_type[0].toUpperCase() + v.fuel_type.slice(1) : null },
                { label: "Last known mileage", value: v.last_mileage != null ? `${v.last_mileage.toLocaleString("en-GB")} km` : null },
                { label: "Notes", value: v.notes ? <span className="whitespace-pre-wrap">{v.notes}</span> : null },
                { label: "Added", value: formatDateTime(v.created_at) },
                { label: "Last change", value: formatDateTime(v.updated_at) },
              ]}
            />
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${visits.length}`}>Visits</SectionLabel>
            {visits.length === 0 ? (
              <p className="text-sm text-muted">No job cards yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {visits.map((j) => (
                  <li key={j.id} className="py-2.5">
                    {can(role, "viewJobs") ? (
                      <Link href={`/jobs/${j.id}`} className="flex flex-wrap items-baseline gap-x-3 hover:underline underline-offset-4">
                        <span className="font-bold">{j.job_number}</span>
                        <span className="text-sm">{formatDateTime(j.gated_in_at)}</span>
                        <span className="text-sm text-muted">{STATUS_LABELS[j.status]}{j.gated_out_at ? ` · out ${formatDateTime(j.gated_out_at)}` : ""}</span>
                      </Link>
                    ) : (
                      <span className="flex flex-wrap items-baseline gap-x-3">
                        <span className="font-bold">{j.job_number}</span>
                        <span className="text-sm">{formatDateTime(j.gated_in_at)}</span>
                        <span className="text-sm text-muted">{STATUS_LABELS[j.status]}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section className="flex flex-col gap-3">
            <SectionLabel right={`${photos.length} photo${photos.length === 1 ? "" : "s"}`}>Photos</SectionLabel>
            {photos.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {photos.map((p) => {
                  const url = urlByPath.get(p.storage_path);
                  return (
                    <figure key={p.id} className="flex flex-col gap-1">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={p.caption ?? "Car photo"} className="aspect-square w-full rounded-card object-cover bg-chip" />
                        </a>
                      ) : (
                        <div className="aspect-square rounded-card bg-chip" />
                      )}
                      <figcaption className="text-xs text-muted">
                        {p.caption ? `${p.caption} · ` : ""}
                        {formatDateTime(p.taken_at)}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">No photos yet.</p>
            )}
            {canEdit ? (
              <Card>
                <PhotoUploadForm action={addVehiclePhoto.bind(null, v.id)} />
              </Card>
            ) : null}
            <p className="text-xs text-muted">Photos can be added but never changed or deleted.</p>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Owner</SectionLabel>
            {seesCustomers && v.customer ? (
              <Link href={`/customers/${v.customer.id}`} className="flex flex-col gap-0.5 hover:underline underline-offset-4">
                <span className="font-bold">{v.customer.company_name ?? v.customer.full_name}</span>
                {v.customer.company_name ? <span className="text-sm">{v.customer.full_name}</span> : null}
                <span className="text-sm text-muted">
                  {v.customer.phone} · {v.customer.customer_number}
                </span>
              </Link>
            ) : pub ? (
              <p className="font-bold">{pub.company_name ?? pub.full_name}</p>
            ) : (
              <p className="text-sm text-muted">Customer details are not shown for your role.</p>
            )}
          </Card>

          {canEdit ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Record</SectionLabel>
              <form action={setVehicleActive.bind(null, v.id, !v.is_active)}>
                <Button type="submit" tone={v.is_active ? "danger" : "secondary"} className="w-full">
                  {v.is_active ? "Mark car inactive" : "Re-activate car"}
                </Button>
              </form>
              <p className="text-xs text-muted">Use this when a car is sold or scrapped. Its history stays on record.</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
