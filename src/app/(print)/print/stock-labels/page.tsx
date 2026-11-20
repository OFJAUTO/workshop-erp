import { refuse } from "@/lib/refusal";
import { stickerPageCss } from "@/components/StickerArt";
import { requireStaff } from "@/lib/auth";
import { qrDataUrl } from "@/lib/pdf/qr";
import { createAdminClient } from "@/lib/supabase/admin";
import { stockAccessOf } from "@/lib/stock-manage";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { PrintNow } from "../../parts/labels/[jobId]/PrintNow";

export const dynamic = "force-dynamic";

/**
 * SHELF LABELS (20 November 2026, Section 5): black only, one per stock item ticked on the Labels tab - the name, the
 * part number, the unit and a QR code; scanning it opens the item on the stock page to issue or count it.
 */
export default async function StockLabelsPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const staff = await requireStaff();
  const access = await stockAccessOf(staff);
  if (!access.manage) return refuse("no_permission");
  const ids = String((await searchParams).ids ?? "").split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  const { data } = ids.length ? await createAdminClient().from("stock_items").select("id, name, part_number, unit").in("id", ids) : { data: [] };
  const items = ((data ?? []) as { id: string; name: string; part_number: string | null; unit: string }[]).sort((a, b) => a.name.localeCompare(b.name));
  const w = 60;
  const h = 30;
  const labels: React.ReactNode[] = [];
  for (const it of items) {
    const qr = await qrDataUrl(`${PRODUCTION_SITE_URL}/parts/stock?item=${it.id}`, 300);
    labels.push(
      <div key={it.id} style={{ width: `${w}mm`, height: `${h}mm`, boxSizing: "border-box", padding: "2mm", display: "flex", gap: "2mm", alignItems: "center", color: "#000", background: "#fff", fontFamily: "system-ui, sans-serif" }} data-stock-label={it.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="" style={{ width: `${h - 4}mm`, height: `${h - 4}mm` }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "1mm", minWidth: 0 }}>
          <div style={{ fontSize: "3.6mm", fontWeight: 800, lineHeight: 1.1, textTransform: "uppercase", maxHeight: "12mm", overflow: "hidden" }}>{it.name}</div>
          {it.part_number ? <div style={{ fontSize: "2.8mm", fontWeight: 600 }}>{it.part_number}</div> : null}
          <div style={{ fontSize: "2.6mm" }}>Unit: {it.unit}</div>
        </div>
      </div>,
    );
  }
  return (
    <div>
      <style>{stickerPageCss(w, h)}</style>
      <PrintNow />
      {labels.length ? labels : <p style={{ padding: 16, fontFamily: "system-ui" }}>Tick the items on the Labels tab first.</p>}
    </div>
  );
}
