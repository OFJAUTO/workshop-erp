import { Badge, Button, Card, Empty, Input, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { reviewCatalogEntry } from "../actions";

/** Makes and models added during gate-in wait here for the owner or workshop manager. */
export default async function CatalogReviewPage() {
  await requirePermission("viewTablets");
  const supabase = await createClient();
  const [{ data: makes }, { data: models }] = await Promise.all([
    supabase.from("vehicle_makes").select("id, name, needs_review, is_active").eq("is_active", true).order("name"),
    supabase.from("vehicle_models").select("id, make_id, name, needs_review, is_active, make:vehicle_makes(name)").eq("is_active", true).order("name"),
  ]);
  const reviewMakes = (makes ?? []).filter((m) => m.needs_review);
  const reviewModels = ((models ?? []) as unknown as { id: string; make_id: string; name: string; needs_review: boolean; make: { name: string } | null }[]).filter((m) => m.needs_review);

  return (
    <>
      <PageHeader title="Makes and models" subtitle="Entries typed during gate-in wait here. Approve them (fixing the spelling if needed) or deactivate them." />

      <section className="flex flex-col gap-3">
        <SectionLabel right={`${reviewMakes.length + reviewModels.length}`}>To review</SectionLabel>
        {reviewMakes.length + reviewModels.length === 0 ? (
          <Empty title="Nothing to review" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {reviewMakes.map((m) => (
              <Card key={m.id} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{m.name}</span>
                  <Badge tone="amber">New make</Badge>
                </div>
                <form action={reviewCatalogEntry.bind(null, "make", m.id)} className="flex flex-col gap-2">
                  <Input name="name" defaultValue={m.name} aria-label="Corrected name" />
                  <div className="flex gap-2">
                    <Button type="submit" name="decision" value="approve" size="md" className="flex-1">
                      Approve
                    </Button>
                    <Button type="submit" name="decision" value="deactivate" tone="danger" size="md">
                      Deactivate
                    </Button>
                  </div>
                </form>
              </Card>
            ))}
            {reviewModels.map((m) => (
              <Card key={m.id} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">
                    {m.make?.name} {m.name}
                  </span>
                  <Badge tone="amber">New model</Badge>
                </div>
                <form action={reviewCatalogEntry.bind(null, "model", m.id)} className="flex flex-col gap-2">
                  <Input name="name" defaultValue={m.name} aria-label="Corrected name" />
                  <div className="flex gap-2">
                    <Button type="submit" name="decision" value="approve" size="md" className="flex-1">
                      Approve
                    </Button>
                    <Button type="submit" name="decision" value="deactivate" tone="danger" size="md">
                      Deactivate
                    </Button>
                  </div>
                </form>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel right={`${(makes ?? []).length} makes · ${(models ?? []).length} models`}>Current list</SectionLabel>
        <Card>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-sm">
            {(makes ?? []).map((m) => (
              <li key={m.id}>
                <span className="font-semibold">{m.name}</span>
                <span className="text-muted">
                  {" "}
                  · {((models ?? []) as unknown as { make_id: string; name: string }[]).filter((x) => x.make_id === m.id).map((x) => x.name).join(", ") || "no models yet"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </>
  );
}
