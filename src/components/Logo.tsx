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
  // The real logo file on white; on the black bar the photo version, inverted by CSS.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={onDark ? "/logo.jpg" : "/logo.svg"} alt={alt} draggable={false} className={classes} />;
}
