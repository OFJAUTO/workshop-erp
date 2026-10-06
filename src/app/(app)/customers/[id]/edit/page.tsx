import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CustomerRow } from "@/lib/types";
import { updateCustomer } from "../../actions";
import { CustomerForm } from "../../CustomerForm";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("editCustomers");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, customer_number, customer_type, full_name, company_name, phone, phone2, email, area, trn, is_vip, vip_note, notes, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const c = data as CustomerRow;

  return (
    <>
      <PageHeader title={`Edit ${c.company_name ?? c.full_name}`} subtitle={c.customer_number} />
      <Card className="max-w-3xl">
        <CustomerForm
          action={updateCustomer.bind(null, c.id)}
          mode="edit"
          initialValues={{
            customer_type: c.customer_type,
            full_name: c.full_name,
            company_name: c.company_name ?? "",
            phone: c.phone,
            phone2: c.phone2 ?? "",
            email: c.email ?? "",
            area: c.area ?? "",
            trn: c.trn ?? "",
            is_vip: c.is_vip ? "on" : "",
            vip_note: c.vip_note ?? "",
            notes: c.notes ?? "",
          }}
        />
      </Card>
    </>
  );
}
