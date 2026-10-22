import { Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { filmTypesOf } from "@/lib/film";
import { saveBodyshopCosting } from "@/app/(app)/bodyshop/rolls/actions";
import { requirePermission } from "@/lib/auth";
import { packagesOf } from "@/lib/packages";
import { getSettings } from "@/lib/settings";
import { savePackages } from "./actions";
import { PackagesEditor } from "./PackagesEditor";

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
        subtitle="What each package includes, the warranty per product and the time in workshop. The advisor picks a package and types ONE price; the customer sees the list with no item prices."
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
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Big cars (1.5 rolls), one per line<Textarea name="big_models" rows={3} defaultValue={((settings.big_car_models ?? []) as string[]).join("\n")} data-big-models /></label>
          <div><Button type="submit" size="md" data-save-costing>Save the costing</Button></div>
        </form>
      </Card>
    </>
  );
}
