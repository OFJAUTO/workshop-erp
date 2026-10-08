import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, DescriptionList, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { APPOINTMENT_STATUS_LABELS, dubaiDateOf, dubaiTimeOf, fillTemplate, formatDayHeading, formatShortDay } from "@/lib/calendar";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { markReminderSent, setAppointmentStatus } from "../actions";
import { APPOINTMENT_SELECT, appointmentCarText, appointmentCustomerName, type AppointmentFull } from "../form-data";

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message } = await searchParams;
  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([supabase.from("appointments").select(APPOINTMENT_SELECT).eq("id", id).maybeSingle(), getSettings()]);
  if (!data) notFound();
  const a = data as unknown as AppointmentFull;
  const canBook = can(role, "bookAppointments");
  const canGateIn = can(role, "gateIn");
  const date = dubaiDateOf(a.starts_at);
  const digits = (a.customer?.phone ?? "").replace(/[^\d]/g, "");
  const reminder = fillTemplate(settings.whatsapp_reminder_template, {
    name: a.customer?.full_name ?? "Customer",
    date: formatShortDay(date),
    time: dubaiTimeOf(a.starts_at),
    reason: a.reason,
    car: appointmentCarText(a),
    advisor: a.advisor?.display_name ?? staff.display_name,
  });
  const gateInHref = a.vehicle_id ? `/gate-in/new?vehicle=${a.vehicle_id}&appointment=${a.id}` : `/gate-in/new-car?appointment=${a.id}`;
  const statusTone = { booked: "outline", arrived: "green", no_show: "red", cancelled: "neutral" } as const;

  return (
    <>
      <PageHeader
        title={`${dubaiTimeOf(a.starts_at)} · ${appointmentCustomerName(a)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{formatDayHeading(date)}</span>
            <Badge tone={statusTone[a.status]}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
            {a.customer?.is_vip ? <Badge tone="ink">VIP</Badge> : null}
          </span>
        }
        actions={
          <>
            {a.job_id ? (
              <LinkButton href={`/jobs/${a.job_id}`} size="lg">
                Open job card{a.job ? ` ${a.job.job_number}` : ""}
              </LinkButton>
            ) : canGateIn && a.status !== "cancelled" ? (
              <LinkButton href={gateInHref} size="lg">
                Start gate-in
              </LinkButton>
            ) : null}
            {canBook ? (
              <LinkButton href={`/calendar/${a.id}/edit`} tone="secondary" size="lg">
                Change
              </LinkButton>
            ) : null}
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 flex flex-col gap-4">
          <SectionLabel>Appointment</SectionLabel>
          <DescriptionList
            items={[
              { label: "Customer", value: <Link href={`/customers/${a.customer_id}`} className="font-semibold hover:underline underline-offset-4">{appointmentCustomerName(a)}</Link> },
              { label: "Phone", value: a.customer?.phone ?? null },
              { label: "Car", value: a.vehicle_id ? <Link href={`/vehicles/${a.vehicle_id}`} className="font-semibold hover:underline underline-offset-4">{appointmentCarText(a)}</Link> : appointmentCarText(a) },
              { label: "Reason for visit", value: a.reason },
              { label: "When", value: `${formatDayHeading(date)} at ${dubaiTimeOf(a.starts_at)}, ${a.duration_minutes} min` },
              { label: "Advisor", value: a.advisor?.display_name ?? "Not assigned yet" },
              ...(a.notes ? [{ label: "Notes", value: <span className="whitespace-pre-wrap">{a.notes}</span> }] : []),
              ...(a.cancel_reason ? [{ label: "Cancelled because", value: a.cancel_reason }] : []),
              { label: "Booked", value: formatDateTime(a.created_at) },
            ]}
          />
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Reminder</SectionLabel>
            {a.reminder_sent_at ? (
              <Notice tone="success">Reminder sent on {formatDateTime(a.reminder_sent_at)}.</Notice>
            ) : (
              <p className="text-sm text-muted">Send it the day before. The message is ready; WhatsApp opens with it filled in.</p>
            )}
            <p className="text-sm whitespace-pre-wrap rounded-control bg-chip px-3 py-2">{reminder}</p>
            {canBook && a.status === "booked" ? (
              <div className="flex flex-wrap gap-2">
                <a href={`https://wa.me/${digits}?text=${encodeURIComponent(reminder)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white">
                  Open WhatsApp
                </a>
                {!a.reminder_sent_at ? (
                  <form action={markReminderSent.bind(null, a.id)}>
                    <Button type="submit" tone="secondary" size="md">
                      Mark sent
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </Card>

          {canBook && !a.job_id ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Status</SectionLabel>
              {a.status === "booked" ? (
                <>
                  <form action={setAppointmentStatus.bind(null, a.id)}>
                    <input type="hidden" name="status" value="no_show" />
                    <Button type="submit" tone="secondary" size="md" className="w-full">
                      Customer did not show up
                    </Button>
                  </form>
                  <form action={setAppointmentStatus.bind(null, a.id)} className="flex flex-col gap-2">
                    <input type="hidden" name="status" value="cancelled" />
                    <Input name="cancel_reason" placeholder="Reason for cancelling (optional)" />
                    <Button type="submit" tone="danger" size="md" className="w-full">
                      Cancel appointment
                    </Button>
                  </form>
                </>
              ) : (
                <form action={setAppointmentStatus.bind(null, a.id)}>
                  <input type="hidden" name="status" value="booked" />
                  <Button type="submit" tone="secondary" size="md" className="w-full">
                    Put it back to booked
                  </Button>
                </form>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
