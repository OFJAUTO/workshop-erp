import { Button, Card, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { adoptCustomPart, dismissCustomPart, savePartCatalogue } from "../actions";
import { PartCatalogueEditor, type EditRow } from "./PartCatalogueEditor";

export const dynamic = "force-dynamic";

/** Settings > Parts list: the pool the technicians pick from, and the custom parts they typed that could join it. */
export default async function PartsListSettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("manageSettings");
  const { message, error } = await searchParams;
  const [settings, { data }] = await Promise.all([getSettings(), createAdminClient().from("part_catalogue").select("id, category, name, needs_position, position").eq("is_active", true).order("position")]);
  const rows: EditRow[] = ((data ?? []) as { id: string; category: string; name: string; needs_position: boolean | null }[]).map((r) => ({ id: r.id, key: r.id, category: r.category, name: r.name, needs_position: !!r.needs_position }));
  const categories = Array.from(new Set(rows.map((r) => r.category)));
  const custom = Object.entries((settings.part_pool_custom ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <PageHeader
        title="Parts list"
        subtitle="The parts the technicians pick from during the inspection, by category. A part that needs a position asks Front left, Rear... when picked. Custom parts typed on reports appear below as suggestions."
        actions={<LinkButton href="/settings" tone="secondary">Settings</LinkButton>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {custom.length ? (
        <Card className="flex flex-col gap-3 border-ink">
          <SectionLabel right={`${custom.length}`}>Suggestions: custom parts typed on reports</SectionLabel>
          <ul className="divide-y divide-line">
            {custom.map(([name, n]) => (
              <li key={name} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{name}</span>
                <span className="text-xs text-muted">typed {n} time{n === 1 ? "" : "s"}</span>
                <form action={adoptCustomPart.bind(null, name)} className="ml-auto flex items-center gap-2">
                  <Select name="category" defaultValue={categories.includes("Other") ? "Other" : categories[0]} className="w-56">
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                  <label className="flex items-center gap-1 text-xs font-semibold"><input type="checkbox" name="needs_position" className="h-4 w-4 accent-ink" /> position</label>
                  <Button type="submit" size="md">Add to list</Button>
                </form>
                <form action={dismissCustomPart.bind(null, name)}><Button type="submit" tone="ghost" size="md">Dismiss</Button></form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <PartCatalogueEditor action={savePartCatalogue} initial={rows} />
    </>
  );
}
