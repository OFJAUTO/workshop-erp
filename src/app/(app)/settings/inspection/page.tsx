import { LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { saveInspectionChecklist } from "../actions";
import { ChecklistEditor } from "./ChecklistEditor";

export const dynamic = "force-dynamic";

export default async function InspectionChecklistPage() {
  await requirePermission("manageSettings");
  const settings = await getSettings();
  return (
    <>
      <PageHeader title="Inspection checklist" subtitle="Sections and items the technician marks GOOD, AVERAGE or BAD. The numbers (tyres, brake pads, battery, vent temperature) and the pre-scan PDF are always required and are not on this list." actions={<LinkButton href="/settings" tone="secondary">Back to settings</LinkButton>} />
      <ChecklistEditor action={saveInspectionChecklist} initial={settings.inspection_checklist} />
    </>
  );
}
