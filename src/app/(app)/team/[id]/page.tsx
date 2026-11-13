import { notFound } from "next/navigation";
import { placeWords, roleTitleOf } from "@/lib/teams";
import { Avatar, Badge, Button, Card, ChoiceButtons, DescriptionList, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { DeviceRow, StaffPrivateRow, StaffRow } from "@/lib/types";
import { createSetupLink, resetPin, setLoginType, setStaffActive, updateStaff, uploadStaffPhoto } from "../actions";
import { StaffForm } from "../StaffForm";
import { PinResetForm, PhotoForm, CopyLink } from "./parts";
import { SignInLog } from "@/components/SignInLog";
import { passkeyPerson, passkeyRole } from "@/lib/passkey-rules";
import { passkeyRollout, passkeysReady } from "@/lib/passkey-server";
import { phonesOf, signInLog } from "@/lib/sign-in-data";
import { removePasskey, resetPasskeys } from "../passkey-actions";
import { ResetCodeButton } from "@/components/ResetCodeButton";
import { RemovePhoneForm, ResetPhonesForm } from "../SignInForms";

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
      .select("id, full_name, display_name, role_id, department_id, team, employee_number, login_type, is_head_accountant, photo_path, colour, break_start, break_end, is_active, disabled_at, created_at, updated_at")
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

  // Passkeys (7 November 2026): the person's phones, the owner's Remove / Reset, and their sign-in log.
  const pkReady = await passkeysReady();
  const pkRole = pkReady && passkeyRole(staff);
  const pkOn = pkRole && passkeyPerson(staff, await passkeyRollout());
  const [phones, pkLog] = pkRole ? await Promise.all([phonesOf(staff.id, { withRemoved: true }), signInLog({ staffId: staff.id, limit: 20 }).catch(() => [])]) : [[], []];
  const activePhones = phones.filter((p) => !p.removed_at);

  return (
    <>
      <PageHeader
        title={staff.full_name}
        subtitle={
          <span className="flex flex-wrap gap-1.5 items-center">
            {roleTitleOf({ ...staff, team: (staff as { team?: string | null }).team ?? null }, ROLE_LABELS[staff.role_id as RoleId])}
            {placeWords({ ...staff, team: (staff as { team?: string | null }).team ?? null }) ? ` · ${placeWords({ ...staff, team: (staff as { team?: string | null }).team ?? null })}` : ""}
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
                team: (staff as { team?: string | null }).team ?? "",
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

          {pkReady ? (
            <Card className="flex flex-col gap-4" id="sign-in" data-team-sign-in>
              <SectionLabel right={pkRole ? `${activePhones.length}` : undefined}>Sign-in phones (passkeys)</SectionLabel>
              {!pkRole ? (
                <p className="text-sm text-muted">Not a passkey role: this person keeps their {staff.login_type === "pin" ? "PIN" : staff.login_type === "both" ? "password and PIN" : "password"} login as it is.</p>
              ) : (
                <>
                  {!pkOn ? <p className="text-sm text-muted">Passkeys are not switched on for this person yet (Team › Sign-ins).</p> : null}
                  {activePhones.length === 0 ? <p className="text-sm font-semibold" data-no-phone>No phone set up yet. At their next sign-in the ERP asks them to set one up.</p> : null}
                  <ul className="flex flex-col divide-y divide-line">
                    {phones.map((p) => (
                      <li key={p.id} className="py-2 flex flex-col gap-2" data-team-phone={p.id} data-removed={p.removed_at ? "1" : "0"}>
                        <div className="flex flex-col gap-0.5">
                          <span className={`font-semibold ${p.removed_at ? "line-through text-muted" : ""}`}>{p.name}</span>
                          <span className="text-xs text-muted">
                            Added {formatDateTime(p.created_at)} · {p.last_used_at ? `last used ${formatDateTime(p.last_used_at)}` : "not used yet"}
                            {p.removed_at ? ` · removed ${formatDateTime(p.removed_at)}${p.removedBy ? ` by ${p.removedBy}` : ""}: ${p.removed_reason ?? ""}` : ""}
                          </span>
                        </div>
                        {!p.removed_at && !owner.viewingAs && !owner.actingAs ? (
                          <details className="group">
                            <summary className="list-none cursor-pointer text-sm font-semibold text-red underline underline-offset-4 min-h-11 flex items-center" data-remove-open={p.id}>
                              Remove this phone…
                            </summary>
                            <div className="pt-2">
                              <RemovePhoneForm action={removePasskey.bind(null, staff.id, p.id)} name={p.name} />
                            </div>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {activePhones.length > 0 && !owner.viewingAs && !owner.actingAs ? (
                    <details className="border-t border-line pt-3">
                      <summary className="list-none cursor-pointer text-sm font-semibold underline underline-offset-4 min-h-11 flex items-center" data-reset-open>
                        Reset passkeys (remove every phone)…
                      </summary>
                      <div className="pt-2">
                        <ResetPhonesForm action={resetPasskeys.bind(null, staff.id)} />
                      </div>
                    </details>
                  ) : null}
                  <p className="text-xs text-muted">Only you can remove a phone or reset passkeys. The person is told, and it is written in the log below.</p>
                  {!owner.viewingAs && !owner.actingAs ? <ResetCodeButton staffId={staff.id} name={staff.display_name} /> : null}
                  <div className="border-t border-line pt-3 flex flex-col gap-2">
                    <p className="text-sm font-semibold">Sign-ins and changes</p>
                    <SignInLog lines={pkLog} />
                  </div>
                </>
              )}
            </Card>
          ) : null}

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
