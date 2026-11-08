import Link from "next/link";
import { Badge, Card, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { SignInLog } from "@/components/SignInLog";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, type RoleId } from "@/lib/roles";
import { passkeyRollout, passkeysReady } from "@/lib/passkey-server";
import { passkeyOverview, signInLog } from "@/lib/sign-in-data";
import { setPasskeyRollout } from "../passkey-actions";
import { RolloutForm } from "../SignInForms";

export const dynamic = "force-dynamic";

/**
 * The owner's sign-in page (7 November 2026): who passkeys are on for, each passkey person's phones, last passkey
 * sign-in, password backup uses and skipped setups (30 days), and the log of every sign-in and every change.
 */
export default async function SignInsPage() {
  const owner = await requirePermission("manageTeam");
  if (!(await passkeysReady())) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Sign-ins" />
        <Notice tone="info">Passkeys are not switched on yet: the database change is waiting for “apply”.</Notice>
      </div>
    );
  }
  const rollout = await passkeyRollout();
  const [rows, log] = await Promise.all([passkeyOverview(rollout), signInLog({ limit: 100 })]);

  return (
    <div className="flex flex-col gap-5" data-sign-ins-page>
      <PageHeader title="Sign-ins" subtitle="Passkeys (phones), password backup use, and every change to how people sign in." />

      <Card className="flex flex-col gap-3" data-rollout-card>
        <SectionLabel>Passkeys are on for</SectionLabel>
        {owner.viewingAs || owner.actingAs ? <p className="text-sm text-muted">Leave View as / Act as to change this.</p> : <RolloutForm action={setPasskeyRollout} mode={rollout} />}
        <p className="text-xs text-muted">
          Passkey roles: owner, service advisors, parts, gate-in, accounts, QC and the workshop manager. The bodyshop manager, team leaders and technicians keep their login as it is.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>People</SectionLabel>
        <ul className="flex flex-col divide-y divide-line" data-passkey-people>
          {rows.map((r) => (
            <li key={r.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-passkey-person={r.id}>
              <Link href={`/team/${r.id}#sign-in`} className="font-semibold underline-offset-4 hover:underline min-w-0 break-words">
                {r.name}
              </Link>
              <span className="text-xs text-muted">{ROLE_LABELS[r.role as RoleId] ?? r.role}</span>
              {!r.on ? (
                <Badge tone="outline">Not switched on yet</Badge>
              ) : r.phones > 0 ? (
                <Badge tone="green" data-phones={r.phones}>
                  {r.phones} phone{r.phones === 1 ? "" : "s"}
                </Badge>
              ) : (
                <Badge tone="red" data-phones="0">No phone yet</Badge>
              )}
              <span className="text-xs text-muted">{r.lastPasskey ? `last passkey sign-in ${formatDateTime(r.lastPasskey)}` : "no passkey sign-in yet"}</span>
              {r.backupUses30 ? <Badge tone="amber">Password used {r.backupUses30}× (30 days)</Badge> : null}
              {r.skips30 ? <Badge tone="amber">Skipped setup {r.skips30}×</Badge> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Every sign-in and change (newest first)</SectionLabel>
        <SignInLog lines={log} showPerson />
      </Card>
    </div>
  );
}
