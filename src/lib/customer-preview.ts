import { getCurrentStaff } from "@/lib/auth";

/**
 * "VIEW AS CUSTOMER" (10 November 2026, Section 10). A customer page opened with ?preview=1 by a signed-in staff member
 * is a staff preview: exactly the customer's page, read-only. It never counts as "opened by the customer", and
 * nothing can be approved, paid or sent from it. A customer who adds ?preview=1 to a link just sees the normal page.
 */
export async function staffPreview(preview: string | null | undefined): Promise<boolean> {
  if (preview !== "1") return false;
  return !!(await getCurrentStaff().catch(() => null));
}
export { previewWords } from "@/lib/customer-preview-words";
