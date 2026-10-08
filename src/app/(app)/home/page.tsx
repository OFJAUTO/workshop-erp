import { redirect } from "next/navigation";
import { Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { can, DEPARTMENT_LABELS, ROLE_LABELS, ROLE_PHASE1_SUMMARY, type DepartmentId, type RoleId } from "@/lib/roles";

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (role === "gate_in") redirect("/gate-in");
  if (can(role, "viewDashboard")) redirect("/dashboard");
  if (role === "technician") redirect("/my-jobs");
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Dubai",
  }).format(new Date());

  const quick = [
    { href: "/customers/new", label: "Add a customer", show: can(role, "editCustomers") },
    { href: "/vehicles/new", label: "Add a car", show: can(role, "editVehicles") },
    { href: "/customers", label: "Find a customer", show: can(role, "viewCustomers") },
    { href: "/vehicles", label: "Find a car", show: can(role, "viewVehicles") },
    { href: "/team/new", label: "Add a staff member", show: can(role, "manageTeam") },
  ].filter((q) => q.show);

  return (
    <>
      <PageHeader title={`${greeting()}, ${staff.display_name}`} subtitle={today} />

      <Card className="flex flex-col gap-4">
        <SectionLabel>Your role</SectionLabel>
        <p className="text-lg font-semibold">
          {ROLE_LABELS[role]}
          {staff.department_id ? (
            <span className="text-muted font-medium"> · {DEPARTMENT_LABELS[staff.department_id as DepartmentId]}</span>
          ) : null}
        </p>
        <p className="text-sm text-muted">
          This is Phase 1: logins, team, customers and cars. Your real {ROLE_LABELS[role].toLowerCase()} screen
          arrives in the next phases. In this phase you can:
        </p>
        <ul className="list-disc pl-5 text-sm flex flex-col gap-1">
          {ROLE_PHASE1_SUMMARY[role].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>

      {quick.length ? (
        <div className="flex flex-col gap-3">
          <SectionLabel>Quick actions</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <LinkButton key={q.href} href={q.href} tone="secondary" size="lg">
                {q.label}
              </LinkButton>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
