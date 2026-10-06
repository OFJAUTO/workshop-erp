import { redirect } from "next/navigation";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { setPassword } from "./actions";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Choose your password</h1>
          <p className="text-sm text-muted">
            For <span className="font-semibold text-ink">{user.email}</span>. At least 8 characters.
          </p>
        </div>
        <Card>
          <form action={setPassword} className="flex flex-col gap-4">
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Field label="New password">
              <Input name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus />
            </Field>
            <Field label="Type it again">
              <Input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
            </Field>
            <Button type="submit" size="lg">
              Save password and continue
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
