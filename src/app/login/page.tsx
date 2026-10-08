import { PublicShell } from "@/components/Shell";
import { Button, Card, Field, Input, LinkButton, Notice } from "@/components/ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; message?: string }>;
}) {
  const { error, next, message } = await searchParams;

  return (
    <PublicShell>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold">Sign in</h1>
            <p className="text-sm text-muted">Office login with email and password.</p>
          </div>

          <Card>
            <form method="post" action="/api/auth/login" className="flex flex-col gap-4">
              {error ? <Notice tone="error">{error}</Notice> : null}
              {message ? <Notice tone="success">{message}</Notice> : null}
              <input type="hidden" name="next" value={next ?? "/home"} />
              <Field label="Email">
                <Input name="email" type="email" autoComplete="username" inputMode="email" required autoFocus />
              </Field>
              <Field label="Password">
                <Input name="password" type="password" autoComplete="current-password" required />
              </Field>
              <label className="flex items-center gap-3 min-h-11 cursor-pointer">
                <input type="checkbox" name="keep" className="h-5 w-5 accent-ink" />
                <span className="text-sm font-semibold">Keep me signed in on this computer</span>
              </label>
              <Button type="submit" size="lg">
                Sign in
              </Button>
            </form>
          </Card>

          <LinkButton href="/tablet" tone="secondary" size="lg" className="w-full">
            Workshop tablet or phone: tap your name
          </LinkButton>
          <p className="text-xs text-faint text-center">Forgot your password? Ask the owner for a new setup link.</p>
        </div>
      </div>
    </PublicShell>
  );
}
