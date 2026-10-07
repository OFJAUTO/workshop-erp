import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { DEPARTMENT_LABELS, type DepartmentId } from "@/lib/roles";
import { formatBytes, storageUsage } from "@/lib/storage-usage";
import { createClient } from "@/lib/supabase/server";
import { saveSettings } from "./actions";
import { SettingsForm } from "./SettingsForm";

const BUCKET_LABEL: Record<string, string> = { "gate-in-media": "Gate-in videos and photos", "vehicle-photos": "Car pictures", "staff-photos": "Staff photos" };

export default async function SettingsPage() {
  await requirePermission("manageSettings");
  const supabase = await createClient();
  const [{ data }, { data: makes }, { count: reviewMakes }, { count: reviewModels }, usage] = await Promise.all([
    supabase.from("settings").select("key, value"),
    supabase.from("vehicle_makes").select("name").eq("is_active", true).order("name"),
    supabase.from("vehicle_makes").select("id", { count: "exact", head: true }).eq("needs_review", true),
    supabase.from("vehicle_models").select("id", { count: "exact", head: true }).eq("needs_review", true),
    storageUsage(),
  ]);

  const initial: Record<string, string> = {};
  let makeOverrides: Record<string, number> = {};
  let departmentOverrides: Record<string, number> = {};
  let workingDays: string[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
  let stageHours: Record<string, number> = {};
  let branchesText = "";
  for (const row of data ?? []) {
    if (row.key === "parts_min_markup_by_make") makeOverrides = (row.value as Record<string, number>) ?? {};
    else if (row.key === "technician_cost_rate_by_department") departmentOverrides = (row.value as Record<string, number>) ?? {};
    else if (row.key === "working_days") workingDays = Array.isArray(row.value) ? (row.value as string[]) : workingDays;
    else if (row.key === "stage_target_hours") stageHours = (row.value as Record<string, number>) ?? {};
    else if (row.key === "branches") branchesText = ((row.value as { name: string; address: string }[]) ?? []).map((b) => `${b.name} | ${b.address}`).join("\n");
    else initial[row.key] = typeof row.value === "string" ? row.value : String(row.value ?? "");
  }

  const departments = (Object.keys(DEPARTMENT_LABELS) as DepartmentId[]).map((id) => ({ id, label: DEPARTMENT_LABELS[id] }));
  const pendingReview = (reviewMakes ?? 0) + (reviewModels ?? 0);
  const totalBytes = usage.reduce((a, b) => a + b.bytes, 0);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Changes apply immediately, without a rebuild. Every change is logged."
        actions={
          <LinkButton href="/settings/catalog" tone="secondary">
            Makes and models{pendingReview ? ` · ${pendingReview} to review` : ""}
          </LinkButton>
        }
      />
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3">
          <SettingsForm
            action={saveSettings}
            initialValues={initial}
            makes={(makes ?? []).map((m) => m.name)}
            departments={departments}
            makeOverrides={makeOverrides}
            departmentOverrides={departmentOverrides}
            workingDays={workingDays}
            stageHours={stageHours}
            branchesText={branchesText}
          />
        </div>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel right={formatBytes(totalBytes)}>Storage used</SectionLabel>
            <ul className="flex flex-col divide-y divide-line text-sm">
              {usage.map((u) => (
                <li key={u.bucket} className="py-2 flex justify-between gap-3">
                  <span>{BUCKET_LABEL[u.bucket] ?? u.bucket}</span>
                  <span className="font-semibold">
                    {formatBytes(u.bytes)} <span className="text-muted font-normal">· {u.files} files</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Videos older than the retention period are removed every hour by the scheduled clean-up. Photos are never removed.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
