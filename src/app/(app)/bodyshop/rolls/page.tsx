import { Badge, Button, Card, Empty, Input, LinkButton, Notice, PageHeader, SectionLabel, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { filmTypesOf, rollsWithUse } from "@/lib/film";
import { formatDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { finishRollAction, openRollAction } from "./actions";

export const dynamic = "force-dynamic";
const BODYSHOP_DEPTS = ["bodyshop", "paint", "ppf_tint", "detailing"];

/** Film and tint rolls: open one, see the metres left, finish it (waste checked, tint split over its cars). */
export default async function RollsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const mayTouch = !staff.viewingAs && (staff.role_id === "owner" || ((staff.role_id === "workshop_manager" || staff.role_id === "team_leader") && BODYSHOP_DEPTS.includes(staff.department_id ?? "")));
  if (!mayTouch && staff.role_id !== "accounts") return <Notice tone="error">Rolls are for the owner, the bodyshop manager and the team leaders.</Notice>;
  const { message, error } = await searchParams;
  const settings = await getSettings();
  const types = filmTypesOf(settings);
  const rolls = await rollsWithUse();
  const open = rolls.filter((r) => !r.finished_at);
  const finished = rolls.filter((r) => r.finished_at).slice(0, 20);
  const typeName = (key: string | null) => types.find((t) => t.key === key)?.name ?? (key ?? "");
  return (
    <>
      <PageHeader title="Film and tint rolls" subtitle="Opening a roll registers it; every car's metres come off it. Finishing a film roll checks the waste; finishing a tint roll splits its real price over the cars that used it." actions={<LinkButton href="/bodyshop" tone="secondary" size="lg">Bodyshop board</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {mayTouch ? (
        <Card className="flex flex-col gap-3" data-open-roll>
          <SectionLabel>Open a roll</SectionLabel>
          <form action={openRollAction} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Kind
              <Select name="kind" defaultValue="film" className="min-w-36"><option value="film">Film (PPF)</option><option value="tint">Tint</option></Select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Film type (for film)
              <Select name="film_key" defaultValue={types[0]?.key ?? ""} className="min-w-44">{types.map((t) => <option key={t.key} value={t.key}>{t.name} · AED {t.roll_price} / {t.roll_m} m</option>)}</Select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Roll name or number
              <Input name="name" placeholder="Roll #12" required className="min-w-40" />
            </label>
            <Button type="submit" size="md">Register the roll</Button>
          </form>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${open.length}`}>Open rolls</SectionLabel>
        {open.length === 0 ? <Empty title="No open rolls" /> : (
          <ul className="divide-y divide-line">
            {open.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm" data-roll={r.name}>
                <Badge tone="ink">{r.kind === "tint" ? "Tint" : "Film"}</Badge>
                <span className="font-bold">{r.name}</span>
                {r.kind === "film" ? <span className="text-muted">{typeName(r.film_key)} · {r.usedMetres} m used{r.metresLeft !== null ? ` · ${r.metresLeft} m left of ${r.length_m} m` : ""}</span> : <span className="text-muted">{r.usedJobs} car{r.usedJobs === 1 ? "" : "s"} so far · AED {r.price_aed} the roll</span>}
                <span className="text-xs text-muted">opened {formatDate(r.opened_at)}</span>
                {mayTouch ? <form action={finishRollAction.bind(null, r.id)} className="ml-auto"><Button type="submit" tone="secondary" size="md" data-finish-roll>Roll finished</Button></form> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${finished.length}`}>Finished rolls</SectionLabel>
        {finished.length === 0 ? <Empty title="None yet" /> : (
          <ul className="divide-y divide-line">
            {finished.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Badge tone="neutral">{r.kind === "tint" ? "Tint" : "Film"}</Badge>
                <span className="font-semibold">{r.name}</span>
                <span className="text-xs text-muted">finished {formatDate(r.finished_at!)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
