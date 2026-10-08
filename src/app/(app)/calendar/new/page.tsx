import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { isDateString } from "@/lib/calendar";
import { dubaiDate } from "@/lib/jobs";
import { createClient } from "@/lib/supabase/server";
import { createAppointment } from "../actions";
import { AppointmentForm } from "../AppointmentForm";
import { loadAppointmentFormData } from "../form-data";

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ date?: string; customer?: string; vehicle?: string }> }) {
  const staff = await requirePermission("bookAppointments");
  const sp = await searchParams;
  const supabase = await createClient();
  const data = await loadAppointmentFormData(supabase);
  const date = isDateString(sp.date) ? sp.date : dubaiDate();
  const advisorId = staff.role_id === "service_advisor" || staff.role_id === "owner" ? staff.id : "";
  const vehicle = sp.vehicle ? data.vehicles.find((v) => v.id === sp.vehicle) : undefined;
  const customerId = vehicle?.customerId ?? sp.customer ?? "";

  return (
    <>
      <PageHeader title="New booking" subtitle="Choose the type first. The customer gets a WhatsApp reminder the day before; you get a bell reminder the day before and an hour before." />
      <AppointmentForm
        action={createAppointment}
        customers={data.customers}
        vehicles={data.vehicles}
        advisors={data.advisors}
        jobs={data.jobs}
        initialValues={{ date, time: "09:00", duration_minutes: "30", advisor_id: advisorId, customer_id: customerId, vehicle_id: vehicle?.id ?? "" }}
        submitLabel="Save booking"
      />
    </>
  );
}
