/**
 * Text that wraps between words only (29 October 2026, batch section 2): a browser may break a line after a hyphen,
 * which tore "J-00016", "Gate-in" and "Mercedes-Benz" in two on a tablet. Every word here is kept whole; the line
 * still wraps at the spaces.
 */
export function Words({ text, className, ...rest }: { text: string; className?: string } & Record<`data-${string}`, string | number | boolean | undefined>) {
  const parts = text.split(/(\s+)/);
  return (
    <span className={className} {...rest}>
      {parts.map((p, i) => (/^\s+$/.test(p) ? " " : p ? <span key={i} className="whitespace-nowrap">{p}</span> : null))}
    </span>
  );
}
