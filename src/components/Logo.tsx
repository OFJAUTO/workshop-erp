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
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.jpg" alt={alt} draggable={false} className={classes} />;
}
