import { LiveRefresh } from "@/components/LiveRefresh";
import { TechnicianPicker } from "@/components/TechnicianPicker";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { sideOfDepartment } from "@/lib/inspection";
import { getSettings } from "@/lib/settings";
import { technicianLoads } from "@/lib/technician-load";

export const dynamic = "force-dynamic";

/** The manager's and owner's view of every technician: free, paused or working, his cars, his week. */
export default async function WorkshopLoadPage() {
  const staff = await requirePermission("manageWork");
  const settings = await getSettings();
  const side = staff.role_id === "owner" ? null : sideOfDepartment(staff.department_id);
  const loads = await technicianLoads(settings, side);
  const working = loads.filter((l) => l.status === "working").length;
  const free = loads.filter((l) => l.status === "free").length;
  return (
    <>
      <LiveRefresh tables={["work_sessions", "job_technicians", "work_pauses", "jobs"]} pollMs={30000} />
      <PageHeader title="Workshop load" subtitle={`${working} working · ${loads.length - working - free} on a car with the clock off · ${free} free. Load: hours still to do on each technician's cars against the working hours of the week (green under 60%, amber to 90%, red above).`} />
      <Card className="flex flex-col gap-2">
        <TechnicianPicker technicians={loads} pick={false} />
      </Card>
    </>
  );
}
