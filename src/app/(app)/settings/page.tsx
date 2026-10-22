import { Button, Card, Input, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { DEPARTMENT_LABELS, type DepartmentId } from "@/lib/roles";
import { formatBytes, storageUsage } from "@/lib/storage-usage";
import { createClient } from "@/lib/supabase/server";
import { loadDrivers } from "@/lib/delivery";
import { removeRecoveryDriver, saveRecoveryDriver, saveRecoveryRates } from "@/app/(app)/jobs/delivery-actions";
import { RATE_KIND_LABELS, recoveryRatesOf, type RateKind } from "@/lib/recovery";
import { saveSettings } from "./actions";
import { clearTestDataAction } from "./clear-actions";
import { ClearTestData } from "./ClearTestData";
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
  let labourJobsText = "";
  let candidates: Record<string, number> = {};
  let docLimits: Record<string, { amber: number; red: number | string }> = {};
  let reasonPresets: Record<string, string[]> = {};
  let breakTimes: Record<string, Record<string, string>> = {};
  const flags: Record<string, boolean> = { wash_board_show_times: false, wash_board_done_button: false, test_mode_enabled: true, advisor_labour_discount: false, customer_documents_uppercase: false };
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
    else if (["part_types", "labour_actions", "labour_positions", "big_job_tags", "fluid_grades", "quick_remarks", "tyre_brands", "damage_note_chips", "recovery_companies", "premium_brands"].includes(row.key)) listTexts[row.key] = Array.isArray(row.value) ? (row.value as string[]).join("\n") : "";
    else if (row.key === "doc_reminder_limits") docLimits = (row.value as Record<string, { amber: number; red: number | string }>) ?? {};
    else if (row.key === "reason_presets") reasonPresets = (row.value as Record<string, string[]>) ?? {};
    else if (row.key === "road_test_chips" || row.key === "road_test_chip_usage" || row.key === "tyre_brand_custom" || row.key === "manager_note_usage" || row.key === "item_suggestions" || row.key === "complaint_keywords" || row.key === "part_pool_custom" || row.key === "custom_jobs_used" || row.key === "manager_note_groups") continue;
    else if (row.key === "known_words" || row.key === "spell_words") listTexts[row.key] = Array.isArray(row.value) ? (row.value as string[]).join(", ") : "";
    else if (row.key === "tyre_models") listTexts.tyre_models = Object.entries((row.value as Record<string, string[]>) ?? {}).map(([b, ms]) => `${b}: ${(ms ?? []).join(", ")}`).join("\n");
    else if (row.key === "inspection_limits") limits = { ...limits, ...((row.value as Record<string, number>) ?? {}) };
    else if (row.key === "prescan_gate_enabled") prescanGate = row.value === true;
    else if (row.key === "wash_board_show_times" || row.key === "wash_board_done_button" || row.key === "test_mode_enabled" || row.key === "advisor_labour_discount" || row.key === "customer_documents_uppercase") flags[row.key] = row.value === true;
    else if (row.key === "labour_jobs") labourJobsText = Object.entries((row.value as Record<string, string[]>) ?? {}).map(([g, list]) => `${g}:\n${(list ?? []).join("\n")}`).join("\n\n");
    else if (row.key === "labour_job_candidates") candidates = (row.value as Record<string, number>) ?? {};
    else if (row.key === "recovery_providers" || row.key === "labour_hours_memory" || row.key === "recovery_rates" || row.key === "recovery_flag_percent") continue;
    else if (row.key === "inbound_scan_token" || row.key === "scans_mailbox_last_check" || row.key === "break_mechanical" || row.key === "break_bodyshop") continue;
    else if (row.key === "break_times") breakTimes = (row.value as Record<string, Record<string, string>>) ?? {};
    else initial[row.key] = typeof row.value === "string" ? row.value : String(row.value ?? "");
  }

  const departments = (Object.keys(DEPARTMENT_LABELS) as DepartmentId[]).map((id) => ({ id, label: DEPARTMENT_LABELS[id] }));
  const recoveryDrivers = await loadDrivers();
  const recoveryRates = recoveryRatesOf({ recovery_rates: (data ?? []).find((r) => r.key === "recovery_rates")?.value });
  const recoveryFlag = Number((data ?? []).find((r) => r.key === "recovery_flag_percent")?.value ?? 25);
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
            <LinkButton href="/settings/packages" tone="secondary">
              Packages
            </LinkButton>
            <LinkButton href="/settings/warranty" tone="secondary">
              Warranty terms
            </LinkButton>
            <LinkButton href="/settings/stickers" tone="secondary">
              Stickers
            </LinkButton>
            <LinkButton href="/settings/inspection" tone="secondary">
              Inspection checklist
            </LinkButton>
            <LinkButton href="/settings/parts" tone="secondary">
              Parts list
            </LinkButton>
            <LinkButton href="/settings/catalog" tone="secondary">
              Makes and models{pendingReview ? ` · ${pendingReview} to review` : ""}
            </LinkButton>
            <LinkButton href="/settings/uploads" tone="secondary">
              Failed uploads
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
            docLimits={docLimits}
            reasonPresets={reasonPresets}
            breakTimes={breakTimes}
          />
        </div>
        <div className="flex flex-col gap-6">
          <Card id="drivers" className="flex flex-col gap-3" data-recovery-drivers>
            <SectionLabel right={`${recoveryDrivers.length}`}>Recovery drivers</SectionLabel>
            <p className="text-xs text-muted">The regular driver is prefilled at gate-out; the rest are one tap. A driver typed at gate-out joins this list by himself. Empty company = our truck.</p>
            <ul className="flex flex-col divide-y divide-line text-sm">
              {recoveryDrivers.map((d) => (
                <li key={d.id} className="py-2 flex flex-wrap items-center gap-2" data-driver-row>
                  <span className="font-semibold">{d.name}</span>
                  <span className="text-xs text-muted">{[d.phone, d.truck_plate ? `Truck ${d.truck_plate}` : null, d.company ?? "Our truck"].filter(Boolean).join(" · ")}</span>
                  {d.is_default ? <span className="rounded-full bg-chip px-2 py-0.5 text-[11px] font-bold">Regular</span> : null}
                  <form action={removeRecoveryDriver.bind(null, d.id)} className="ml-auto"><Button type="submit" tone="ghost" size="md">Remove</Button></form>
                </li>
              ))}
            </ul>
            <form action={saveRecoveryDriver} className="grid grid-cols-2 gap-2">
              <Input name="name" placeholder="Name" required aria-label="Driver's name" />
              <Input name="phone" type="tel" inputMode="tel" placeholder="Mobile" aria-label="Driver's mobile" />
              <Input name="truck_plate" placeholder="Truck plate" aria-label="Truck plate" />
              <Input name="company" placeholder="Company (empty = our truck)" aria-label="Company" />
              <label className="col-span-2 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" name="is_default" className="h-5 w-5 accent-ink" />The regular driver (prefilled at gate-out)</label>
              <div className="col-span-2"><Button type="submit" tone="secondary" size="md" data-driver-save>Add driver</Button></div>
            </form>
          </Card>
          <Card id="recovery-rates" className="flex flex-col gap-3" data-recovery-rates>
            <SectionLabel>Recovery rates</SectionLabel>
            <p className="text-xs text-muted">The normal price of a trip: the minimum, or the kilometres one way from the workshop times the rate, whichever is more. A claim more than the flag % above it is marked on the Recovery page with the suggested price.</p>
            <form action={saveRecoveryRates} className="flex flex-col gap-2">
              <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2 text-xs font-bold uppercase tracking-[0.06em] text-muted"><span>Truck</span><span>Min AED</span><span>AED / km</span></div>
              {(Object.keys(RATE_KIND_LABELS) as RateKind[]).map((k) => (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2" data-rate-row={k}>
                  <span className="text-sm font-semibold">{RATE_KIND_LABELS[k]}</span>
                  <Input name={`${k}_min`} defaultValue={String(recoveryRates[k].min)} inputMode="decimal" aria-label={`${RATE_KIND_LABELS[k]} minimum`} />
                  <Input name={`${k}_per_km`} defaultValue={String(recoveryRates[k].per_km)} inputMode="decimal" aria-label={`${RATE_KIND_LABELS[k]} AED per km`} />
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm font-semibold">Flag a trip above expected by <Input name="flag_percent" defaultValue={String(recoveryFlag)} inputMode="decimal" style={{ width: "4.5rem" }} aria-label="Flag percent" data-rate-flag /> %</label>
              <div><Button type="submit" tone="secondary" size="md" data-rates-save>Save rates</Button></div>
            </form>
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
          {flags.test_mode_enabled ? (
            <Card className="flex flex-col gap-3 border-red-bar">
              <SectionLabel>Testing phase: clear test data</SectionLabel>
              <ClearTestData action={clearTestDataAction} />
              <p className="text-xs text-muted">Switch off &quot;Testing phase&quot; in the Workshop floor card at go-live; the button disappears.</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
