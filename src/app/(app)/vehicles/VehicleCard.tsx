import type { ReactNode } from "react";

/** A car card with its wide profile picture. Reused on the floor board and dashboard in Phase 2. */
export function VehicleCard({
  photoUrl,
  plate,
  title,
  subtitle,
  owner,
  badges,
  footer,
}: {
  photoUrl: string | null;
  plate: string;
  title: string;
  subtitle?: string;
  owner?: string | null;
  badges?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="bg-white border border-line rounded-card overflow-hidden hover:border-ink h-full flex flex-col">
      <div className="aspect-[16/10] bg-chip relative">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={plate} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-faint">No picture yet</div>
        )}
      </div>
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-extrabold tracking-[0.03em] text-[17px]">{plate}</span>
          {badges}
        </div>
        <span className="text-sm font-semibold">{title}</span>
        {subtitle ? <span className="text-xs text-muted">{subtitle}</span> : null}
        {owner ? <span className="text-xs text-muted">{owner}</span> : null}
        {footer}
      </div>
    </div>
  );
}
