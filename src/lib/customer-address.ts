import "server-only";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";

/**
 * The customer's saved "How to address in messages" (6 November 2026, Section 7), added to a customer object before
 * `greetingNameOf` reads it. Nothing until the column exists; a customer without an id comes back as it is.
 */
export async function withAddressAs<T extends { id?: string | null } | null | undefined>(customer: T): Promise<T> {
  if (!customer?.id || !(await schemaReady("customers", "address_as"))) return customer;
  const { data } = await createAdminClient().from("customers").select("address_as").eq("id", customer.id).maybeSingle();
  const saved = (data as { address_as?: string | null } | null)?.address_as ?? null;
  return saved ? ({ ...customer, address_as: saved } as T) : customer;
}
