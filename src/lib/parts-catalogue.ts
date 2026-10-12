import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { CatalogueRow } from "./parts-list";

/** The owner's parts pool, active rows in their order, for the pickers. */
export async function loadCatalogue(): Promise<CatalogueRow[]> {
  const { data } = await createAdminClient().from("part_catalogue").select("id, category, name, needs_position, usage_count, unit, paired, goes_with").eq("is_active", true).order("position");
  return ((data ?? []) as { id: string; category: string; name: string; needs_position: boolean | null; usage_count: number | null; unit: string | null; paired: boolean | null; goes_with: string[] | null }[]).map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    needs_position: !!r.needs_position,
    usage_count: Number(r.usage_count) || 0,
    unit: r.unit === "set" ? ("set" as const) : ("each" as const),
    paired: !!r.paired,
    goes_with: Array.isArray(r.goes_with) ? r.goes_with.map(String).filter(Boolean) : [],
  }));
}
