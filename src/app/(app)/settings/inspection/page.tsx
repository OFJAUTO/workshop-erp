import { SCOPES } from "@/lib/inspection-scope";
import { saveScopeRules } from "./scope-rules-actions";
import { Button, Card, LinkButton, Notice, PageHeader, SectionLabel , Input } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { ROAD_TEST_ITEMS } from "@/lib/road-test";
import { chipRowsFor } from "@/lib/road-test-chips";
import { getSettings } from "@/lib/settings";
import { saveInspectionChecklist, saveManagerNotePresets } from "../actions";
import { adoptTyreBrand, dismissTyreBrand, saveRoadTestChips } from "./chips-actions";
import { ChecklistEditor } from "./ChecklistEditor";
import { ManagerNotesForm } from "./ManagerNotesForm";
import { RoadTestChipsForm } from "./RoadTestChipsForm";

export const dynamic = "force-dynamic";

export default async function InspectionChecklistPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("manageSettings");
  const { message, error } = await searchParams;
  const settings = await getSettings();
  const brandSuggestions = Object.entries((settings.tyre_brand_custom ?? {}) as Record<string, number>).filter(([, n]) => Number(n) >= 2).sort((a, b) => b[1] - a[1]);
  const chipRows = Object.fromEntries(ROAD_TEST_ITEMS.map((it) => [it.key, chipRowsFor(settings, it.key)]));
  return (
    <>
      <PageHeader
        title="Inspection checklist"
        subtitle="Sections and items of the technician's report. A part of the car is marked Good, Average or Bad; a service item is OK or Required (tap the style on each item). The numbers (tyres, brake pads, battery, vent temperature) and the road test are fixed."
        actions={<LinkButton href="/settings" tone="secondary">Settings</LinkButton>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {/* 11 November 2026 (Section 10): fee and time allowed per inspection type (empty = today's behaviour). */}
      <Card className="flex flex-col gap-3" id="scope-rules" data-scope-rules>
        <SectionLabel>Inspection types – fee and time allowed</SectionLabel>
        <p className="text-xs text-muted">Empty keeps today&apos;s rule (the fee chosen at gate-in, the usual time). The time sets the technician&apos;s allowance when the inspection starts.</p>
        <form action={saveScopeRules} className="flex flex-col gap-2">
          {SCOPES.map((sc) => {
            const rule = ((settings.inspection_scope_rules ?? {}) as Record<string, { fee: number | null; minutes: number | null }>)[sc.key] ?? { fee: null, minutes: null };
            return (
              <div key={sc.key} className="flex flex-wrap items-end gap-2">
                <span className="min-w-56 text-sm font-bold">{sc.label}</span>
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Fee (AED)<Input name={`fee_${sc.key}`} inputMode="decimal" defaultValue={rule.fee === null ? "" : String(rule.fee)} className="w-32" /></label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Time (minutes)<Input name={`minutes_${sc.key}`} inputMode="numeric" defaultValue={rule.minutes === null ? "" : String(rule.minutes)} className="w-32" /></label>
              </div>
            );
          })}
          <div><Button type="submit" size="md" data-scope-rules-save>Save</Button></div>
        </form>
      </Card>
      {brandSuggestions.length ? (
        <Card className="flex flex-col gap-3 border-ink">
          <SectionLabel right={`${brandSuggestions.length}`}>Suggestions: tyre brands typed on reports</SectionLabel>
          <ul className="divide-y divide-line">
            {brandSuggestions.map(([name, n]) => (
              <li key={name} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{name}</span>
                <span className="text-xs text-muted">typed {n} time{n === 1 ? "" : "s"}</span>
                <form action={adoptTyreBrand.bind(null, name)} className="ml-auto"><Button type="submit" size="md">Add to the brands</Button></form>
                <form action={dismissTyreBrand.bind(null, name)}><Button type="submit" tone="ghost" size="md">Dismiss</Button></form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <RoadTestChipsForm action={saveRoadTestChips} items={ROAD_TEST_ITEMS.map((it) => ({ key: it.key, label: it.label }))} rows={chipRows} />
      <ManagerNotesForm action={saveManagerNotePresets} groups={Object.keys((settings.manager_note_groups ?? {}) as Record<string, string[]>).length ? ((settings.manager_note_groups ?? {}) as Record<string, string[]>) : { Notes: (settings.manager_note_presets ?? []) as string[] }} usage={(settings.manager_note_usage ?? {}) as Record<string, number>} />
      <ChecklistEditor action={saveInspectionChecklist} initial={settings.inspection_checklist} initialComplaints={(settings.complaint_keywords ?? {}) as Record<string, string[]>} />
    </>
  );
}
