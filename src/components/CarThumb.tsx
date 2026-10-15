/**
 * The car's picture as a small rounded thumbnail: in the header of every car page (about 120 px wide) and
 * smaller on list rows. Without a picture, a grey outline with the plate's first letters. Internal only.
 */
export function CarThumb({ url, alt, size = "md", className = "" }: { url: string | null; alt: string; size?: "sm" | "md"; className?: string }) {
  const dims = size === "sm" ? "w-16 h-10" : "w-[120px] h-[75px]";
  return (
    <div className={`shrink-0 overflow-hidden rounded-card border border-line-strong bg-canvas ${dims} ${className}`} data-car-thumb={url ? "photo" : "none"}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-[10px] font-bold text-faint uppercase tracking-wide">{size === "sm" ? "" : "No photo"}</div>
      )}
    </div>
  );
}
