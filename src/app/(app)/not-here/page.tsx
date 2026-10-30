import { Card, LinkButton, PageHeader } from "@/components/ui";
import { refusalWords } from "@/lib/refusal-words";

/**
 * The "Not here" page with the real reason (30 October 2026, batch 2 section 3.4): what was refused, in plain words,
 * and the one useful next step. Every refusal that leads here is written down for the owner (src/lib/refusal.ts).
 */
export default async function NotHerePage({ searchParams }: { searchParams: Promise<{ r?: string; next?: string; d?: string }> }) {
  const { r, next, d } = await searchParams;
  const w = refusalWords(r);
  // Only a page of this site (never an outside address).
  const nextHref = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  return (
    <>
      <PageHeader title={w.title} subtitle={w.text} />
      <Card className="flex max-w-xl flex-col gap-3" data-not-here={r ?? "missing"}>
        {d ? <p className="text-sm text-muted" data-not-here-detail>{d}</p> : null}
        <div className="flex flex-wrap gap-2">
          {nextHref && w.next ? <LinkButton href={nextHref} size="md" data-not-here-next>{w.next}</LinkButton> : null}
          <LinkButton href="/home" tone={nextHref && w.next ? "secondary" : "primary"} size="md">Go to the start</LinkButton>
        </div>
      </Card>
    </>
  );
}
