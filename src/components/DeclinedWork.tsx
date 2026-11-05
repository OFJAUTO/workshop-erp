import { DECLINED_HEADING, groupDeclined, type DeclinedDocItem } from "@/lib/declined-doc";

/**
 * The declined-work list as its own section (5 November 2026, J-00970): grouped Replace now →
 * Replace → Advisory, repeats removed, two columns on a wide screen - the SAME rules as the PDF's
 * page 2. Used on the customer's invoice page and the job card.
 */
export function DeclinedWorkSection({ items, title = DECLINED_HEADING }: { items: DeclinedDocItem[]; title?: string }) {
  const groups = groupDeclined(items);
  if (!groups.length) return null;
  const n = groups.reduce((t, g) => t + g.items.length, 0);
  return (
    <section className="flex flex-col gap-3 rounded-card border border-line p-4" data-declined-section data-declined-count={n}>
      <h3 className="border-b-2 border-ink pb-2 text-sm font-extrabold uppercase tracking-[0.06em]">
        {title} · {n}
      </h3>
      <p className="text-xs text-muted">Found at inspection and not approved this visit. No charge for any of it; we can quote it again any time.</p>
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-1" data-declined-group={g.label}>
          <span className="text-xs font-extrabold uppercase tracking-[0.06em]">{g.label} · {g.items.length}</span>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            {g.items.map((t) => (
              <li key={t} className="flex gap-1.5" data-declined-item>
                <span aria-hidden>•</span>
                <span className="min-w-0">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
