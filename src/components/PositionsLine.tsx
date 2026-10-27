import { positionsWords } from "@/lib/parts-list";

/**
 * THE positions line under a part or job name (owner's rule, 27 October 2026): its own small line, the short form
 * (ALL 4, FRONT PAIR …), never squeezed beside the name. Renders nothing when there are no positions.
 */
export function PositionsLine({ positions, className = "" }: { positions: string[] | null | undefined; className?: string }) {
  const words = positionsWords(positions);
  if (!words) return null;
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-wide text-muted ${className}`} data-line-positions>
      {words}
    </div>
  );
}
