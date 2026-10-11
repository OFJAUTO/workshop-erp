import { LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { saveInspectionChecklist, saveManagerNotePresets } from "../actions";
import { ChecklistEditor } from "./ChecklistEditor";
import { ManagerNotesForm } from "./ManagerNotesForm";

export const dynamic = "force-dynamic";

export default async function InspectionChecklistPage() {
  await requirePermission("manageSettings");
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="Inspection checklist"
        subtitle="Sections and items of the technician's report. A part of the car is marked Good, Average or Bad; a service item is OK or Required (tap the style on each item). The numbers (tyres, brake pads, battery, vent temperature) and the scan report are always required and are not on this list."
        actions={<LinkButton href="/settings" tone="secondary">Settings</LinkButton>}
      />
      <ManagerNotesForm action={saveManagerNotePresets} initial={(settings.manager_note_presets ?? []) as string[]} usage={(settings.manager_note_usage ?? {}) as Record<string, number>} />
      <ChecklistEditor action={saveInspectionChecklist} initial={settings.inspection_checklist} initialComplaints={(settings.complaint_keywords ?? {}) as Record<string, string[]>} />
    </>
  );
}
