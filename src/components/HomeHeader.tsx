import { LinkButton } from "./ui";
import { TopSearch } from "./TopSearch";
import type { CurrentStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";

/**
 * The top of every home screen: "Good morning, <first name>" (Dubai time: before 12, 12 to 5, after 5), the
 * date under it in bold dark grey, the one search bar for any car, and "Gate in a car" where the role has it.
 * Narrower than 1,100 px the search sits in the black top bar (MobileTopBar) instead. Acting as someone, their name
 * is the one greeted.
 */
export function HomeHeader({ staff, gateIn = false, actions = null }: { staff: CurrentStaff; gateIn?: boolean; actions?: React.ReactNode }) {
  // A server component reads the clock once.
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const whole = staff.actingAs ? staff.actingAs.forName : staff.display_name;
  const first = whole.split(" ")[0] || whole;
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" }).format(now);
  return (
    <div className="flex flex-col gap-3" data-home-header>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-[-0.01em]" data-greeting>{greeting}, {first}</h1>
          <p className="text-[17px] font-bold text-muted" data-home-date>{date}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="hidden nav:block w-[20rem] xl:w-[26rem]"><TopSearch customers={can(staff.role_id as RoleId, "viewCustomers")} /></div>
          {gateIn ? <LinkButton href="/gate-in" size="lg">Gate in a car</LinkButton> : null}
          {actions}
          <span id="header-bell-slot" className="inline-flex shrink-0 items-center" />
        </div>
      </div>

    </div>
  );
}
