import Link from "next/link";
import { SECTIONS, SECTION_LABELS, SIGNOFF_LABELS, type Section } from "@/lib/bodyshop-kinds";
import { sectionCars, type BoardCar } from "@/lib/bodyshop";
import { formatDate } from "@/lib/format";
import { formatPlate } from "@/lib/types";

const SHORT_SIGN: Record<string, string> = { manager: "Manager", ppf: "PPF", detailing: "Detailing", paint: "Paint" };

function CarLine({ c, section, tv, today }: { c: BoardCar; section: Section | null; tv: boolean; today: string }) {
  const v = c.job.vehicle;
  const stage = section && c.current?.section !== section ? c.stages.find((s) => s.section === section && s.status !== "done" && s.status !== "skipped") ?? c.current : c.current;
  const due = stage?.due_date ?? c.job.promised_at;
  const tone = due && due < today ? "red" : due === today ? "amber" : "normal";
  const dueCls = tone === "red" ? (tv ? "text-red-300" : "text-red font-bold") : tone === "amber" ? (tv ? "text-amber-300" : "text-amber font-bold") : tv ? "text-white/80" : "text-muted";
  const row = (
    <div className={`flex items-center gap-3 ${tv ? "py-3 border-b border-white/15" : "py-2 border-b border-line"}`} data-board-car={c.job.id} data-tone={tone}>
      {c.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.pictureUrl} alt="" className={`${tv ? "h-14 w-20" : "h-10 w-14"} shrink-0 rounded-control object-cover ${tv ? "bg-white/10" : "bg-chip"}`} />
      ) : <span className={`${tv ? "h-14 w-20" : "h-10 w-14"} shrink-0 rounded-control ${tv ? "bg-white/10" : "bg-chip"}`} />}
      <div className="flex-1 min-w-0 flex flex-col">
        <span className={`${tv ? "text-xl" : "text-sm"} font-extrabold tracking-[0.03em] truncate`}>{v ? formatPlate(v) : c.job.job_number}<span className={`font-semibold ${tv ? "text-white/80" : "text-muted"}`}> · {[v?.make?.name, v?.model?.name].filter(Boolean).join(" ")}{v?.colour ? ` · ${v.colour}` : ""}</span></span>
        <span className={`${tv ? "text-base" : "text-xs"} ${tv ? "text-white/70" : "text-muted"} truncate`}>
          {stage ? stage.label : c.job.status === "ready" || c.job.status === "pending_payment" ? "Ready, waiting for the handover" : "Waiting"}
          {c.people.length ? ` · ${c.people.map((p) => p.name).join(", ")}` : ""}
        </span>
      </div>
      <span className={`${tv ? "text-lg" : "text-xs"} shrink-0 ${dueCls}`}>{due ? (tone === "red" ? `Late · ${formatDate(due)}` : tone === "amber" ? "Due today" : formatDate(due)) : ""}</span>
    </div>
  );
  return tv ? row : <Link href={`/bodyshop/${c.job.id}`} className="block hover:bg-chip/60 rounded-control px-1 -mx-1">{row}</Link>;
}

/**
 * The one bodyshop board: a "Going out" strip at the top (cars due out today and tomorrow with their sign-offs),
 * then every section's cars in due order. The same component draws the TV screen (dark, large) and the in-app page.
 */
export function BodyshopBoard({ cars, goingOut, today, tomorrow, tv = false }: { cars: BoardCar[]; goingOut: BoardCar[]; today: string; tomorrow: string; tv?: boolean }) {
  const title = (t: string, right?: string) => (
    <div className="flex items-baseline justify-between gap-2">
      <span className={`${tv ? "text-sm text-white/70" : "text-xs text-muted"} font-extrabold tracking-[0.1em] uppercase`}>{t}</span>
      {right ? <span className={`${tv ? "text-sm text-white/60" : "text-xs text-muted"}`}>{right}</span> : null}
    </div>
  );
  const panel = tv ? "rounded-card bg-white/5 p-4 flex flex-col gap-2" : "rounded-card border border-line bg-white p-4 flex flex-col gap-2";
  return (
    <div className="flex flex-col gap-4" data-bodyshop-board>
      <section className={`${tv ? "rounded-card border-2 border-white/40 p-4" : "rounded-card border-2 border-ink bg-white p-4"} flex flex-col gap-2`} data-going-out>
        {title("Going out", `today ${formatDate(today)} · tomorrow ${formatDate(tomorrow)}`)}
        {goingOut.length === 0 ? <p className={`${tv ? "text-white/70 text-lg" : "text-sm text-muted"}`}>Nothing due out today or tomorrow.</p> : (
          <div className="flex flex-col">
            {goingOut.map((c) => {
              const v = c.job.vehicle;
              const when = c.job.promised_at === today ? "Today" : c.job.promised_at === tomorrow ? "Tomorrow" : formatDate(c.job.promised_at);
              const inner = (
                <div className={`flex flex-wrap items-center gap-3 ${tv ? "py-3 border-b border-white/15" : "py-2 border-b border-line"}`} data-going-out-car={c.job.id}>
                  <span className={`${tv ? "text-xl" : "text-sm"} font-extrabold tracking-[0.03em]`}>{v ? formatPlate(v) : c.job.job_number}<span className={`font-semibold ${tv ? "text-white/80" : "text-muted"}`}> · {[v?.make?.name, v?.model?.name].filter(Boolean).join(" ")}</span></span>
                  <span className={`${tv ? "text-lg" : "text-xs"} font-bold ${c.job.promised_at && c.job.promised_at < today ? (tv ? "text-red-300" : "text-red") : ""}`}>{when}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    {c.signoff.needed.map((k) => {
                      const ok = c.signoff.signed.includes(k);
                      return <span key={k} className={`inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-bold ${ok ? (tv ? "bg-green-500/30 text-green-100" : "bg-green-soft text-green") : tv ? "bg-white/10 text-white/80" : "bg-chip text-muted"}`} title={SIGNOFF_LABELS[k]} data-signoff-chip={k} data-signed={ok}>{ok ? "✓ " : ""}{SHORT_SIGN[k]}</span>;
                    })}
                    {c.signoff.waitingOn.length === 0 && c.signoff.needed.length ? <span className={`text-[11px] font-bold ${tv ? "text-green-200" : "text-green"}`}>Signed off</span> : null}
                  </span>
                </div>
              );
              return tv ? <div key={c.job.id}>{inner}</div> : <Link key={c.job.id} href={`/bodyshop/${c.job.id}#signoff`} className="block hover:bg-chip/60 rounded-control px-1 -mx-1">{inner}</Link>;
            })}
          </div>
        )}
      </section>
      <div className={`grid gap-4 ${tv ? "grid-cols-2 2xl:grid-cols-4" : "grid-cols-1 lg:grid-cols-2"}`}>
        {SECTIONS.map((section) => {
          const { now, coming } = sectionCars(cars, section);
          return (
            <section key={section} className={panel} data-section={section}>
              {title(SECTION_LABELS[section], `${now.length} now · ${coming.length} coming`)}
              {now.length === 0 && coming.length === 0 ? <p className={`${tv ? "text-white/60" : "text-muted"} text-sm`}>No cars.</p> : null}
              {now.map((c) => <CarLine key={c.job.id} c={c} section={section} tv={tv} today={today} />)}
              {coming.length ? <span className={`${tv ? "text-xs text-white/50" : "text-[11px] text-muted"} font-bold uppercase tracking-[0.1em] pt-1`}>Coming</span> : null}
              {coming.map((c) => <CarLine key={c.job.id} c={c} section={section} tv={tv} today={today} />)}
            </section>
          );
        })}
      </div>
    </div>
  );
}
