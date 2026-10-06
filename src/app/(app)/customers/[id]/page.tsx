import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, DescriptionList, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type CustomerContactRow, type CustomerRow, type VehicleRow } from "@/lib/types";
import { addContact, setContactActive, setContactApproval, setCustomerActive } from "../actions";
import { ContactForm } from "./ContactForm";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const staff = await requirePermission("viewCustomers");
  const { id } = await params;
  const { message, error } = await searchParams;
  const canEdit = can(staff.role_id as RoleId, "editCustomers");

  const supabase = await createClient();
  const [{ data: cData }, { data: contactsData }, { data: carsData }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, customer_number, customer_type, full_name, company_name, phone, phone2, email, area, trn, is_vip, vip_note, notes, is_active, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("customer_contacts")
      .select("id, customer_id, name, phone, relationship, can_approve, is_active")
      .eq("customer_id", id)
      .order("is_active", { ascending: false })
      .order("name"),
    supabase
      .from("vehicles")
      .select("id, customer_id, plate_country, plate_emirate, plate_code, plate_number, vin, make_id, model_id, variant, model_year, colour, fuel_type, last_mileage, notes, is_active, created_at, updated_at, make:vehicle_makes(name), model:vehicle_models(name)")
      .eq("customer_id", id)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (!cData) notFound();
  const c = cData as CustomerRow;
  const contacts = (contactsData ?? []) as CustomerContactRow[];
  const cars = (carsData ?? []) as unknown as (VehicleRow & { make: { name: string } | null; model: { name: string } | null })[];

  return (
    <>
      <PageHeader
        title={c.company_name ?? c.full_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{c.customer_number}</span>
            {c.company_name ? <span>· {c.full_name}</span> : null}
            {c.is_vip ? <Badge tone="ink">VIP</Badge> : null}
            {!c.is_active ? <Badge tone="red">Archived</Badge> : null}
          </span>
        }
        actions={
          canEdit ? (
            <>
              <LinkButton href={`/vehicles/new?customer=${c.id}`} tone="secondary">
                Add a car
              </LinkButton>
              <LinkButton href={`/customers/${c.id}/edit`}>Edit</LinkButton>
            </>
          ) : undefined
        }
      />

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {c.is_vip && c.vip_note ? (
        <Card className="border-ink flex flex-col gap-1">
          <SectionLabel>VIP handling note</SectionLabel>
          <p className="text-[15px] font-medium whitespace-pre-wrap">{c.vip_note}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <SectionLabel>Details</SectionLabel>
            <DescriptionList
              items={[
                { label: "Type", value: c.customer_type === "company" ? "Company" : "Individual" },
                { label: "Phone (WhatsApp)", value: c.phone },
                { label: "Second phone", value: c.phone2 },
                { label: "Email", value: c.email },
                { label: "Area", value: c.area },
                { label: "TRN", value: c.trn },
                { label: "Notes", value: c.notes ? <span className="whitespace-pre-wrap">{c.notes}</span> : null },
                { label: "Added", value: formatDateTime(c.created_at) },
                { label: "Last change", value: formatDateTime(c.updated_at) },
              ]}
            />
          </Card>

          <section className="flex flex-col gap-3">
            <SectionLabel right={`${cars.filter((v) => v.is_active).length} active`}>Cars</SectionLabel>
            {cars.length === 0 ? (
              <Empty title="No cars yet" />
            ) : (
              <div className="flex flex-col gap-2">
                {cars.map((v) => (
                  <Link key={v.id} href={`/vehicles/${v.id}`} className="block">
                    <Card className="flex flex-wrap items-center gap-x-6 gap-y-1 hover:border-ink py-4">
                      <span className="font-bold tracking-[0.03em] text-[17px]">{formatPlate(v)}</span>
                      <span className="text-sm font-medium">
                        {[v.make?.name, v.model?.name, v.variant].filter(Boolean).join(" ")}
                        {v.model_year ? ` · ${v.model_year}` : ""}
                        {v.colour ? ` · ${v.colour}` : ""}
                      </span>
                      {!v.is_active ? <Badge tone="red">Inactive</Badge> : null}
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <SectionLabel>Contacts</SectionLabel>
            <p className="text-xs text-muted">Drivers, assistants and others who bring cars in. Tick who may approve work.</p>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted">No extra contacts.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {contacts.map((ct) => (
                  <li key={ct.id} className={`py-3 flex flex-col gap-2 ${ct.is_active ? "" : "opacity-60"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex flex-col">
                        <span className="font-semibold">{ct.name}</span>
                        <span className="text-xs text-muted">
                          {ct.phone}
                          {ct.relationship ? ` · ${ct.relationship}` : ""}
                        </span>
                      </span>
                      {ct.can_approve ? <Badge tone="green">May approve work</Badge> : <Badge>Cannot approve</Badge>}
                    </div>
                    {canEdit ? (
                      <div className="flex flex-wrap gap-2">
                        <form action={setContactApproval.bind(null, c.id, ct.id, !ct.can_approve)}>
                          <Button type="submit" tone="secondary" size="md">
                            {ct.can_approve ? "Remove approval" : "Allow to approve"}
                          </Button>
                        </form>
                        <form action={setContactActive.bind(null, c.id, ct.id, !ct.is_active)}>
                          <Button type="submit" tone="ghost" size="md">
                            {ct.is_active ? "Remove contact" : "Restore"}
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? <ContactForm action={addContact.bind(null, c.id)} /> : null}
          </Card>

          {canEdit ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Record</SectionLabel>
              <form action={setCustomerActive.bind(null, c.id, !c.is_active)}>
                <Button type="submit" tone={c.is_active ? "danger" : "secondary"} className="w-full">
                  {c.is_active ? "Archive customer" : "Re-activate customer"}
                </Button>
              </form>
              <p className="text-xs text-muted">Archived customers are hidden from searches. Nothing is deleted.</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
