import { headers } from "next/headers";
import { Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { PasskeySetup } from "@/components/PasskeySetup";
import { SignInLog } from "@/components/SignInLog";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { PASSWORD_RULE_WORDS } from "@/lib/password-rules";
import { passkeyOnFor } from "@/lib/passkey-server";
import { phonesOf, signInLog } from "@/lib/sign-in-data";

export const dynamic = "force-dynamic";

/**
 * My sign-in (7 November 2026): my phones, "Add another phone" (approved with a phone already set up), change my
 * password, and my last sign-ins. Removing a phone is the owner's alone.
 */
export default async function MySignInPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  const staff = await requireStaff();
  if (staff.viewingAs || staff.actingAs) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="My sign-in" />
        <Notice tone="info">Each person sees and sets up their own sign-in. Leave View as / Act as to see yours.</Notice>
      </div>
    );
  }
  const on = await passkeyOnFor(staff);
  const phones = on ? await phonesOf(staff.id) : [];
  const log = on ? await signInLog({ staffId: staff.id, limit: 15 }).catch(() => []) : [];
  const touchGuess = /iPhone|iPad|Android|Mobile/.test((await headers()).get("user-agent") ?? "");

  return (
    <div className="flex flex-col gap-5" data-my-sign-in>
      <PageHeader title="My sign-in" subtitle={on ? "You sign in with your phone (passkey). Your password is the backup." : "How you sign in to the ERP."} />
      {message ? <Notice tone="success">{message}</Notice> : null}

      {on ? (
        <Card className="flex flex-col gap-4" id="phones">
          <SectionLabel>My phones</SectionLabel>
          {phones.length ? (
            <ul className="flex flex-col divide-y divide-line" data-my-phones>
              {phones.map((p) => (
                <li key={p.id} className="py-2 flex flex-col gap-0.5" data-my-phone={p.id}>
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-muted">
                    Added {formatDateTime(p.created_at)} · {p.last_used_at ? `last used ${formatDateTime(p.last_used_at)}` : "not used yet"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No phone set up yet.</p>
          )}
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="font-semibold">{phones.length ? "Add another phone" : "Set up your phone"}</p>
            <PasskeySetup hasPhones={phones.length > 0} touchGuess={touchGuess} />
          </div>
          <p className="text-xs text-muted">Lost a phone? Tell the owner straight away: only the owner can remove it. Until then, sign in with your password.</p>
        </Card>
      ) : null}

      {staff.login_type !== "pin" ? (
        <Card className="flex flex-col gap-3">
          <SectionLabel>Password</SectionLabel>
          <p className="text-sm text-muted">{PASSWORD_RULE_WORDS}</p>
          <LinkButton href="/auth/set-password" tone="secondary" className="self-start" data-change-password>
            Change my password
          </LinkButton>
        </Card>
      ) : null}

      {on ? (
        <Card className="flex flex-col gap-3">
          <SectionLabel>My last sign-ins</SectionLabel>
          <SignInLog lines={log} />
        </Card>
      ) : null}
    </div>
  );
}
