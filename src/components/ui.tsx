import Link from "next/link";
import type { ReactNode } from "react";

/* ---------------------------------------------------------------------------
   Shared building blocks. Every tappable thing is at least 44px tall.
   --------------------------------------------------------------------------- */

type Tone = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

const toneClass: Record<Tone, string> = {
  primary: "bg-ink text-white hover:bg-black disabled:bg-faint",
  secondary: "bg-white text-ink border border-line-strong hover:bg-canvas disabled:text-faint",
  ghost: "bg-transparent text-ink hover:bg-chip disabled:text-faint",
  danger: "bg-red-soft text-red border border-red-soft hover:bg-[#fbd5d0] disabled:opacity-60",
};

const sizeClass: Record<Size, string> = {
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-14 px-6 text-base",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-bold whitespace-nowrap cursor-pointer disabled:cursor-not-allowed transition-colors select-none";

export function Button({
  children,
  tone = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: Size }) {
  return (
    <button type="button" className={`${base} ${toneClass[tone]} ${sizeClass[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  tone = "primary",
  size = "md",
  className = "",
}: {
  href: string;
  children: ReactNode;
  tone?: Tone;
  size?: Size;
  className?: string;
}) {
  return (
    <Link href={href} className={`${base} ${toneClass[tone]} ${sizeClass[size]} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-line rounded-card p-5 ${className}`}>{children}</div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pr-14">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold leading-tight">{title}</h1>
        {subtitle ? <p className="text-sm font-medium text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-sm font-extrabold tracking-[0.08em] uppercase">{children}</span>
      {right ? <span className="text-sm font-semibold text-muted">{right}</span> : null}
    </div>
  );
}

type BadgeTone = "neutral" | "outline" | "green" | "amber" | "red" | "ink";

const badgeClass: Record<BadgeTone, string> = {
  neutral: "bg-chip text-ink",
  outline: "border border-ink text-ink",
  green: "bg-green-soft text-green",
  amber: "bg-amber-soft text-amber",
  red: "bg-red-soft text-red",
  ink: "bg-ink text-white tracking-[0.08em]",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${badgeClass[tone]}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  optional,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5" data-field>
      <span className="text-sm font-semibold" data-field-label>
        {label}
        {optional ? <span className="text-muted font-medium"> (optional)</span> : null}
      </span>
      {children}
      {hint && !error ? <span className="text-xs text-muted">{hint}</span> : null}
      {error ? <span className="text-xs text-red font-semibold">{error}</span> : null}
    </label>
  );
}

const controlClass =
  "min-h-11 w-full rounded-control border border-line-strong bg-white px-3.5 text-[15px] outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 disabled:bg-canvas disabled:text-muted";

const WORDY_TYPES = new Set([undefined, "text", "search", "url"]);

/** Text boxes get English spell check by default (a standing rule); numbers, emails, dates and codes do not. */
export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const wordy = WORDY_TYPES.has(props.type) && props.inputMode !== "numeric" && props.inputMode !== "decimal" && props.inputMode !== "tel";
  return <input spellCheck={wordy ? true : false} lang={wordy ? "en" : undefined} className={`${controlClass} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea spellCheck lang={props.lang ?? "en"} className={`${controlClass} py-2.5 min-h-24 ${className}`} {...props} />;
}

export function Select({ className = "", children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${controlClass} ${className}`} {...props}>
      {children}
    </select>
  );
}

/**
 * One-tap choice buttons for a short list of options. Used instead of
 * drop-downs on tablets. Works as a normal form field via a hidden radio.
 */
export function ChoiceButtons({
  name,
  options,
  defaultValue,
  columns = 3,
}: {
  name: string;
  options: { value: string; label: string; hint?: string }[];
  defaultValue?: string | null;
  columns?: 2 | 3 | 4;
}) {
  const cols = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[columns];
  return (
    <div className={`grid ${cols} gap-2`}>
      {options.map((o) => (
        <label key={o.value} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={o.value}
            defaultChecked={defaultValue === o.value}
            className="peer sr-only"
          />
          <span className="flex min-h-12 flex-col items-center justify-center rounded-control border border-line-strong bg-white px-3 py-2 text-center text-sm font-semibold peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-ink/30">
            {o.label}
            {o.hint ? <span className="text-xs font-medium opacity-70">{o.hint}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const cls = {
    error: "bg-red-soft text-red",
    success: "bg-green-soft text-green",
    info: "bg-chip text-ink",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-control px-4 py-3 text-sm font-semibold ${cls}`}>
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-white px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Avatar({
  name,
  photoUrl,
  size = 44,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  const style = { width: size, height: size, fontSize: Math.max(12, Math.round(size / 3)) };
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt={name} style={style} className="rounded-full object-cover bg-chip" />;
  }
  return (
    <span
      style={style}
      className="inline-flex items-center justify-center rounded-full bg-chip font-bold text-ink shrink-0"
    >
      {initials || "?"}
    </span>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col gap-0.5">
          <dt className="text-xs font-semibold text-muted">{it.label}</dt>
          <dd className="text-[15px] font-medium break-words">{it.value ?? <span className="text-faint">Not set</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
