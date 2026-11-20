import { Button } from "@/components/ui";
import { startLooseJobAction } from "@/app/(app)/estimates/loose-start-actions";

/**
 * THE "START THE JOB – LOOSE ITEMS" button (20 November 2026, Section 2): on an approved estimate, on a booked car
 * whose car is not coming, and on the gate-in "Loose items, no car" page. One tap opens the job card, no gate-in.
 */
export function StartLooseJob({ estimateId, estimateNumber, back, compact = false }: { estimateId: string; estimateNumber: string; back: string; compact?: boolean }) {
  return (
    <form action={startLooseJobAction.bind(null, estimateId, back)} className="flex flex-col gap-1" data-start-loose={estimateId}>
      <Button type="submit" size={compact ? "md" : "lg"} data-start-loose-button>START THE JOB – LOOSE ITEMS</Button>
      {!compact ? <span className="text-xs text-muted">No car is coming (parts only, or items without the car): the job card opens now from {estimateNumber}, with no gate-in. Items received, parts and work, invoice and payment, handed over.</span> : null}
    </form>
  );
}
