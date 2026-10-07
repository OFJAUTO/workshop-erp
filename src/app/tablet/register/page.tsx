import { PublicShell } from "@/components/Shell";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getCurrentDevice } from "@/lib/devices";
import { createClient } from "@/lib/supabase/server";
import { registerThisTablet } from "./actions";
import { RegisterForm } from "./RegisterForm";

export const dynamic = "force-dynamic";

export default async function RegisterTabletPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePermission("manageTablets");
  const { error } = await searchParams;
  const existing = await getCurrentDevice();
  const supabase = await createClient();
  const { data: people } = await supabase
    .from("staff")
    .select("id, display_name, full_name, login_type")
    .eq("is_active", true)
    .in("login_type", ["pin", "both"])
    .order("display_name");

  return (
    <PublicShell note="Register this device">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md flex flex-col gap-6">
          <PageHeader title="Register this device" subtitle="Do this on the phone or tablet itself. Afterwards you are signed out and it shows its PIN screen." />
          {existing ? (
            <Notice tone="info">
              This device is already registered as <strong>{existing.name}</strong>. Registering again replaces that.
            </Notice>
          ) : null}
          <Card>
            <RegisterForm action={registerThisTablet} error={error ?? null} people={(people ?? []).map((p) => ({ id: p.id, label: `${p.display_name} (${p.full_name})` }))} />
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}
