import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveSettings } from "./actions";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  await requirePermission("manageSettings");
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value");

  const initial: Record<string, string> = {};
  for (const row of data ?? []) {
    initial[row.key] = typeof row.value === "string" ? row.value : String(row.value ?? "");
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Changes apply immediately, without a rebuild. Every change is logged." />
      <Card className="max-w-3xl">
        <SettingsForm action={saveSettings} initialValues={initial} />
      </Card>
    </>
  );
}
