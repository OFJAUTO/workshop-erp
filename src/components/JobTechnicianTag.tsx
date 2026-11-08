import { technicianWords, type CarTechnicians } from "@/lib/job-technician";

/**
 * THE technician next to the advisor on the parts screens (8 November 2026, Peter): "Technician: Keno", or
 * "Mechanical: Keno · Bodyshop: Sabir". Staff screens only; never on a supplier copy or a customer page.
 */
export function JobTechnicianTag({ jobId, technicians }: { jobId: string; technicians: CarTechnicians | null | undefined }) {
  const words = technicianWords(technicians);
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-bold ${words ? "border-ink text-ink" : "border-line text-muted"}`} data-job-technician={jobId}>
      {words ?? "Technician: not on a car yet"}
    </span>
  );
}
