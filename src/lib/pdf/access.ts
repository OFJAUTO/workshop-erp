import "server-only";
import { NextResponse } from "next/server";
import { getCurrentStaff, type CurrentStaff } from "@/lib/auth";
import type { RoleId } from "@/lib/roles";

/**
 * Who may open a document PDF from inside the system (by its id, not the customer's token): the owner, the
 * advisors and accounts for every customer document (invoices, quotations, receipts carry the customer's name and
 * phone - 29 October 2026, workshop managers no longer); LPOs (supplier documents, no customer) also for Parts and
 * the workshop managers. "View as" and "Act as" run under the person on screen. Without a staff login a PDF only
 * opens through the customer's private token link.
 */
const DOCUMENT_ROLES: RoleId[] = ["owner", "service_advisor", "accounts"];
const LPO_ROLES: RoleId[] = [...DOCUMENT_ROLES, "parts", "workshop_manager"];

export async function staffPdfAccess(kind: "document" | "lpo" = "document"): Promise<{ staff: CurrentStaff } | { refused: NextResponse }> {
  const staff = await getCurrentStaff();
  if (!staff) return { refused: new NextResponse("You're not signed in. Sign in and try again.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } }) };
  const roles = kind === "lpo" ? LPO_ROLES : DOCUMENT_ROLES;
  if (!roles.includes(staff.role_id as RoleId)) return { refused: new NextResponse("Your role can't open this document.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } }) };
  return { staff };
}
