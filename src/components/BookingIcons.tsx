import type { BookingKind } from "@/lib/calendar";

/** One small icon per booking type. Colour comes from the person, so the icon is plain. */
export function BookingIcon({ kind, size = 16 }: { kind: BookingKind; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "customer_visit":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "car_drop":
      return (
        <svg {...common}>
          <path d="M5 17h14M6 17l1.5-5h9L18 17M7 17v2M17 17v2" />
          <path d="M12 2v6M9.5 5.5 12 8l2.5-2.5" />
        </svg>
      );
    case "we_collect":
      return (
        <svg {...common}>
          <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      );
    case "customer_collects":
      return (
        <svg {...common}>
          <circle cx="8" cy="12" r="4" />
          <path d="M12 12h9M18 12v3M15 12v2" />
        </svg>
      );
  }
}
