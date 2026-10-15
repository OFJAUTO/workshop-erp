"use server";

import { chooserValues, resolveCustomerCar } from "@/lib/customer-car";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { requirePermission } from "@/lib/auth";
import { logQuoteEvent } from "@/lib/quote-data";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/** An estimate before the car arrives: customer and car, then lines on the builder. */
export async function createEstimate(_state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("viewEstimates");
  const values = formValues(formData);
  // The customer and the car from the three-choice chooser (created here when they are new).
  const picked = await resolveCustomerCar(formData, staff);
  if ("error" in picked) return { error: picked.error, values: chooserValues(values, picked) };
  const { customerId, vehicleId } = picked;
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: "estimate", customer_id: customerId, vehicle_id: vehicleId, validity_days: Number(settings.quote_validity_days) || 7, created_by: staff.id, updated_by: staff.id })
    .select("id, number")
    .single();
  if (error || !created) return { error: error?.message ?? "Could not create the estimate.", values };
  await logQuoteEvent(created.id, null, staff.id, "estimate_started", `Estimate ${created.number} started by ${staff.display_name}`);
  revalidatePath("/estimates");
  redirect(`/estimates/${created.id}`);
}
