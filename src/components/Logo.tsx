/** Company logo, used top left on every screen. The JPG's white background blends away on light surfaces. */
export function Logo({ className = "h-11", alt = "OFJ Automotive" }: { className?: string; alt?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.jpg" alt={alt} draggable={false} className={`w-auto mix-blend-multiply select-none ${className}`} />;
}
