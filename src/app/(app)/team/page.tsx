import Link from "next/link";
import { Avatar, Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { DEPARTMENT_LABELS, ROLE_LABELS, type DepartmentId, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { StaffRow } from "@/lib/types";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requirePermission("manageTeam");
  const { show } = await searchParams;
  const showAll = show === "all";

  const supabase = await createClient();
  let query = supabase
    .from("staff")
    .select("id, full_name, display_name, role_id, department_id, employee_number, login_type, is_head_accountant, photo_path, is_active, disabled_at, created_at, updated_at")
    .order("is_active", { ascending: false })
    .order("role_id")
    .order("display_name");
  if (!showAll) query = query.eq("is_active", true);
  const { data } = await query;
  const rows = (data ?? []) as StaffRow[];

  const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
  const signed = paths.length ? await supabase.storage.from("staff-photos").createSignedUrls(paths, 3600) : { data: [] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  const roleOrder = Object.keys(ROLE_LABELS) as RoleId[];
  const grouped = roleOrder
    .map((role) => ({ role, people: rows.filter((r) => r.role_id === role) }))
    .filter((g) => g.people.length > 0);

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={`${rows.filter((r) => r.is_active).length} active staff`}
        actions={
          <>
            <LinkButton href={showAll ? "/team" : "/team?show=all"} tone="secondary">
              {showAll ? "Hide disabled" : "Show disabled"}
            </LinkButton>
            <LinkButton href="/team/tablets" tone="secondary">
              Tablets
            </LinkButton>
            <LinkButton href="/team/new">Add staff member</LinkButton>
          </>
        }
      />

      {grouped.length === 0 ? (
        <Empty title="No staff yet">Add the first staff member to get started.</Empty>
      ) : (
        grouped.map((g) => (
          <section key={g.role} className="flex flex-col gap-3">
            <span className="text-[13px] font-bold tracking-[0.06em] uppercase">
              {ROLE_LABELS[g.role]} · {g.people.length}
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.people.map((p) => (
                <Link key={p.id} href={`/team/${p.id}`} className="block">
                  <Card className="flex items-center gap-4 hover:border-ink">
                    <Avatar name={p.full_name} photoUrl={p.photo_path ? urlByPath.get(p.photo_path) : null} size={48} />
                    <span className="flex flex-col gap-1 min-w-0">
                      <span className="font-bold truncate">{p.full_name}</span>
                      <span className="text-xs text-muted truncate">
                        {p.display_name}
                        {p.department_id ? ` · ${DEPARTMENT_LABELS[p.department_id as DepartmentId]}` : ""}
                        {p.employee_number ? ` · #${p.employee_number}` : ""}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        <Badge>{p.login_type === "pin" ? "Tablet PIN" : "PC login"}</Badge>
                        {p.is_head_accountant ? <Badge tone="outline">Head accountant</Badge> : null}
                        {!p.is_active ? <Badge tone="red">Disabled</Badge> : null}
                      </span>
                    </span>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
