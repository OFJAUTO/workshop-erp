import { redirect } from "next/navigation";
import { PublicShell } from "@/components/Shell";
import { Button, Card, Notice } from "@/components/ui";
import { PasswordBox } from "@/components/PasswordBox";
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
    <PublicShell>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold">Choose your password</h1>
            <p className="text-sm text-muted">
              For <span className="font-semibold text-ink">{user.email}</span>.
            </p>
          </div>
          <Card>
            <form action={setPassword} className="flex flex-col gap-4">
              {error ? <Notice tone="error">{error}</Notice> : null}
              <input type="hidden" name="username" value={user.email ?? ""} autoComplete="username" />
              <PasswordBox autoFocus />
              <Button type="submit" size="lg">
                Save password and continue
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}
