import { notFound } from "next/navigation";
import { Avatar, Badge, Button, Card, ChoiceButtons, DescriptionList, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { DEPARTMENT_LABELS, ROLE_LABELS, type DepartmentId, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { DeviceRow, StaffPrivateRow, StaffRow } from "@/lib/types";
import { createSetupLink, resetPin, setLoginType, setStaffActive, updateStaff, uploadStaffPhoto } from "../actions";
import { StaffForm } from "../StaffForm";
import { PinResetForm, PhotoForm, CopyLink } from "./parts";

const LOGIN_LABEL = { password: "PC login (email and password)", pin: "Handheld login (name and PIN)", both: "Both: PC and any registered handheld" } as const;

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
  const [{ data: staffData }, { data: privData }, { data: deviceRows }] = await Promise.all([
    supabase
      .from("staff")
      .select("id, full_name, display_name, role_id, department_id, employee_number, login_type, is_head_accountant, photo_path, colour, break_start, break_end, is_active, disabled_at, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("staff_private").select("staff_id, phone, email, pin_hash, pin_failed_attempts, pin_locked_until, pin_updated_at").eq("staff_id", id).maybeSingle(),
    supabase.from("devices").select("id, name, location, kind, staff_id, is_active, registered_at, registered_by, last_seen_at, last_staff_id").eq("staff_id", id).eq("is_active", true),
  ]);
  if (!staffData) notFound();
  const staff = staffData as StaffRow;
  const priv = (privData ?? null) as StaffPrivateRow | null;
  const personalDevices = (deviceRows ?? []) as DeviceRow[];

  let photoUrl: string | null = null;
  if (staff.photo_path) {
    const { data } = await supabase.storage.from("staff-photos").createSignedUrl(staff.photo_path, 3600);
    photoUrl = data?.signedUrl ?? null;
  }

  const isSelf = staff.id === owner.id;
  const usesPassword = staff.login_type !== "pin";
  const usesPin = staff.login_type !== "password";

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

      {setup && usesPassword ? (
        <Notice tone="info">Login created. Make a setup link below and send it to {staff.display_name} on WhatsApp so they can choose a password.</Notice>
      ) : null}

      {link ? (
        <Card className="flex flex-col gap-3">
          <SectionLabel>Setup link for {staff.display_name}</SectionLabel>
          <p className="text-sm text-muted">
            Send this link to them on WhatsApp. It lasts 24 hours and is used up only when they save a password. They open it, choose a password and are signed in.
          </p>
          <CopyLink link={link} />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card>
            <StaffForm
              action={updateStaff.bind(null, staff.id)}
              mode="edit"
              initialValues={{
                full_name: staff.full_name,
                display_name: staff.display_name,
                role_id: staff.role_id,
                department_id: staff.department_id ?? "",
                break_start: (staff as { break_start?: string | null }).break_start ?? "",
                break_end: (staff as { break_end?: string | null }).break_end ?? "",
                employee_number: staff.employee_number ?? "",
                login_type: staff.login_type,
                email: priv?.email ?? "",
                phone: priv?.phone ?? "",
                is_head_accountant: staff.is_head_accountant ? "on" : "",
                colour: staff.colour ?? "",
              }}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <SectionLabel>Photo</SectionLabel>
            <div className="flex items-center gap-4">
              <Avatar name={staff.full_name} photoUrl={photoUrl} size={72} />
              <PhotoForm action={uploadStaffPhoto.bind(null, staff.id)} />
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Login method</SectionLabel>
            <p className="text-sm font-semibold">{LOGIN_LABEL[staff.login_type]}</p>
            {!isSelf ? (
              <form action={setLoginType.bind(null, staff.id)} className="flex flex-col gap-3">
                <ChoiceButtons
                  name="login_type"
                  columns={3}
                  defaultValue={staff.login_type}
                  options={[
                    { value: "password", label: "PC" },
                    { value: "pin", label: "Handheld" },
                    { value: "both", label: "Both" },
                  ]}
                />
                <Button type="submit" tone="secondary">
                  Change login method
                </Button>
                <p className="text-xs text-muted">Only the owner can change this. PC login needs an email; handheld login needs a PIN.</p>
              </form>
            ) : (
              <p className="text-xs text-muted">Your own login method stays PC login.</p>
            )}
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionLabel>Password and PIN</SectionLabel>
            <DescriptionList
              items={[
                { label: "Login email", value: usesPassword ? priv?.email : "Not needed" },
                ...(usesPin
                  ? [
                      { label: "PIN set", value: priv?.pin_updated_at ? formatDateTime(priv.pin_updated_at) : "No PIN yet" },
                      {
                        label: "PIN locked",
                        value: priv?.pin_locked_until && new Date(priv.pin_locked_until) > new Date() ? `Until ${formatDateTime(priv.pin_locked_until)}` : "No",
                      },
                    ]
                  : []),
              ]}
            />
            {usesPassword ? (
              <form action={createSetupLink.bind(null, staff.id)}>
                <Button type="submit" tone="secondary" className="w-full">
                  Make a password setup link
                </Button>
              </form>
            ) : null}
            {usesPin || !priv?.pin_hash ? <PinResetForm action={resetPin.bind(null, staff.id)} /> : null}
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionLabel right={`${personalDevices.length}`}>Personal devices</SectionLabel>
            {personalDevices.length === 0 ? (
              <p className="text-sm text-muted">None. Register a phone or tablet as a personal device from that device, on the Tablets page.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {personalDevices.map((d) => (
                  <li key={d.id} className="py-2 text-sm">
                    <span className="font-semibold">{d.name}</span>
                    <span className="text-muted"> · last used {d.last_seen_at ? formatDateTime(d.last_seen_at) : "never"}</span>
                  </li>
                ))}
              </ul>
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
              <form action={setStaffActive.bind(null, staff.id, !staff.is_active)}>
                <Button type="submit" tone={staff.is_active ? "danger" : "secondary"} className="w-full">
                  {staff.is_active ? "Disable account" : "Enable account"}
                </Button>
              </form>
            )}
            <p className="text-xs text-muted">Disabled people cannot log in. Their history stays on record. Nothing is ever deleted.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
