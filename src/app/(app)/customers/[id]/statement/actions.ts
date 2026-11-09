"use server";

import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { signStatement } from "@/lib/statement-token";
import { shortFor } from "@/lib/short-links";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { validateGatewayUrl } from "@/lib/pay-page";
import { getSettings } from "@/lib/settings";
import { greetingNameOf } from "@/lib/messages";

export type StatementLink = { error?: string; link?: string; message?: string; phoneDigits?: string; email?: string | null; subject?: string };

/** The statement or one bill for several cars, as a signed link with its WhatsApp message (9 November 2026, Section 3). */
export async function statementLinkAction(customerId: string, kind: "statement" | "combined", docIds: string[], payLink: string | null): Promise<StatementLink> {
  const staff = await requirePermission("viewInvoices");
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to send." };
  if (kind === "combined" && docIds.length < 2) return { error: "Tick at least two proformas for one bill." };
  const settings = await getSettings();
  const link = (payLink ?? "").trim();
  if (link) {
    const v = validateGatewayUrl(link, settings);
    if (!v.ok) return { error: v.error };
  }
  const admin = createAdminClient();
  const { data: c } = await admin.from("customers").select("full_name, company_name, phone, email").eq("id", customerId).maybeSingle();
  if (!c) return { error: "Customer not found." };
  const token = signStatement({ c: customerId, k: kind, d: kind === "combined" ? docIds : undefined, l: link || null });
  const url = await shortFor(`${PRODUCTION_SITE_URL}/statement/${token}`);
  const name = greetingNameOf(c as Parameters<typeof greetingNameOf>[0]);
  // The message from its template in Settings (the standing rule for every customer link).
  const template = String((kind === "combined" ? settings.whatsapp_combined_bill_template : settings.whatsapp_statement_template) ?? "");
  const message = template.replaceAll("[name]", name).replaceAll("[cars]", String(docIds.length)).replaceAll("[link]", url) + (kind === "combined" && link ? "\n\nYou can pay the total with the Pay now button on the page." : "");
  return { link: url, message, phoneDigits: String(c.phone ?? "").replace(/[^\d]/g, ""), email: (c.email as string | null) ?? null, subject: kind === "combined" ? "OFJ Automotive – one bill for your cars" : "OFJ Automotive – statement of account" };
}
