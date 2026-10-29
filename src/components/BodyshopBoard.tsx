import { SECTIONS, SECTION_LABELS, SIGNOFF_LABELS, type Section } from "@/lib/bodyshop-kinds";
import { sectionCars, type BoardCar } from "@/lib/bodyshop";
import { formatDate } from "@/lib/format";
import { formatPlate } from "@/lib/types";
import { CarCard } from "./CarCard";

const SHORT_SIGN: Record<string, string> = { manager: "Manager", ppf: "PPF", detailing: "Detailing", paint: "Paint" };

const carTitle = (c: BoardCar) => [c.job.vehicle?.make?.name, c.job.vehicle?.model?.name].filter(Boolean).join(" ");
const carPlate = (c: BoardCar) => (c.job.vehicle ? formatPlate(c.job.vehicle) : c.job.job_number);

/** One car in a section: the shared car card, with the section's stage, its people and the due day. */
function SectionCar({ c, section, today }: { c: BoardCar; section: Section | null; today: string }) {
  const stage = section && c.current?.section !== section ? c.stages.find((s) => s.section === section && s.status !== "done" && s.status !== "skipped") ?? c.current : c.current;
  const due = stage?.due_date ?? c.job.promised_at;
  const tone = due && due < today ? "red" : due === today ? "amber" : "normal";
  const doing = c.phase ? `${stage ? `${stage.label} · ` : ""}${c.phase}` : stage ? stage.label : c.job.status === "ready" || c.job.status === "pending_payment" ? "Ready, waiting for the handover" : "Waiting";
  return (
    <CarCard
      href={`/bodyshop/${c.job.id}`}
      pictureUrl={c.pictureUrl}
      plate={carPlate(c)}
      title={carTitle(c)}
      sub={[c.job.vehicle?.colour ?? null, c.job.job_number]}
      status={{ line: doing, detail: c.people.length ? c.people.map((p) => p.name).join(", ") : null }}
      alerts={due ? <span className={`text-xs ${tone === "red" ? "text-red font-bold" : tone === "amber" ? "text-amber font-bold" : "text-muted"}`} data-board-due>{tone === "red" ? `Late · ${formatDate(due)}` : tone === "amber" ? "Due today" : `Due ${formatDate(due)}`}</span> : null}
      tone={tone === "red" ? "red" : tone === "amber" ? "amber" : "none"}
      data-board-car={c.job.id}
      data-tone={tone}
    />
  );
}

/**
 * The one bodyshop board: a "Going out" strip at the top (cars due out today and tomorrow with their sign-offs),
 * then every section's cars in due order. Every car is drawn with the shared car card (29 October 2026, section 2).
 */
export function BodyshopBoard({ cars, goingOut, today, tomorrow }: { cars: BoardCar[]; goingOut: BoardCar[]; today: string; tomorrow: string }) {
  const title = (t: string, right?: string) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
      <span className="text-xs text-muted font-extrabold tracking-[0.1em] uppercase">{t}</span>
      {right ? <span className="text-xs text-muted">{right}</span> : null}
    </div>
  );
  const panel = "rounded-card border border-line bg-white p-4 flex flex-col gap-3";
  const before = cars.filter((c) => c.stages.length === 0);
  return (
    <div className="flex flex-col gap-4" data-bodyshop-board>
      <section className="rounded-card border-2 border-ink bg-white p-4 flex flex-col gap-3" data-going-out>
        {title("Going out", `today ${formatDate(today)} · tomorrow ${formatDate(tomorrow)}`)}
        {goingOut.length === 0 ? <p className="text-sm text-muted">Nothing due out today or tomorrow.</p> : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {goingOut.map((c) => {
              const when = c.job.promised_at === today ? "Today" : c.job.promised_at === tomorrow ? "Tomorrow" : formatDate(c.job.promised_at);
              const late = !!c.job.promised_at && c.job.promised_at < today;
              return (
                <CarCard
                  key={c.job.id}
                  href={`/bodyshop/${c.job.id}#signoff`}
                  pictureUrl={c.pictureUrl}
                  plate={carPlate(c)}
                  title={carTitle(c)}
                  sub={[c.job.vehicle?.colour ?? null, c.job.job_number]}
                  status={{ line: `Going out ${when === "Today" || when === "Tomorrow" ? when.toLowerCase() : when}`, detail: late ? "late" : null }}
                  tone={late ? "red" : "none"}
                  alerts={
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {c.signoff.needed.map((k) => {
                        const ok = c.signoff.signed.includes(k);
                        return <span key={k} className={`inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-bold whitespace-nowrap ${ok ? "bg-green-soft text-green" : "bg-chip text-muted"}`} title={SIGNOFF_LABELS[k]} data-signoff-chip={k} data-signed={ok}>{ok ? "✓ " : ""}{SHORT_SIGN[k]}</span>;
                      })}
                      {c.signoff.waitingOn.length === 0 && c.signoff.needed.length ? <span className="text-[11px] font-bold text-green">Signed off</span> : null}
                    </span>
                  }
                  data-going-out-car={c.job.id}
                />
              );
            })}
          </div>
        )}
      </section>
      {/* Cars with bodyshop work whose sections are not known yet (no stages, no quoted lines). */}
      {before.length ? (
        <section className={panel} data-before-bodyshop>
          {title("Before the bodyshop work", `${before.length}`)}
          {before.map((c) => <SectionCar key={c.job.id} c={c} section={null} today={today} />)}
        </section>
      ) : null}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {SECTIONS.map((section) => {
          const { now, coming } = sectionCars(cars, section);
          return (
            <section key={section} className={panel} data-section={section}>
              {title(SECTION_LABELS[section], `${now.length} now · ${coming.length} coming`)}
              {now.length === 0 && coming.length === 0 ? <p className="text-muted text-sm">No cars.</p> : null}
              {now.map((c) => <SectionCar key={c.job.id} c={c} section={section} today={today} />)}
              {coming.length ? <span className="text-[11px] text-muted font-bold uppercase tracking-[0.1em] pt-1">Coming</span> : null}
              {coming.map((c) => <SectionCar key={c.job.id} c={c} section={section} today={today} />)}
            </section>
          );
        })}
      </div>
    </div>
  );
}
