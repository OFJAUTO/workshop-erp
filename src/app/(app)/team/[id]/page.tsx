import { notFound } from "next/navigation";
import { Avatar, Badge, Button, Card, DescriptionList, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { DEPARTMENT_LABELS, ROLE_LABELS, type DepartmentId, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { StaffPrivateRow, StaffRow } from "@/lib/types";
import { createSetupLink, resetPin, setStaffActive, updateStaff, uploadStaffPhoto } from "../actions";
import { StaffForm } from "../StaffForm";
import { PinResetForm, PhotoForm, CopyLink } from "./parts";

export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ setup?: string; link?: string; error?: string; message?: string }>;
}) {
  const owner = await requirePermission("manageTeam");
  const { id } = await params;
  const { setup, link, error, message } = await searchParams;

  const supabase = await createClient();
  const [{ data: staffData }, { data: privData }] = await Promise.all([
    supabase
      .from("staff")
      .select("id, full_name, display_name, role_id, department_id, employee_number, login_type, is_head_accountant, photo_path, is_active, disabled_at, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("staff_private").select("staff_id, phone, email, pin_hash, pin_failed_attempts, pin_locked_until, pin_updated_at").eq("staff_id", id).maybeSingle(),
  ]);
  if (!staffData) notFound();
  const staff = staffData as StaffRow;
  const priv = (privData ?? null) as StaffPrivateRow | null;

  let photoUrl: string | null = null;
  if (staff.photo_path) {
    const { data } = await supabase.storage.from("staff-photos").createSignedUrl(staff.photo_path, 3600);
    photoUrl = data?.signedUrl ?? null;
  }

  const isSelf = staff.id === owner.id;
  const update = updateStaff.bind(null, staff.id);
  const reset = resetPin.bind(null, staff.id);
  const upload = uploadStaffPhoto.bind(null, staff.id);
  const makeLink = createSetupLink.bind(null, staff.id);
  const toggleActive = setStaffActive.bind(null, staff.id, !staff.is_active);

  return (
    <>
      <PageHeader
        title={staff.full_name}
        subtitle={
          <span className="flex flex-wrap gap-1.5 items-center">
            {ROLE_LABELS[staff.role_id as RoleId]}
            {staff.department_id ? ` · ${DEPARTMENT_LABELS[staff.department_id as DepartmentId]}` : ""}
            {!staff.is_active ? <Badge tone="red">Disabled</Badge> : null}
          </span>
        }
      />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      {setup && staff.login_type === "password" ? (
        <Notice tone="info">
          Login created. Make a setup link below and send it to {staff.display_name} on WhatsApp so they can choose
          a password.
        </Notice>
      ) : null}

      {link ? (
        <Card className="flex flex-col gap-3">
          <SectionLabel>One-time setup link for {staff.display_name}</SectionLabel>
          <p className="text-sm text-muted">
            Send this link to them. It works once and expires in about an hour. They open it, choose a password and
            are signed in.
          </p>
          <CopyLink link={link} />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card>
            <StaffForm
              action={update}
              mode="edit"
              initialValues={{
                full_name: staff.full_name,
                display_name: staff.display_name,
                role_id: staff.role_id,
                department_id: staff.department_id ?? "",
                employee_number: staff.employee_number ?? "",
                login_type: staff.login_type,
                email: priv?.email ?? "",
                phone: priv?.phone ?? "",
                is_head_accountant: staff.is_head_accountant ? "on" : "",
              }}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <SectionLabel>Photo</SectionLabel>
            <div className="flex items-center gap-4">
              <Avatar name={staff.full_name} photoUrl={photoUrl} size={72} />
              <PhotoForm action={upload} />
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Login</SectionLabel>
            <DescriptionList
              items={[
                { label: "Method", value: staff.login_type === "pin" ? "Shared tablet, name and PIN" : "Office PC, email and password" },
                { label: "Login email", value: staff.login_type === "password" ? priv?.email : "Not needed" },
                ...(staff.login_type === "pin"
                  ? [
                      { label: "PIN set", value: priv?.pin_updated_at ? formatDateTime(priv.pin_updated_at) : "No PIN yet" },
                      {
                        label: "Locked",
                        value:
                          priv?.pin_locked_until && new Date(priv.pin_locked_until) > new Date()
                            ? `Until ${formatDateTime(priv.pin_locked_until)}`
                            : "No",
                      },
                    ]
                  : []),
              ]}
            />
            {staff.login_type === "pin" ? (
              <PinResetForm action={reset} />
            ) : (
              <form action={makeLink}>
                <Button type="submit" tone="secondary" className="w-full">
                  Make a password setup link
                </Button>
              </form>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionLabel>Account</SectionLabel>
            <DescriptionList
              items={[
                { label: "Added", value: formatDateTime(staff.created_at) },
                { label: "Last change", value: formatDateTime(staff.updated_at) },
                ...(staff.disabled_at ? [{ label: "Disabled", value: formatDateTime(staff.disabled_at) }] : []),
              ]}
            />
            {isSelf ? (
              <p className="text-xs text-muted">This is your own account. It cannot be disabled from here.</p>
            ) : (
              <form action={toggleActive}>
                <Button type="submit" tone={staff.is_active ? "danger" : "secondary"} className="w-full">
                  {staff.is_active ? "Disable account" : "Enable account"}
                </Button>
              </form>
            )}
            <p className="text-xs text-muted">
              Disabled people cannot log in. Their history stays on record. Nothing is ever deleted.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
