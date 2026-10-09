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
  let labourOverrides: Record<string, number> = {};
  let labourByMake: Record<string, number> = {};
  let qcChecksText = "";
  let workingDays: string[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
  let stageHours: Record<string, number> = {};
  let branchesText = "";
  const listTexts: Record<string, string> = {};
  let limits: Record<string, number> = { tread_max: 12, pads_max: 20, battery_max: 16, vent_min: -5, vent_max: 40, fluid_max: 30, tyre_years: 15 };
  let prescanGate = false;
  let inboundToken = "";
  let labourJobsText = "";
  let candidates: Record<string, number> = {};
  const flags: Record<string, boolean> = { wash_board_show_times: false, wash_board_done_button: false };
  for (const row of data ?? []) {
    if (row.key === "parts_min_markup_by_make") makeOverrides = (row.value as Record<string, number>) ?? {};
    else if (row.key === "technician_cost_rate_by_department") departmentOverrides = (row.value as Record<string, number>) ?? {};
    else if (row.key === "labour_rate_by_department") labourOverrides = (row.value as Record<string, number>) ?? {};
    else if (row.key === "labour_rate_by_make") labourByMake = (row.value as Record<string, number>) ?? {};
    else if (row.key === "qc_general_checks") qcChecksText = Array.isArray(row.value) ? (row.value as string[]).join("\n") : "";
    else if (row.key === "working_days") workingDays = Array.isArray(row.value) ? (row.value as string[]) : workingDays;
    else if (row.key === "stage_target_hours") stageHours = (row.value as Record<string, number>) ?? {};
    else if (row.key === "branches") branchesText = ((row.value as { name: string; address: string }[]) ?? []).map((b) => `${b.name} | ${b.address}`).join("\n");
    else if (row.key === "inspection_checklist" || row.key === "item_suggestions" || row.key === "labour_hours_memory") continue;
    else if (["part_types", "labour_actions", "labour_positions", "big_job_tags", "fluid_grades"].includes(row.key)) listTexts[row.key] = Array.isArray(row.value) ? (row.value as string[]).join("\n") : "";
    else if (row.key === "inspection_limits") limits = { ...limits, ...((row.value as Record<string, number>) ?? {}) };
    else if (row.key === "prescan_gate_enabled") prescanGate = row.value === true;
    else if (row.key === "wash_board_show_times" || row.key === "wash_board_done_button") flags[row.key] = row.value === true;
    else if (row.key === "labour_jobs") labourJobsText = Object.entries((row.value as Record<string, string[]>) ?? {}).map(([g, list]) => `${g}:\n${(list ?? []).join("\n")}`).join("\n\n");
    else if (row.key === "labour_job_candidates") candidates = (row.value as Record<string, number>) ?? {};
    else if (row.key === "recovery_providers" || row.key === "labour_hours_memory") continue;
    else if (row.key === "inbound_scan_token") inboundToken = typeof row.value === "string" ? row.value : "";
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
          <>
            <LinkButton href="/settings/services" tone="secondary">
              Services
            </LinkButton>
            <LinkButton href="/parts/labels/test?test=1" tone="secondary">
              Test print a label
            </LinkButton>
            <LinkButton href="/settings/inspection" tone="secondary">
              Inspection checklist
            </LinkButton>
            <LinkButton href="/settings/catalog" tone="secondary">
              Makes and models{pendingReview ? ` · ${pendingReview} to review` : ""}
            </LinkButton>
          </>
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
            labourOverrides={labourOverrides}
            labourByMake={labourByMake}
            qcChecksText={qcChecksText}
            workingDays={workingDays}
            stageHours={stageHours}
            branchesText={branchesText}
            listTexts={listTexts}
            limits={limits}
            prescanGate={prescanGate}
            labourJobsText={labourJobsText}
            candidates={candidates}
            flags={flags}
          />
        </div>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Scan reports by email</SectionLabel>
            <p className="text-xs text-muted">The inbound email service posts every email it receives to this secret address. Give it to the service when you set up the inbound address (see the delivery note for the DNS record and the forward).</p>
            <code className="break-all rounded-control bg-chip px-3 py-2 text-xs">{`https://erp.ofjauto.com/api/inbound/scan?token=${inboundToken || "(token not set)"}`}</code>
            <p className="text-xs text-muted">Matched scans attach themselves to the car; the rest wait on the Scan reports page.</p>
          </Card>
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
