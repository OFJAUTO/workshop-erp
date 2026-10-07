import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createStaff } from "../actions";
import { StaffForm } from "../StaffForm";

export default async function NewStaffPage() {
  await requirePermission("manageTeam");
  return (
    <>
      <PageHeader title="Add staff member" subtitle="They can log in as soon as you save." />
      <Card className="max-w-3xl">
        <StaffForm action={createStaff} mode="create" initialValues={{ department_id: "mechanical" }} />
      </Card>
    </>
  );
}
