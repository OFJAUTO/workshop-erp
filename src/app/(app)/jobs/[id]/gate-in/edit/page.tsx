import { notFound } from "next/navigation";
import { Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { updateGateIn } from "../../../actions";
import { GateInForm } from "../../../../gate-in/GateInForm";

export default async function AmendGateInPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("editGateIn");
  const { id } = await params;
  const supabase = await createClient();
  const card = await loadJobCard(supabase, id);
  if (!card || !card.gateIn) notFound();
  const g = card.gateIn;

  return (
    <>
      <PageHeader title={`Amend gate-in · ${formatPlate(card.vehicle)}`} subtitle={`${vehicleTitle(card.vehicle)} · ${card.job.job_number}`} />
      <Notice tone="info">
        Gate-in time and the person who gated the car in cannot be changed. Every other correction is logged with the original value, the new value, who and when.
      </Notice>
      <div className="max-w-3xl">
        <GateInForm
          action={updateGateIn.bind(null, id)}
          isElectric={card.vehicle.fuel_type === "electric"}
          mode="edit"
          requests={card.requests.map((r) => r.text)}
          requestsLocked={g.is_complete}
          mileageUnit={g.mileage_unit ?? "km"}
          mileageContext={{ modelYear: card.vehicle.model_year, lastKm: null, lastVisitAt: null }}
          initialValues={{
            department: card.job.department ?? "",
            vip: card.customer?.is_vip ?? card.vip?.is_vip ? "on" : "",
            vip_note: card.customer?.vip_note ?? card.vip?.vip_note ?? "",
            arrived_by: g.arrived_by,
            condition: g.condition,
            fuel_level: g.fuel_level ?? "",
            battery_percent: g.battery_percent?.toString() ?? "",
            cleanliness: g.cleanliness,
            dash_cam: g.dash_cam ? "yes" : "no",
            major_damage: g.major_damage ? "yes" : "no",
            mileage_entered: String(g.mileage_unit === "mi" ? (g.mileage_miles ?? Math.round(g.mileage / 1.609344)) : g.mileage),
            mileage_unit: g.mileage_unit ?? "km",
            keys_count: g.keys_count.toString(),
            keys_keychain: g.keys_keychain ? "yes" : "no",
            notes: g.notes ?? "",
            old_parts_return: g.old_parts_return ? "yes" : "no",
            priority: card.job.priority,
            promised_at: card.job.promised_at ?? "",
          }}
        />
      </div>
    </>
  );
}
