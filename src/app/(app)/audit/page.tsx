import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { AuditRow } from "@/lib/types";

const TABLE_LABELS: Record<string, string> = {
  staff: "Staff",
  staff_private: "Staff (private)",
  devices: "Tablets",
  customers: "Customers",
  customer_contacts: "Customer contacts",
  vehicles: "Cars",
  vehicle_photos: "Car photos",
  vehicle_makes: "Makes",
  vehicle_models: "Models",
  settings: "Settings",
};

const IGNORED = new Set(["updated_at", "updated_by", "created_at", "created_by", "pin_failed_attempts", "pin_locked_until", "last_seen_at", "last_staff_id"]);

function changes(row: AuditRow): string[] {
  if (row.action === "INSERT") return ["Created"];
  if (row.action === "DELETE") return ["Deleted"];
  const out: string[] = [];
  const oldD = row.old_data ?? {};
  const newD = row.new_data ?? {};
  for (const key of Object.keys(newD)) {
    if (IGNORED.has(key)) continue;
    if (JSON.stringify(oldD[key]) !== JSON.stringify(newD[key])) {
      out.push(`${key.replaceAll("_", " ")}: ${show(oldD[key])} → ${show(newD[key])}`);
    }
  }
  return out.length ? out : ["No visible change"];
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

function label(row: AuditRow): string {
  const d = row.new_data ?? row.old_data ?? {};
  const candidates = [d.full_name, d.company_name, d.display_name, d.plate_number, d.name, d.key, d.label];
  const first = candidates.find((c) => typeof c === "string" && c.length > 0) as string | undefined;
  return first ?? (row.record_id ? row.record_id.slice(0, 8) : "");
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  await requirePermission("viewAudit");
  const { table } = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("id, table_name, record_id, action, old_data, new_data, changed_by, changed_at")
    .order("changed_at", { ascending: false })
    .limit(200);
  if (table) query = query.eq("table_name", table);
  const { data } = await query;
  const rows = (data ?? []) as AuditRow[];

  const ids = Array.from(new Set(rows.map((r) => r.changed_by).filter((x): x is string => !!x)));
  const { data: people } = ids.length
    ? await supabase.from("staff").select("id, display_name").in("id", ids)
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((people ?? []).map((p) => [p.id, p.display_name]));

  return (
    <>
      <PageHeader title="Change log" subtitle="Who changed what, and when. Latest 200 entries." />

      <div className="flex flex-wrap gap-2">
        <LinkButton href="/audit" tone={table ? "ghost" : "secondary"} size="md">
          All
        </LinkButton>
        {Object.entries(TABLE_LABELS).map(([k, l]) => (
          <LinkButton key={k} href={`/audit?table=${k}`} tone={table === k ? "secondary" : "ghost"} size="md">
            {l}
          </LinkButton>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty title="Nothing logged yet" />
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6">
                <span className="text-xs text-muted sm:w-36 shrink-0">{formatDateTime(r.changed_at)}</span>
                <span className="text-sm font-semibold sm:w-28 shrink-0">
                  {r.changed_by ? (nameById.get(r.changed_by) ?? "Unknown") : "System"}
                </span>
                <span className="flex flex-col gap-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.action === "INSERT" ? "green" : r.action === "DELETE" ? "red" : "neutral"}>
                      {r.action === "INSERT" ? "Added" : r.action === "DELETE" ? "Deleted" : "Changed"}
                    </Badge>
                    <span className="text-sm">
                      {TABLE_LABELS[r.table_name] ?? r.table_name} · <span className="font-semibold">{label(r)}</span>
                    </span>
                  </span>
                  <span className="text-xs text-muted flex flex-col">
                    {changes(r).map((c, i) => (
                      <span key={i}>{c}</span>
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
