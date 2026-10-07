/** The main car picture on dashboard and list cards. Internal only. */
export function CarPicture({ url, alt, className = "" }: { url: string | null; alt: string; className?: string }) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-card bg-chip aspect-[16/10] ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-xs font-semibold text-faint">No picture</div>
      )}
    </div>
  );
}
