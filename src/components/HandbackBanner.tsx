import { Card } from "@/components/ui";

/**
 * "Edited by Omar – check and send" (or "Approved by Omar – ready to send") at the top of an estimate or quotation the
 * owner handed back (1 November 2026, E-00055), with what changed. Shown while the version waits to be sent.
 */
export function HandbackBanner({ handback, leadName }: { handback: { words: string; summary: string; kind: string } | null; leadName: string | null }) {
  if (!handback) return null;
  return (
    <Card className="flex flex-col gap-1 !border-ink border-l-4" data-handback-banner data-handback-kind={handback.kind}>
      <p className="text-base font-extrabold" data-handback-words>{handback.words}</p>
      {handback.summary ? <p className="text-sm font-semibold" data-handback-summary>{handback.summary}</p> : null}
      {leadName ? <p className="text-xs text-muted">In the charge of {leadName}, who started it.</p> : null}
    </Card>
  );
}
