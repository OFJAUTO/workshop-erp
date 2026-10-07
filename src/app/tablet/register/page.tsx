import { PublicShell } from "@/components/Shell";
import { Button, Card, ChoiceButtons, Field, Input, Notice } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getCurrentDevice } from "@/lib/devices";
import { registerThisTablet } from "./actions";

export const dynamic = "force-dynamic";

export default async function RegisterTabletPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("manageTablets");
  const { error } = await searchParams;
  const existing = await getCurrentDevice();

  return (
    <PublicShell note="Register this tablet">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold">Register this tablet</h1>
            <p className="text-sm text-muted">
              Do this on the tablet itself. Afterwards you are signed out and the tablet shows the name-and-PIN
              screen.
            </p>
          </div>

          {existing ? (
            <Notice tone="info">
              This tablet is already registered as <strong>{existing.name}</strong>. Registering again replaces that.
            </Notice>
          ) : null}

          <Card>
            <form action={registerThisTablet} className="flex flex-col gap-5">
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Field label="Tablet name" hint="For example: Workshop tablet 3">
                <Input name="name" required minLength={2} autoFocus />
              </Field>
              <Field label="Where it lives">
                <ChoiceButtons
                  name="location"
                  options={[
                    { value: "workshop", label: "Workshop" },
                    { value: "bodyshop", label: "Bodyshop" },
                    { value: "office", label: "Office" },
                  ]}
                />
              </Field>
              <Button type="submit" size="lg">
                Register and sign me out
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}
