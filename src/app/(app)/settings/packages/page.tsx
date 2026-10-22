import { Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { filmTypesOf } from "@/lib/film";
import { saveBodyshopCosting } from "@/app/(app)/bodyshop/rolls/actions";
import { requirePermission } from "@/lib/auth";
import { packagesOf } from "@/lib/packages";
import { getSettings } from "@/lib/settings";
import { savePackages } from "./actions";
import { PackagesEditor } from "./PackagesEditor";
import { saveTintSettings } from "@/app/(app)/quotes/tint-actions";
import { SHADES, tintSummary } from "@/lib/tint";
import { tintLimitOf, tintPresetsOf } from "@/lib/tint-data";

export const dynamic = "force-dynamic";

/** Owner only: the bodyshop packages the advisors sell at one price. */
export default async function PackagesSettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("manageSettings");
  const { message, error } = await searchParams;
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="Bodyshop packages"
        subtitle="What each package includes, the warranty per product and the estimated completion. The advisor picks a package and types ONE price; the customer sees the list with no item prices."
        actions={<LinkButton href="/settings" tone="secondary" size="lg">Back to Settings</LinkButton>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <PackagesEditor initial={packagesOf(settings)} action={savePackages} />

      <Card className="flex flex-col gap-3" data-costing-card>
        <SectionLabel>Bodyshop costing (internal: what the materials really cost)</SectionLabel>
        <form action={saveBodyshopCosting} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted">Film types: roll price (AED, excl. VAT) and roll length (m) give the cost per metre</span>
            {[...filmTypesOf(settings), { key: "", name: "", roll_price: 0, roll_m: 0, costPerM: 0 }].map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input name="film_name" defaultValue={t.name} placeholder="Coloured PPF Red" className="min-w-44" />
                <Input name="film_price" defaultValue={t.roll_price || ""} inputMode="decimal" placeholder="Roll price" style={{ width: "8rem" }} />
                <Input name="film_m" defaultValue={t.roll_m || ""} inputMode="decimal" placeholder="Metres" style={{ width: "6rem" }} />
                {t.costPerM ? <span className="text-xs text-muted">AED {t.costPerM}/m</span> : null}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Tint roll price (AED)<Input name="tint_roll_price" defaultValue={String(settings.tint_roll_price_aed ?? 1200)} inputMode="decimal" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Film waste allowance (%)<Input name="waste_percent" defaultValue={String(settings.bodyshop_waste_percent ?? 10)} inputMode="numeric" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Consumables per month (AED)<Input name="consumables" defaultValue={String(settings.bodyshop_consumables_monthly_aed ?? 1500)} inputMode="decimal" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Bodyshop labour rate (AED/h, blank = workshop rate)<Input name="bodyshop_rate" defaultValue={String(settings.bodyshop_cost_rate_aed ?? "")} inputMode="decimal" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Default installer hours (other bodyshop services)<Input name="default_installer_hours" defaultValue={String(settings.bodyshop_default_installer_hours ?? 8)} inputMode="decimal" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Full package installer hours<Input name="package_hours" defaultValue={String(settings.package_installer_hours ?? 80)} inputMode="decimal" data-package-hours /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Tint: cars per roll<Input name="tint_cars" defaultValue={String(settings.tint_cars_per_roll ?? 10)} inputMode="decimal" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Ceramic bottle price (AED)<Input name="ceramic_bottle" defaultValue={String(settings.ceramic_bottle_price_aed ?? 300)} inputMode="decimal" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Ceramic: cars per bottle (exterior)<Input name="ceramic_cars_ext" defaultValue={String(settings.ceramic_cars_exterior_per_bottle ?? 4)} inputMode="decimal" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Ceramic: cars per bottle (interior)<Input name="ceramic_cars_int" defaultValue={String(settings.ceramic_cars_interior_per_bottle ?? 5.5)} inputMode="decimal" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Big cars: film rolls<Input name="big_rolls" defaultValue={String(settings.big_car_film_rolls ?? 1.5)} inputMode="decimal" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">PPF hand-cut surcharge (AED, 0 = none)<Input name="handcut_surcharge" defaultValue={String(settings.ppf_handcut_surcharge_aed ?? 0)} inputMode="decimal" data-handcut-surcharge /></label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Big cars (1.5 rolls), one per line<Textarea name="big_models" rows={3} defaultValue={((settings.big_car_models ?? []) as string[]).join("\n")} data-big-models /></label>
          <div><Button type="submit" size="md" data-save-costing>Save the costing</Button></div>
        </form>
      </Card>

      <Card className="flex flex-col gap-3" id="tint" data-tint-settings>
        <SectionLabel>Window tint</SectionLabel>
        <form action={saveTintSettings} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Legal limit (darkness %): anything darker is written as &quot;Above the legal limit – customer&apos;s request&quot; and the customer ticks it on the quotation</span>
            <div className="flex flex-wrap gap-1.5">
              {SHADES.filter((s): s is number => typeof s === "number").map((s) => (
                <label key={s} className="cursor-pointer">
                  <input type="radio" name="tint_limit" value={s} defaultChecked={tintLimitOf(settings) === s} className="peer sr-only" data-tint-limit={s} />
                  <span className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-line-strong bg-white px-2.5 text-xs font-bold peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white">{s}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex max-w-xs flex-col gap-1 text-xs font-semibold text-muted">Extra fitting hours per double-layer window<Input name="double_hours" defaultValue={String(settings.tint_double_layer_hours ?? 1)} inputMode="decimal" data-tint-double-hours /></label>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">One-tap presets (add one from the tint box on a quotation: &quot;Save as a preset&quot;; untick to remove)</span>
            {tintPresetsOf(settings).map((p) => (
              <label key={p.name} className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" name="keep_preset" value={p.name} defaultChecked className="h-5 w-5 accent-ink" />
                <span className="font-bold">{p.name}</span>
                <span className="text-xs text-muted">{tintSummary(p.spec) ?? "no windows"}</span>
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">WhatsApp: updated tint choice ([name], [make model], [plate], [tint])<Textarea name="tint_template" rows={3} defaultValue={String(settings.whatsapp_tint_update_template ?? "")} data-tint-template /></label>
          <div><Button type="submit" size="md" data-save-tint>Save tint settings</Button></div>
        </form>
      </Card>
    </>
  );
}
