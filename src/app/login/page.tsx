import Link from "next/link";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { signInWithPassword } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; message?: string }>;
}) {
  const { error, next, message } = await searchParams;

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Logo className="h-16 self-start" />
          <h1 className="mt-4 text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-muted">Office login with email and password.</p>
        </div>

        <Card>
          <form action={signInWithPassword} className="flex flex-col gap-4">
            {error ? <Notice tone="error">{error}</Notice> : null}
            {message ? <Notice tone="success">{message}</Notice> : null}
            <input type="hidden" name="next" value={next ?? "/home"} />
            <Field label="Email">
              <Input name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
            </Field>
            <Field label="Password">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <Button type="submit" size="lg">
              Sign in
            </Button>
          </form>
        </Card>

        <p className="text-sm text-muted text-center">
          Using a workshop tablet?{" "}
          <Link href="/tablet" className="font-semibold text-ink underline underline-offset-4">
            Tap your name and enter your PIN
          </Link>
        </p>
        <p className="text-xs text-faint text-center">
          Forgot your password? Ask the owner for a new setup link.
        </p>
      </div>
    </main>
  );
}
