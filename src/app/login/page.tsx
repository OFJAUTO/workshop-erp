import { PublicShell } from "@/components/Shell";
import { Button, Card, Field, Input, LinkButton, Notice } from "@/components/ui";
import { PasskeySignIn } from "@/components/PasskeySignIn";
import { passkeyRp, passkeysReady, safeNext } from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; message?: string }>;
}) {
  const { error, next: rawNext, message } = await searchParams;
  const next = safeNext(rawNext);
  // Passkeys (7 November 2026): the phone first, the password as the backup.
  const passkeys = !!passkeyRp() && (await passkeysReady());

  return (
    <PublicShell>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold">Sign in</h1>
            <p className="text-sm text-muted">{passkeys ? "With your phone, or with your email and password." : "Office login with email and password."}</p>
          </div>

          {passkeys ? (
            <Card className="flex flex-col gap-3" data-login-passkey>
              <PasskeySignIn next={next} label="Sign in with passkey" />
              <p className="text-xs text-muted">On a computer: scan the QR code with your phone, or approve the question your phone shows. Bluetooth must be on.</p>
            </Card>
          ) : null}

          <Card>
            <form method="post" action="/api/auth/login" className="flex flex-col gap-4" data-login-password>
              {error ? <Notice tone="error">{error}</Notice> : null}
              {message ? <Notice tone="success">{message}</Notice> : null}
              {passkeys ? <p className="text-sm font-semibold">Or use your password (backup)</p> : null}
              <input type="hidden" name="next" value={next} />
              <Field label="Email">
                <Input name="email" type="email" autoComplete="username" inputMode="email" required autoFocus={!passkeys} />
              </Field>
              <Field label="Password">
                <Input name="password" type="password" autoComplete="current-password" required />
              </Field>
              <label className="flex items-center gap-3 min-h-11 cursor-pointer">
                <input type="checkbox" name="keep" className="h-5 w-5 accent-ink" />
                <span className="text-sm font-semibold">Keep me signed in on this computer</span>
              </label>
              {passkeys ? <p className="text-xs text-muted -mt-2">Staff who sign in with a phone always stay signed in for 12 hours.</p> : null}
              <Button type="submit" size="lg" tone={passkeys ? "secondary" : "primary"}>
                Sign in with password
              </Button>
            </form>
          </Card>

          <LinkButton href="/tablet" tone="secondary" size="lg" className="w-full">
            Workshop tablet or phone: tap your name
          </LinkButton>
          <p className="text-xs text-faint text-center">Forgot your password or lost your phone? Ask the owner.</p>
        </div>
      </div>
    </PublicShell>
  );
}
