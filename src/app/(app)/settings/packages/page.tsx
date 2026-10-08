import { Button, Card, ChoiceButtons, Field, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { JOB_DEPARTMENTS } from "@/lib/inspection";
import { aed } from "@/lib/quotes";
import { createAdminClient } from "@/lib/supabase/admin";
import { savePackage, setPackageActive } from "./actions";

type Pkg = { id: string; name: string; department: string; price_aed: number; description: string | null; is_active: boolean };

/** Fixed-price packages: name, department, price and description. The advisor picks them on a quotation. */
export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("managePackages");
  const { message, error } = await searchParams;
  const { data } = await createAdminClient().from("packages").select("id, name, department, price_aed, description, is_active").order("is_active", { ascending: false }).order("name");
  const packages = ((data ?? []) as Pkg[]).map((p) => ({ ...p, price_aed: Number(p.price_aed) }));
  const deptOptions = JOB_DEPARTMENTS.map((d) => ({ value: d.value, label: d.label }));

  return (
    <>
      <PageHeader title="Fixed-price packages" subtitle="What the advisor can add to a quotation with one tap, at a set price before VAT." actions={<LinkButton href="/settings" tone="secondary" size="lg">Settings</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-col gap-4">
        <SectionLabel>Add a package</SectionLabel>
        <form action={savePackage.bind(null, null)} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Name">
              <Input name="name" required placeholder="For example: Minor service" />
            </Field>
            <Field label="Price (AED, before VAT)">
              <Input name="price_aed" inputMode="decimal" required />
            </Field>
          </div>
          <Field label="Department">
            <ChoiceButtons name="department" columns={3} defaultValue="both" options={deptOptions} />
          </Field>
          <Field label="Description" optional hint="What is included. Shown to the customer.">
            <Textarea name="description" rows={2} />
          </Field>
          <div>
            <Button type="submit">Add package</Button>
          </div>
        </form>
      </Card>

      <section className="flex flex-col gap-3">
        <SectionLabel right={`${packages.length}`}>Packages</SectionLabel>
        {packages.length === 0 ? <p className="text-sm text-muted">No packages yet.</p> : null}
        {packages.map((p) => (
          <Card key={p.id} className={`flex flex-col gap-3 ${p.is_active ? "" : "opacity-60"}`}>
            <form action={savePackage.bind(null, p.id)} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Name">
                  <Input name="name" defaultValue={p.name} required />
                </Field>
                <Field label="Price (AED, before VAT)">
                  <Input name="price_aed" defaultValue={String(p.price_aed)} inputMode="decimal" required />
                </Field>
                <Field label="Department">
                  <ChoiceButtons name="department" columns={3} defaultValue={p.department} options={deptOptions} />
                </Field>
              </div>
              <Field label="Description" optional>
                <Textarea name="description" defaultValue={p.description ?? ""} rows={2} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="md">Save</Button>
                <span className="text-sm text-muted">{aed(p.price_aed)} before VAT</span>
              </div>
            </form>
            <form action={setPackageActive.bind(null, p.id, !p.is_active)}>
              <Button type="submit" tone="ghost" size="md">
                {p.is_active ? "Hide from quotations" : "Show again"}
              </Button>
            </form>
          </Card>
        ))}
      </section>
    </>
  );
}
