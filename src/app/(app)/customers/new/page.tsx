import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createCustomer } from "../actions";
import { CustomerForm } from "../CustomerForm";

export default async function NewCustomerPage() {
  const staff = await requirePermission("editCustomers");
  return (
    <>
      <PageHeader title="Add customer" />
      <Card className="max-w-3xl">
        <CustomerForm action={createCustomer} mode="create" isOwner={staff.role_id === "owner"} />
      </Card>
    </>
  );
}
