import { NextResponse } from "next/server";
import { HR_DOC_LABELS, hrActor, loadHrBoard, logHr } from "@/lib/hr";
import { daysLeft } from "@/lib/hr-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/**
 * The expiry list (13 November 2026, Section 13): every current document with an expiry date of everyone working
 * here, soonest first, as an Excel file. Same access rule as HR (the owner and the head accountant with a phone
 * sign-in); the download is logged. ID numbers are NOT in it.
 */
export async function GET() {
  const by = await hrActor();
  if (!by) return new NextResponse("Not allowed.", { status: 403 });
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  const people = (await loadHrBoard()).filter((r) => r.status === "active" && r.personId);
  const byId = new Map(people.map((p) => [p.personId as string, p]));
  const { data } = await createAdminClient().from("hr_documents").select("person_id, kind, expires_on").eq("is_active", true).is("replaced_at", null).is("archived_at", null).not("expires_on", "is", null);
  const rows = ((data ?? []) as { person_id: string; kind: string; expires_on: string }[])
    .filter((d) => byId.has(d.person_id))
    .map((d) => {
      const p = byId.get(d.person_id)!;
      const left = daysLeft(d.expires_on, today);
      return { name: p.name, role: p.role, group: p.group, document: HR_DOC_LABELS[d.kind] ?? d.kind, expires: new Date(`${d.expires_on}T00:00:00Z`), days: left, status: left < 0 ? "Expired" : left <= 60 ? "Expiring soon" : "Valid" };
    })
    .sort((a, b) => a.days - b.days);
  await logHr(by.id, "downloaded_expiry_list", { detail: `${rows.length} documents` });
  const buf = await buildXlsx([
    {
      name: "Expiry list",
      columns: [
        { header: "Name", key: "name", width: 30 },
        { header: "Role", key: "role", width: 20 },
        { header: "Department", key: "group", width: 28 },
        { header: "Document", key: "document", width: 18 },
        { header: "Expires", key: "expires", width: 14, numFmt: "dd mmm yyyy" },
        { header: "Days left", key: "days", width: 10 },
        { header: "Status", key: "status", width: 16 },
      ],
      rows,
    },
  ]);
  return xlsxResponse(buf, `OFJ HR expiry list ${today}.xlsx`);
}
