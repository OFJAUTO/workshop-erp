import { LiveRefresh } from "@/components/LiveRefresh";
import { StaffPicker } from "@/components/StaffPicker";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { sideOfDepartment } from "@/lib/inspection";
import { getSettings } from "@/lib/settings";
import type { Side } from "@/lib/teams";
import { technicianLoads } from "@/lib/technician-load";

export const dynamic = "force-dynamic";

/** The manager's and owner's view of every person who works on cars: free, paused, working or on break, their cars, their week. */
export default async function WorkshopLoadPage() {
  const staff = await requirePermission("manageWork");
  const settings = await getSettings();
  const side = staff.role_id === "owner" ? null : sideOfDepartment(staff.department_id);
  const loads = await technicianLoads(settings, side);
  const sides: Side[] = side ? [side] : ["mechanical", "bodyshop"];
  const working = loads.filter((l) => l.status === "working").length;
  const free = loads.filter((l) => l.status === "free").length;
  return (
    <>
      <LiveRefresh tables={["work_sessions", "job_technicians", "work_pauses", "jobs", "bodyshop_assignments", "bodyshop_clockings"]} />
      <PageHeader title="Workshop load" subtitle={`${working} working · ${loads.length - working - free} on a car with the clock off · ${free} free. Load: hours still to do on each person's cars against the working hours of the week (green under 60%, amber to 90%, red above).`} />
      <Card className="flex flex-col gap-2">
        <StaffPicker mode="view" people={loads} sides={sides} />
      </Card>
    </>
  );
}
