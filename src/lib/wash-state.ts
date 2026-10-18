import "server-only";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

export type WashCar = { id: string; plate: string; title: string };
export type WashState = { inWash: WashCar[]; waiting: WashCar[] };

/** Who is at the wash right now: the cars sent and not done, and the ones waiting to be sent (this job left out). */
export async function washStateNow(excludeJobId?: string | null): Promise<WashState> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select("id, job_number, wash_sent_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))")
    .eq("status", "pending_wash")
    .eq("is_open", true);
  const rows = ((data ?? []) as unknown as { id: string; job_number: string; wash_sent_at: string | null; vehicle: (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null }) | null }[]).map((j) => ({
    id: j.id,
    sent: !!j.wash_sent_at,
    plate: j.vehicle ? formatPlate(j.vehicle) : j.job_number,
    title: j.vehicle ? [j.vehicle.make?.name, j.vehicle.model?.name].filter(Boolean).join(" ") : "",
  }));
  return {
    inWash: rows.filter((r) => r.sent).map(({ id, plate, title }) => ({ id, plate, title })),
    waiting: rows.filter((r) => !r.sent && r.id !== excludeJobId).map(({ id, plate, title }) => ({ id, plate, title })),
  };
}
