import { BodyshopBoard } from "@/components/BodyshopBoard";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LinkButton, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { loadBoard } from "@/lib/bodyshop";
import { can, type RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** The bodyshop board inside the app: the Going out strip, then every section in due order. Red late, amber due today. */
export default async function BodyshopPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("viewBodyshop");
  const role = staff.role_id as RoleId;
  const { message, error } = await searchParams;
  const board = await loadBoard();
  return (
    <>
      <LiveRefresh tables={["jobs", "bodyshop_stages", "bodyshop_assignments", "bodyshop_signoffs"]} pollMs={60000} />
      <PageHeader
        title="Bodyshop"
        subtitle={`${board.cars.length} car${board.cars.length === 1 ? "" : "s"} in the bodyshop · ${board.goingOut.length} going out today or tomorrow`}
        actions={
          <>
            {role === "team_leader" ? <LinkButton href="/bodyshop/mine" size="lg">My section</LinkButton> : null}
            {can(role, "bodyshopQuote") ? <LinkButton href="/bodyshop/new" size="lg">New bodyshop quotation</LinkButton> : null}
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <BodyshopBoard cars={board.cars} goingOut={board.goingOut} today={board.today} tomorrow={board.tomorrow} />
    </>
  );
}
