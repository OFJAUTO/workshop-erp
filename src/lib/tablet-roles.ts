/**
 * WHO SIGNS IN ON A SHARED TABLET (13 November 2026, Section 3): only the people who work on the floor - technicians
 * (electricians and helpers are technicians by role), team leaders, QC, and the workshop/bodyshop managers who sign work
 * on the floor. Office roles (accounts, advisors, gate-in, parts, owner) never appear as a tile and can never sign in by
 * PIN on a shared tablet; they use their own PC or phone. A personal device keeps its own person. Pure.
 */
export const FLOOR_ROLES = ["technician", "team_leader", "qc_inspector", "workshop_manager"] as const;
export const onSharedTablet = (role: string) => (FLOOR_ROLES as readonly string[]).includes(role);
export const SHARED_TABLET_REFUSAL = "Office logins never sign in on a shared tablet: use your own PC or phone.";
/** Five wrong PINs lock the tile for at least 15 minutes. */
export const PIN_LOCK_MIN_MINUTES = 15;
