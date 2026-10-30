import { CarOutline } from "@/components/CarOutline";
import { ViewerThumb } from "@/components/PhotoViewer";
import { DAMAGE_WORDS_AR, type CarDamage, type DamagePhoto } from "@/lib/damage";
import { formatDate } from "@/lib/format";

function Photos({ photos, label }: { photos: DamagePhoto[]; label: string }) {
  if (!photos.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1" data-damage-photos>
      {photos.map((p, i) => (
        <ViewerThumb key={p.id} src={p.url} thumb={p.thumb} label={p.label} detail={`${label} · photo ${i + 1} of ${photos.length}`} viewerKey={p.id} className="block h-20 w-20 overflow-hidden rounded-md bg-[#F4F4F5]" data-damage-photo={p.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.thumb ?? p.url} alt={p.label} className="h-full w-full object-cover" loading="lazy" />
        </ViewerThumb>
      ))}
    </div>
  );
}

const DOT = { red: "bg-[#B3261E]", amber: "bg-[#B7791F]" } as const;

/**
 * THE "Damage already on the car" section (30 October 2026, night batch section 4): the labelled outline with the
 * damaged panels coloured, the written list with each panel's photos next to it, and what was found after check-in kept
 * apart with its date. English and Arabic for the customer. One component for the customer's job card link, the
 * gate-in details page, the job card and the gate-out.
 */
export function DamageSection({ damage, arabic = true, heading = "Damage already on the car", outlineSize = 170 }: { damage: CarDamage; arabic?: boolean; heading?: string; outlineSize?: number }) {
  const none = !damage.items.length && !damage.loose.length && !damage.note;
  return (
    <section className="flex flex-col gap-2" data-damage-section data-damage-count={damage.items.length}>
      <h2 className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b-2 border-[#111113] pb-1.5">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#5F6368]">{heading}</span>
        {arabic ? <span className="text-xs font-bold text-[#5F6368]" dir="rtl" lang="ar">{DAMAGE_WORDS_AR.title}</span> : null}
      </h2>
      {none ? (
        <div className="flex flex-col gap-0.5 py-1" data-damage-none>
          <span className="text-sm font-bold">No damage noted at check-in</span>
          {arabic ? <span className="text-sm font-bold" dir="rtl" lang="ar">{DAMAGE_WORDS_AR.none}</span> : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 py-1 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex justify-center">
            <CarOutline tones={damage.tones} size={outlineSize} showChassis={!!damage.tones.chassis} />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {damage.items.length ? (
              <ol className="flex flex-col gap-3" data-damage-list>
                {damage.items.map((i, n) => (
                  <li key={i.key} className="flex flex-col gap-0.5" data-damage-item={i.key}>
                    <span className="flex items-start gap-2">
                      <span className="w-5 shrink-0 text-sm font-bold text-[#5F6368]">{n + 1}.</span>
                      <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[i.tone]}`} aria-hidden />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-bold">{i.label}</span>
                        <span className="text-sm">{[i.words, i.severity].filter(Boolean).join(" · ")}</span>
                        {i.note ? <span className="text-sm text-[#5F6368] whitespace-pre-wrap">{i.note}</span> : null}
                      </span>
                    </span>
                    <div className="pl-7"><Photos photos={i.photos} label={i.label} /></div>
                  </li>
                ))}
              </ol>
            ) : null}
            {damage.loose.length ? (
              <div className="flex flex-col gap-1" data-damage-loose>
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#5F6368]">{damage.items.length ? "Other damage photos" : "Damage photos"}</span>
                <Photos photos={damage.loose} label="Damage" />
              </div>
            ) : null}
            {damage.note ? <p className="whitespace-pre-wrap rounded-md bg-[#F4F4F5] px-3 py-2 text-sm" data-damage-note>{damage.note}</p> : null}
          </div>
        </div>
      )}
      {damage.after.length ? (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[#D4D4D8] p-3" data-damage-after>
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-xs font-bold uppercase tracking-[0.08em]">Found after check-in</span>
            {arabic ? <span className="text-xs font-bold" dir="rtl" lang="ar">{DAMAGE_WORDS_AR.after}</span> : null}
          </span>
          <ol className="flex flex-col gap-3">
            {damage.after.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5" data-damage-after-item={a.id}>
                <span className="flex items-start gap-2">
                  <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[a.tone]}`} aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-bold">{a.label} <span className="font-semibold text-[#5F6368]">· Found after check-in · {a.at ? formatDate(a.at) : ""}</span></span>
                    <span className="text-sm">{[a.words, a.severity].filter(Boolean).join(" · ")}</span>
                    {a.note ? <span className="text-sm text-[#5F6368] whitespace-pre-wrap">{a.note}</span> : null}
                  </span>
                </span>
                <div className="pl-4"><Photos photos={a.photos} label={a.label} /></div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
