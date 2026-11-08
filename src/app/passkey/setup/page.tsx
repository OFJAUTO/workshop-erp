import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PublicShell } from "@/components/Shell";
import { Card, LinkButton } from "@/components/ui";
import { PasskeySetup } from "@/components/PasskeySetup";
import { getCurrentStaff } from "@/lib/auth";
import { passkeyCount, passkeyOnFor, safeNext } from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

/**
 * "Set up your phone" (7 November 2026): every passkey user with no phone yet lands here after signing in with the
 * password or the PIN (a new person straight after choosing their password). "Not now" is allowed; it is logged and
 * the page comes back at the next sign-in.
 */
export default async function PasskeySetupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.viewingAs || staff.actingAs || !(await passkeyOnFor(staff))) redirect(next);
  const phones = await passkeyCount(staff.id);
  const touchGuess = /iPhone|iPad|Android|Mobile/.test((await headers()).get("user-agent") ?? "");

  return (
    <PublicShell>
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg flex flex-col gap-5" data-passkey-setup-page>
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold">Set up your phone to sign in</h1>
            <p className="text-sm text-muted">
              {staff.display_name}, from now on you sign in with your phone: no password to type. It takes about a minute, once.
            </p>
          </div>

          {phones > 0 ? (
            <Card className="flex flex-col gap-3">
              <p className="font-semibold">Your phone is already set up ✓</p>
              <LinkButton href={next} size="lg" className="w-full">
                Continue
              </LinkButton>
            </Card>
          ) : (
            <Card className="flex flex-col gap-4">
              <ol className="list-decimal pl-5 text-sm flex flex-col gap-2">
                <li>
                  <span className="font-semibold">On a computer:</span> press “Use my phone”. The computer shows a QR code: scan it with your phone’s camera
                  and approve with Face ID or your fingerprint. Bluetooth must be on, on the computer and on the phone.
                </li>
                <li>
                  <span className="font-semibold">On a phone or tablet:</span> press “Use this phone or tablet” and approve with Face ID or your fingerprint.
                </li>
                <li>
                  <span className="font-semibold">Android phone at a computer:</span> when the phone asks, allow it to remember the computer. Next time the
                  computer sends the question straight to your phone.
                </li>
              </ol>
              <PasskeySetup hasPhones={false} next={next} touchGuess={touchGuess} />
              <form method="post" action="/api/auth/passkey/skip" className="flex justify-center">
                <input type="hidden" name="next" value={next} />
                <button type="submit" className="min-h-11 px-4 text-sm font-semibold text-muted underline underline-offset-4 cursor-pointer" data-passkey-skip>
                  Not now – ask me at my next sign-in
                </button>
              </form>
            </Card>
          )}
          <p className="text-xs text-faint text-center">Lost your phone later? Tell the owner straight away: only the owner can remove it.</p>
        </div>
      </div>
    </PublicShell>
  );
}
