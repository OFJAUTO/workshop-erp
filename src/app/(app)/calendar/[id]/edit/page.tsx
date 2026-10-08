import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { dubaiDateOf, dubaiTimeOf } from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import { updateAppointment } from "../../actions";
import { AppointmentForm } from "../../AppointmentForm";
import { APPOINTMENT_SELECT, appointmentCustomerName, loadAppointmentFormData, type AppointmentFull } from "../../form-data";

export default async function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("bookAppointments");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data }, formData] = await Promise.all([supabase.from("appointments").select(APPOINTMENT_SELECT).eq("id", id).maybeSingle(), loadAppointmentFormData(supabase)]);
  if (!data) notFound();
  const a = data as unknown as AppointmentFull;

  return (
    <>
      <PageHeader title="Change appointment" subtitle={`${appointmentCustomerName(a)} · ${a.reason}`} />
      <AppointmentForm
        action={updateAppointment.bind(null, id)}
        customers={formData.customers}
        vehicles={formData.vehicles}
        advisors={formData.advisors}
        initialValues={{
          customer_mode: "existing",
          customer_id: a.customer_id,
          vehicle_id: a.vehicle_id ?? "",
          vehicle_text: a.vehicle_text ?? "",
          reason: a.reason,
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
