"use server";

import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** The stock list for an advisor's "+ Add a part → From our stock" (read only: the parts desk keeps the list). */
export async function stockForAdvisorAction(): Promise<{ error?: string; items?: { id: string; name: string; onHand: number; unitCost: number }[] }> {
  const staff = await requireStaff();
  if (!["owner", "service_advisor", "parts"].includes(staff.role_id)) return { error: "Not allowed." };
  const { data } = await createAdminClient().from("stock_items").select("id, name, quantity, unit_cost, item_type").eq("is_active", true).order("name");
  return { items: ((data ?? []) as { id: string; name: string; quantity: number | string | null; unit_cost: number | string | null; item_type: string | null }[]).filter((i) => i.item_type !== "consumable").map((i) => ({ id: i.id, name: i.name, onHand: Number(i.quantity) || 0, unitCost: Number(i.unit_cost) || 0 })) };
}
