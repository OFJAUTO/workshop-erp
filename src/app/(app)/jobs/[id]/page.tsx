import Link from "next/link";
import { notFound } from "next/navigation";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { StageTrack } from "@/components/StageTrack";
import { Badge, Button, Card, DescriptionList, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { ARRIVED_BY, CLEANLINESS, CONDITIONS, FUEL_LEVELS, MANUAL_STATUS_OPTIONS, STATUS_LABELS, formatPromised, jobTiming, labelOf } from "@/lib/jobs";
import { mediaChecklist } from "@/lib/media";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { assignJob, moveJob, setJobPriority } from "../actions";
import { ApprovalPanel } from "./ApprovalPanel";
import { MediaGallery } from "./MediaGallery";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string; error?: string; link?: string; to?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { message, error, link, to } = await searchParams;
  const role = staff.role_id as RoleId;

  const supabase = await createClient();
  const card = await loadJobCard(supabase, id);
  if (!card) notFound();
  const { job, vehicle, customer, vip, gateIn, media, events, approvals, gateOut } = card;
  const check = mediaChecklist(media);
  const timing = jobTiming(job.promised_at, job.is_open);
  const isVip = customer?.is_vip ?? vip?.is_vip ?? false;
  const vipNote = customer?.vip_note ?? vip?.vip_note ?? null;

  const canAssign = can(role, "assignJobs") && job.is_open;
  const canMove = can(role, "moveJobs") && job.is_open && job.status !== "gate_in_pending";
  const canEditGateIn = can(role, "editGateIn") && job.is_open;
  const canSend = can(role, "sendApproval") && job.is_open;
  const canGateOut = can(role, "gateOut") && job.is_open && job.status !== "gate_in_pending";
  const isTechnician = role === "technician";

  const { data: technicians } = canAssign
    ? await supabase.from("staff").select("id, display_name, department_id").eq("is_active", true).eq("role_id", "technician").order("display_name")
    : { data: [] as { id: string; display_name: string; department_id: string | null }[] };

  const latestApproval = approvals[0] ?? null;

  return (
    <>
      <PageHeader
        title={formatPlate(vehicle)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicleTitle(vehicle)}</span>
            <span>· {job.job_number}</span>
            {isVip ? <Badge tone="ink">VIP</Badge> : null}
            <PriorityBadge priority={job.priority} />
            <TimingBadge timing={timing} />
            {!job.is_open ? <Badge tone="neutral">Closed</Badge> : null}
          </span>
        }
        actions={
          <>
            {canEditGateIn && !check.complete ? (
              <LinkButton href={`/jobs/${id}/media`} size="lg">
                Add video and photos
              </LinkButton>
            ) : null}
            {canGateOut ? (
              <LinkButton href={`/jobs/${id}/gate-out`} tone="secondary" size="lg">
                Gate out
              </LinkButton>
            ) : null}
          </>
        }
      />

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {gateIn?.dash_cam && isTechnician ? (
        <Notice tone="error">Dash cam fitted: disconnect before starting work.</Notice>
      ) : null}
      {isVip && vipNote ? (
        <Card className="border-ink flex flex-col gap-1">
          <SectionLabel>VIP handling note</SectionLabel>
          <p className="text-[15px] font-medium whitespace-pre-wrap">{vipNote}</p>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-lg font-extrabold">{STATUS_LABELS[job.status]}</span>
          <span className="text-sm text-muted">
            {job.promised_at ? `Promised ${formatPromised(job.promised_at)}` : "No promised date"}
            {card.assignee ? ` · ${card.assignee.display_name}` : " · Not assigned"}
          </span>
        </div>
        <StageTrack stage={job.stage} timing={timing} />
        {job.status === "gate_in_pending" ? (
          <p className="text-sm font-semibold text-amber">
            Incomplete, video pending. The approval link cannot be sent and the car cannot be assigned until the video, dashboard photo and keys photo are uploaded.
          </p>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel>Gate-in</SectionLabel>
              {canEditGateIn ? (
                <LinkButton href={`/jobs/${id}/gate-in/edit`} tone="ghost" size="md">
                  Amend
                </LinkButton>
              ) : null}
            </div>
            {gateIn ? (
              <DescriptionList
                items={[
                  { label: "Gated in", value: `${formatDateTime(job.gated_in_at)} by ${card.gatedInBy ?? "unknown"}` },
                  { label: "Arrived by", value: labelOf(ARRIVED_BY, gateIn.arrived_by) },
                  { label: "Condition", value: labelOf(CONDITIONS, gateIn.condition) },
                  {
                    label: vehicle.fuel_type === "electric" ? "Battery" : "Fuel level",
                    value: vehicle.fuel_type === "electric" ? (gateIn.battery_percent != null ? `${gateIn.battery_percent}%` : null) : labelOf(FUEL_LEVELS, gateIn.fuel_level),
                  },
                  { label: "Cleanliness", value: labelOf(CLEANLINESS, gateIn.cleanliness) },
                  { label: "Dash cam", value: gateIn.dash_cam ? "Fitted, to be disconnected" : "Not fitted" },
                  { label: "Mileage", value: `${gateIn.mileage.toLocaleString("en-GB")} km` },
                  { label: "Keys", value: `${gateIn.keys_count} key${gateIn.keys_count === 1 ? "" : "s"}, ${gateIn.keys_keychain ? "with keychain" : "no keychain"}` },
                  { label: "Old parts returned to customer", value: gateIn.old_parts_return ? "Yes" : "No" },
                  { label: "Customer requests", value: <span className="whitespace-pre-wrap">{gateIn.customer_requests}</span> },
                  { label: "Notes", value: gateIn.notes ? <span className="whitespace-pre-wrap">{gateIn.notes}</span> : null },
                ]}
              />
            ) : (
              <p className="text-sm text-muted">No gate-in record.</p>
            )}
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel right={`${media.length}`}>Video and photos</SectionLabel>
              {canEditGateIn && job.is_open ? (
                <LinkButton href={`/jobs/${id}/media`} tone="ghost" size="md">
                  Add more
                </LinkButton>
              ) : null}
            </div>
            <MediaGallery media={media} urls={Object.fromEntries(card.mediaUrls)} />
          </Card>

          {gateOut ? (
            <Card className="flex flex-col gap-4">
              <SectionLabel>Gate-out</SectionLabel>
              <DescriptionList
                items={[
                  { label: "Gated out", value: `${formatDateTime(job.gated_out_at)} by ${card.gatedOutBy ?? "unknown"}` },
                  { label: "Keys returned", value: `${gateOut.keys_returned}, ${gateOut.keychain_returned ? "with keychain" : "no keychain"}${gateOut.keys_match ? "" : " (did not match gate-in)"}` },
                  { label: "Keys override", value: gateOut.keys_override_reason },
                  { label: "Dash cam reconnected", value: gateOut.dash_cam_reconnected == null ? "Not fitted" : gateOut.dash_cam_reconnected ? "Yes" : "No" },
                  { label: "Notes", value: gateOut.notes },
                ]}
              />
            </Card>
          ) : null}

          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${events.length}`}>History</SectionLabel>
            <ul className="flex flex-col divide-y divide-line">
              {events.map((e) => (
                <li key={e.id} className="py-2.5 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                  <span className="text-xs text-muted sm:w-36 shrink-0">{formatDateTime(e.created_at)}</span>
                  <span className="text-sm">
                    <span className="font-semibold">{e.by_name ?? "System"}</span>
                    {" · "}
                    {e.note ??
                      (e.to_status ? `${e.from_status ? STATUS_LABELS[e.from_status as keyof typeof STATUS_LABELS] + " → " : ""}${STATUS_LABELS[e.to_status as keyof typeof STATUS_LABELS]}` : e.event_type)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Customer</SectionLabel>
            {customer ? (
              <Link href={`/customers/${customer.id}`} className="flex flex-col gap-0.5 hover:underline underline-offset-4">
                <span className="font-bold">{customer.company_name ?? customer.full_name}</span>
                <span className="text-sm text-muted">
                  {customer.phone} · {customer.customer_number}
                </span>
              </Link>
            ) : (
              <p className="text-sm text-muted">Customer details are not shown for your role.</p>
            )}
            <Link href={`/vehicles/${vehicle.id}`} className="text-sm underline underline-offset-4">
              Car details and history
            </Link>
          </Card>

          {canSend || approvals.length ? (
            <ApprovalPanel
              jobId={id}
              canSend={canSend}
              complete={check.complete}
              latest={latestApproval}
              approvedAt={job.first_approval_at}
              link={link ?? null}
              sentTo={to ?? null}
              customer={customer ? { name: customer.company_name ?? customer.full_name, phone: customer.phone } : null}
              contacts={customer ? await loadApproverContacts(customer.id) : []}
            />
          ) : null}

          {canAssign ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Assign technician</SectionLabel>
              <form action={assignJob.bind(null, id)} className="flex flex-col gap-3">
                <Select name="technician" defaultValue={job.assigned_to ?? ""} required>
                  <option value="" disabled>
                    Choose a technician…
                  </option>
                  {(technicians ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" tone="secondary" disabled={!check.complete}>
                  {job.assigned_to ? "Reassign" : "Assign"}
                </Button>
                {!check.complete ? <p className="text-xs text-amber font-semibold">Blocked until the gate-in media is complete.</p> : null}
                {check.complete && !job.first_approval_at ? <p className="text-xs text-muted">The customer has not yet approved the job card.</p> : null}
              </form>
            </Card>
          ) : null}

          {canMove ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Move to step</SectionLabel>
              <form action={moveJob.bind(null, id)} className="flex flex-col gap-3">
                <Select name="status" defaultValue={job.status}>
                  {MANUAL_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
                <Button type="submit" tone="secondary">
                  Move
                </Button>
                <p className="text-xs text-muted">Manual moves are logged. Later phases move cars automatically.</p>
              </form>
            </Card>
          ) : null}

          {can(role, "setPriority") && job.is_open ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Priority</SectionLabel>
              <form action={setJobPriority.bind(null, id)} className="flex gap-2">
                {(["high", "normal", "low"] as const).map((p) => (
                  <Button key={p} type="submit" name="priority" value={p} tone={job.priority === p ? "primary" : "secondary"} size="md" className="flex-1">
                    {p[0].toUpperCase() + p.slice(1)}
                  </Button>
                ))}
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

async function loadApproverContacts(customerId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_contacts")
    .select("id, name, phone, can_approve")
    .eq("customer_id", customerId)
    .eq("is_active", true)
    .eq("can_approve", true)
    .order("name");
  return (data ?? []) as { id: string; name: string; phone: string; can_approve: boolean }[];
}
