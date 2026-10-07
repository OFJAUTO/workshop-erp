import { PublicShell } from "@/components/Shell";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { readSetupToken, SETUP_LINK_HOURS } from "@/lib/setup-links";

export const dynamic = "force-dynamic";

/**
 * Where password setup links land. Opening this page changes nothing, so a
 * WhatsApp preview cannot use the link up. The link is used when the password is saved.
 */
export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const link = await readSetupToken(token);

  return (
    <PublicShell>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-6">
          {!link ? (
            <>
              <h1 className="text-3xl font-extrabold">Link not valid</h1>
              <Notice tone="error">
                This setup link has expired, was already used, or is not correct. Ask the owner for a new one. Links last {SETUP_LINK_HOURS} hours.
              </Notice>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <h1 className="text-3xl font-extrabold">Welcome, {link.full_name.split(" ")[0]}</h1>
                <p className="text-sm text-muted">
                  Choose a password for <span className="font-semibold text-ink">{link.email}</span>. At least 8 characters.
                </p>
              </div>
              <Card>
                <form method="post" action={`/api/auth/setup/${token}`} className="flex flex-col gap-4">
                  {error ? <Notice tone="error">{error}</Notice> : null}
                  <input type="hidden" name="username" value={link.email ?? ""} autoComplete="username" />
                  <Field label="New password">
                    <Input name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus />
                  </Field>
                  <Field label="Type it again">
                    <Input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
                  </Field>
                  <Button type="submit" size="lg">
                    Save password and sign in
                  </Button>
                </form>
              </Card>
            </>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
