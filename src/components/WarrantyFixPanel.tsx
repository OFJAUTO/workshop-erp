import "server-only";
import { warrantyCardOf } from "@/lib/warranty-data";
import { rollsWithUse } from "@/lib/film";
import { getSettings } from "@/lib/settings";
import { saveWarrantyDetailsAction } from "@/app/(app)/bodyshop/warranty-actions";
import { WarrantyFields } from "./WarrantyFields";
import { Button } from "./ui";

/**
 * The warranty card's missing details, filled where the warning is (13 November 2026, Section 4, J-00991): the same
 * fields as the bodyshop page (PPF roll and areas, tint roll, ceramic products), the same save, and back to this page.
 */
export async function WarrantyFixPanel({ jobId, back }: { jobId: string; back: string }) {
  const settings = await getSettings();
  const card = await warrantyCardOf(jobId, settings);
  const rows = card?.rows ?? [];
  if (!rows.length) return null;
  const rolls = (await rollsWithUse()).filter((r) => !r.finished_at);
  const products = Array.isArray(settings.ceramic_products_used) ? (settings.ceramic_products_used as unknown[]).map(String) : [];
  return (
    <form action={saveWarrantyDetailsAction.bind(null, jobId)} className="flex flex-col gap-2" data-warranty-fix-form>
      <input type="hidden" name="back" value={back} />
      {rows.map((r) => (
        <WarrantyFields key={`${r.product}:${r.itemKey}`} row={{ product: r.product, itemKey: r.itemKey, label: r.label, rollBatch: r.rollBatch, productName: r.productName, areas: r.areas, suggestedAreas: r.suggestedAreas }} rolls={rolls.filter((x) => x.kind === (r.product === "tint" ? "tint" : "film")).map((x) => x.name)} products={products} />
      ))}
      <div><Button type="submit" size="md" data-warranty-fix-save>Save the warranty details</Button></div>
    </form>
  );
}
