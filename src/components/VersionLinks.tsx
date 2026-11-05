import Link from "next/link";

/**
 * "v1 | v2" next to the title of an estimate or a quotation (5 November 2026, E-00056): every version one tap away,
 * the one on screen marked. An older version opens read-only (the page decides; replaced versions never edit).
 * A first version shows its "v1" alone, so the version on screen is always named in the same place.
 */
export function VersionLinks({ versions, currentId, hrefOf }: { versions: { id: string; version: number }[]; currentId: string; hrefOf: (id: string) => string }) {
  if (!versions.length) return null;
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-base font-bold" data-version-links>
      {sorted.map((v, i) => (
        <span key={v.id} className="inline-flex items-center gap-1">
          {i > 0 ? <span className="text-muted" aria-hidden>|</span> : null}
          {v.id === currentId ? (
            <span className="rounded-control bg-ink px-2 py-0.5 text-white" aria-current="page" data-version-link={v.version} data-version-current>v{v.version}</span>
          ) : (
            <Link href={hrefOf(v.id)} className="rounded-control px-2 py-0.5 underline underline-offset-4 hover:bg-chip" data-version-link={v.version}>v{v.version}</Link>
          )}
        </span>
      ))}
    </span>
  );
}
