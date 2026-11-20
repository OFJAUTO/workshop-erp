import { LinkButton } from "@/components/ui";

/**
 * THE "JOB CARD" button in the header of every car and job page (20 November 2026, Section 2), booked cars included:
 * before arrival the job card shows the jobs, the parts and their status, the booking time and the promised handover.
 */
export function JobCardButton({ jobId, jobNumber, booked = false }: { jobId: string; jobNumber?: string | null; booked?: boolean }) {
  return (
    <LinkButton href={`/jobs/${jobId}`} tone="secondary" size="lg" data-job-card-button={jobId}>
      JOB CARD{jobNumber ? ` · ${jobNumber}` : ""}{booked ? " (booked)" : ""}
    </LinkButton>
  );
}
