import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { DEPARTMENT_LABELS, type DepartmentId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { saveSettings } from "./actions";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  await requirePermission("manageSettings");
  const supabase = await createClient();
  const [{ data }, { data: makes }] = await Promise.all([
    supabase.from("settings").select("key, value"),
    supabase.from("vehicle_makes").select("name").eq("is_active", true).order("name"),
  ]);

  const initial: Record<string, string> = {};
  let makeOverrides: Record<string, number> = {};
  let departmentOverrides: Record<string, number> = {};
  let workingDays: string[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
  for (const row of data ?? []) {
    if (row.key === "parts_min_markup_by_make") makeOverrides = (row.value as Record<string, number>) ?? {};
    else if (row.key === "technician_cost_rate_by_department") departmentOverrides = (row.value as Record<string, number>) ?? {};
    else if (row.key === "working_days") workingDays = Array.isArray(row.value) ? (row.value as string[]) : workingDays;
    else initial[row.key] = typeof row.value === "string" ? row.value : String(row.value ?? "");
  }

  const departments = (Object.keys(DEPARTMENT_LABELS) as DepartmentId[]).map((id) => ({ id, label: DEPARTMENT_LABELS[id] }));

  return (
    <>
      <PageHeader title="Settings" subtitle="Changes apply immediately, without a rebuild. Every change is logged." />
      <div className="max-w-5xl">
        <SettingsForm
          action={saveSettings}
          initialValues={initial}
          makes={(makes ?? []).map((m) => m.name)}
          departments={departments}
          makeOverrides={makeOverrides}
          departmentOverrides={departmentOverrides}
          workingDays={workingDays}
        />
      </div>
    </>
  );
}
