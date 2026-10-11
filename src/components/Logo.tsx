/** Company logo. `onDark` renders it white for the black menu bar. */
export function Logo({
  className = "h-11",
  alt = "OFJ Automotive",
  onDark = false,
}: {
  className?: string;
  alt?: string;
  onDark?: boolean;
}) {
  const classes = `w-auto select-none ${onDark ? "logo-on-dark" : "logo-on-light"} ${className}`;
  // The one real logo file everywhere; on the black bar it is inverted by CSS.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" alt={alt} draggable={false} className={classes} />;
}
