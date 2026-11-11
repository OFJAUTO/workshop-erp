"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { isDeviceDepartment } from "@/lib/device-department";
import { schemaReady } from "@/lib/schema-ready";
import { createAdminClient } from "@/lib/supabase/admin";

/** A shared tablet's department (11 November 2026, Section 8): the owner only, logged. */
export async function setDeviceDepartment(deviceId: string, formData: FormData) {
  const staff = await requireStaff();
  const back = (q: string): never => redirect(`/team/tablets?${q}`);
  if (staff.role_id !== "owner" || staff.viewingAs) return back(`error=${encodeURIComponent("Only the owner changes a tablet's department.")}`);
  const department = String(formData.get("department") ?? "");
  if (!isDeviceDepartment(department)) return back(`error=${encodeURIComponent("Choose Workshop, Bodyshop or Both.")}`);
  if (!(await schemaReady("devices", "department"))) return back(`error=${encodeURIComponent("Tablet departments switch on once the database change is applied.")}`);
  const admin = createAdminClient();
  const { data: d } = await admin.from("devices").select("name, department").eq("id", deviceId).maybeSingle();
  const { error } = await admin.from("devices").update({ department, updated_by: staff.id }).eq("id", deviceId);
  if (error) return back(`error=${encodeURIComponent("Couldn't save – try again.")}`);
  await admin.from("audit_log").insert({ table_name: "devices", record_id: deviceId, action: "UPDATE", changed_by: staff.id, old_data: { department: d?.department ?? null }, new_data: { department } }).then(() => null, () => null);
  revalidatePath("/team/tablets");
  return back(`message=${encodeURIComponent(`${d?.name ?? "Tablet"}: department ${department}.`)}`);
}
