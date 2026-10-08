import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { dubaiDateOf, dubaiTimeOf } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import { updateAppointment } from "../../actions";
import { AppointmentForm } from "../../AppointmentForm";
import { APPOINTMENT_SELECT, appointmentCustomerName, canEditAppointment, loadAppointmentFormData, type AppointmentFull } from "../../form-data";

export default async function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("bookAppointments");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data }, formData] = await Promise.all([supabase.from("appointments").select(APPOINTMENT_SELECT).eq("id", id).maybeSingle(), loadAppointmentFormData(supabase)]);
  if (!data) notFound();
  const a = data as unknown as AppointmentFull;
  if (!canEditAppointment(staff, a)) redirect(`/calendar/${id}?error=${encodeURIComponent("Only the person this booking belongs to, or the owner, can change it.")}`);

  return (
    <>
      <PageHeader title="Change booking" subtitle={`${appointmentCustomerName(a)} · ${a.reason}`} />
      <AppointmentForm
        action={updateAppointment.bind(null, id)}
        customers={formData.customers}
        vehicles={formData.vehicles}
        advisors={formData.advisors}
        jobs={formData.jobs}
        initialValues={{
          kind: a.kind,
          department: a.department ?? "",
          customer_mode: "existing",
          customer_id: a.customer_id,
          vehicle_id: a.vehicle_id ?? "",
          vehicle_text: a.vehicle_text ?? "",
          job_id: a.job_id ?? "",
          reason: a.reason,
          collect_address: a.collect_address ?? "",
          collect_method: a.collect_method ?? "",
          date: dubaiDateOf(a.starts_at),
          time: dubaiTimeOf(a.starts_at),
          duration_minutes: String(a.duration_minutes),
          advisor_id: a.advisor_id ?? "",
          notes: a.notes ?? "",
        }}
        submitLabel="Save changes"
      />
    </>
  );
}
