/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Image, Text, View } from "@react-pdf/renderer";
import type { CarDamage } from "../damage";
import { formatDate } from "../format";
import { CarOutlinePdf } from "./car-outline-pdf";
import { fetchPhoto } from "./images";
import { GREY, INK, LINE, PALE, px } from "./template";

type Pic = { data: Buffer; format: "jpg" | "png" };
type Row = { label: string; words: string; note: string | null; tone: "red" | "amber"; photos: Pic[]; when?: string };
export type DamagePdfData = { rows: Row[]; loose: Pic[]; note: string | null; after: Row[]; tones: CarDamage["tones"] };

const pic = async (url: string): Promise<Pic | null> => {
  const data = await fetchPhoto(url).catch(() => null);
  if (!data?.length) return null;
  return { data, format: data[0] === 0x89 && data[1] === 0x50 ? "png" : "jpg" };
};
const pics = async (urls: string[], max: number) => (await Promise.all(urls.slice(0, max).map(pic))).filter((p): p is Pic => !!p);

/** The damage model with its photos fetched (four a panel at most), so one missing file never breaks the PDF. */
export async function damagePdfData(d: CarDamage): Promise<DamagePdfData> {
  const words = (w: string, s: string) => [w, s].filter(Boolean).join(" · ");
  const rows = await Promise.all(d.items.map(async (i) => ({ label: i.label, words: words(i.words, i.severity), note: i.note, tone: i.tone, photos: await pics(i.photos.map((p) => p.url), 4) })));
  const after = await Promise.all(d.after.map(async (a) => ({ label: a.label, words: words(a.words, a.severity), note: a.note, tone: a.tone, photos: await pics(a.photos.map((p) => p.url), 4), when: a.at ? formatDate(a.at) : "" })));
  return { rows, loose: await pics(d.loose.map((p) => p.url), 8), note: d.note, after, tones: d.tones };
}

const DOT = { red: "#B3261E", amber: "#B7791F" } as const;

function Photos({ photos }: { photos: Pic[] }) {
  if (!photos.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: px(5), paddingTop: px(4) }}>
      {photos.map((p, i) => <Image key={i} src={{ data: p.data, format: p.format }} style={{ width: px(84), height: px(63), objectFit: "cover", backgroundColor: PALE }} />)}
    </View>
  );
}

function Item({ r, n }: { r: Row; n: number | null }) {
  return (
    <View wrap={false} style={{ flexDirection: "row", gap: px(6), paddingVertical: px(5), borderBottomWidth: 0.75, borderBottomColor: LINE }}>
      <Text style={{ width: px(14), fontSize: px(10), color: GREY }}>{n ? `${n}.` : ""}</Text>
      <View style={{ width: px(7), height: px(7), borderRadius: px(4), backgroundColor: DOT[r.tone], marginTop: px(3) }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: px(10.5), fontWeight: 700 }}>{r.label}{r.when ? `  ·  Found after check-in · ${r.when}` : ""}</Text>
        {r.words ? <Text style={{ fontSize: px(10) }}>{r.words}</Text> : null}
        {r.note ? <Text style={{ fontSize: px(9.5), color: GREY }}>{r.note}</Text> : null}
        <Photos photos={r.photos} />
      </View>
    </View>
  );
}

/**
 * THE "Damage already on the car" block in a PDF (section 4, 30 October 2026): the labelled outline, the written list with
 * each panel's photos next to it, and what was found after check-in apart. English only: the PDF fonts carry no Arabic.
 */
export function DamagePdf({ d }: { d: DamagePdfData }) {
  const none = !d.rows.length && !d.loose.length && !d.note;
  return (
    <View style={{ marginBottom: px(14) }}>
      <Text style={{ fontSize: px(9.5), fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: 0.4, borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: px(3), marginBottom: px(4) }}>Damage already on the car</Text>
      {none ? (
        <Text style={{ fontSize: px(10.5), fontWeight: 700, paddingVertical: px(4) }}>No damage noted at check-in</Text>
      ) : (
        <View style={{ flexDirection: "row", gap: px(14) }}>
          <View wrap={false} style={{ width: px(130), alignItems: "center" }}>
            <CarOutlinePdf tones={d.tones} width={px(130)} />
          </View>
          <View style={{ flex: 1 }}>
            {d.rows.map((r, i) => <Item key={i} r={r} n={i + 1} />)}
            {d.loose.length ? (
              <View wrap={false} style={{ paddingTop: px(5) }}>
                <Text style={{ fontSize: px(9), fontWeight: 700, color: GREY, textTransform: "uppercase" }}>{d.rows.length ? "Other damage photos" : "Damage photos"}</Text>
                <Photos photos={d.loose} />
              </View>
            ) : null}
            {d.note ? <Text style={{ fontSize: px(10), paddingTop: px(5) }}>{d.note}</Text> : null}
          </View>
        </View>
      )}
      {d.after.length ? (
        <View style={{ marginTop: px(8) }}>
          <Text style={{ fontSize: px(9), fontWeight: 700, textTransform: "uppercase", paddingBottom: px(2) }}>Found after check-in</Text>
          {d.after.map((r, i) => <Item key={i} r={r} n={null} />)}
        </View>
      ) : null}
    </View>
  );
}
