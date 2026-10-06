import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createVehicle } from "../actions";
import { loadVehicleFormData } from "../data";
import { VehicleForm } from "../VehicleForm";

export default async function NewVehiclePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  await requirePermission("editVehicles");
  const { customer } = await searchParams;
  const lists = await loadVehicleFormData();

  return (
    <>
      <PageHeader title="Add car" />
      <Card className="max-w-3xl">
        <VehicleForm
          action={createVehicle}
          mode="create"
          initialValues={{ customer_id: customer ?? "", plate_country: "UAE", plate_emirate: "Dubai" }}
          {...lists}
        />
      </Card>
    </>
  );
}
