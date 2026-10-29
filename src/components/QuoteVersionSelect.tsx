"use client";

import { useRouter } from "next/navigation";

/** The versions of one quotation number ("v1 · v2 (current)"): picking one opens it; old versions open read-only. */
export function QuoteVersionSelect({ jobId, base, versions, selectedId, label = "Version" }: { jobId?: string | null; /** Where a version opens (default the job's quotation page; estimates pass /estimates/). */ base?: string; versions: { id: string; version: number; status: string }[]; selectedId: string; label?: string }) {
  const router = useRouter();
  const newest = Math.max(...versions.map((v) => v.version));
  if (versions.length < 2) return <span className="inline-flex min-h-11 items-center text-sm font-semibold text-muted" data-quote-versions={versions.length}>v{versions[0]?.version ?? 1}</span>;
  return (
    <label className="inline-flex items-center gap-1.5 text-sm font-semibold" data-quote-versions={versions.length}>
      <span className="sr-only">{label}</span>
      <select
        value={selectedId}
        onChange={(e) => router.push(`${base ?? `/jobs/${jobId}/quote/`}${e.target.value}`)}
        className="min-h-11 rounded-control border border-line-strong bg-white px-2 text-sm font-semibold"
        data-version-select
      >
        {[...versions].sort((a, b) => a.version - b.version).map((v) => (
          <option key={v.id} value={v.id}>
            v{v.version}
            {v.version === newest ? " (current)" : " (old, read-only)"}
          </option>
        ))}
      </select>
    </label>
  );
}
