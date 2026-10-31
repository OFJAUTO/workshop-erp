"use client";

import { useRef, useState } from "react";
import { InspectionMedia, fileOfSent, useFilesOnDevice, whereMatch, whereOf, type InspectionFile } from "@/components/InspectionMedia";
import { PartPicker } from "@/components/PartPicker";
import { panelLabel } from "@/lib/car-outline";
import { partsListLine, type CatalogueRow, type PartsListEntry } from "@/lib/parts-list";
import { BodyshopFindings, type BodyStateProps } from "./BodyshopFindings";

type PanelFile = InspectionFile & { itemKey: string | null };

/**
 * The bodyshop findings on their own, for the report page when the full inspection form is not open there (the
 * bodyshop manager checking a mechanical car's report): its own photo strips and parts picker, the same card. Panel
 * photos go through the send queue; a photo counts for its finding only once the server has it.
 */
export function BodyshopFindingsPanel({ inspectionId, initial, canEdit, canCheck, files: initialFiles, partsList, catalogue }: { inspectionId: string; initial: BodyStateProps; canEdit: boolean; canCheck: boolean; files: PanelFile[]; partsList: PartsListEntry[]; catalogue: CatalogueRow[] }) {
  const [files, setFiles] = useState(initialFiles);
  // A live refresh hands the server's list again: it joins what this screen has; a photo taken off here stays off.
  const [goneIds, setGoneIds] = useState<string[]>([]);
  const serverKey = initialFiles.map((f) => f.id).join(",");
  const [prevKey, setPrevKey] = useState(serverKey);
  if (prevKey !== serverKey) {
    setPrevKey(serverKey);
    setFiles((local) => [...initialFiles.filter((f) => !goneIds.includes(f.id)), ...local.filter((l) => !initialFiles.some((f) => f.id === l.id))]);
  }
  const [list, setListState] = useState<PartsListEntry[]>(partsList);
  const listRef = useRef(partsList);
  const [picker, setPicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveList = async (next: PartsListEntry[]) => {
    listRef.current = next;
    setListState(next);
    const r = await fetch("/api/inspection/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inspectionId, partsList: next }) }).catch(() => null);
    if (!r || !r.ok) setError(((await r?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? "The parts were not saved. Try again.");
    else setError(null);
  };
  const keyOf = (panel: string) => `body.${panel}`;
  const addFile = (itemKey: string) => (f: InspectionFile) => setFiles((p) => (p.some((x) => x.id === f.id) ? p : [...p, { ...f, itemKey }]));
  // Every panel photo still on this device: a photo that arrives while another panel is open still joins its own panel.
  const pending = useFilesOnDevice({
    target: "inspection",
    scopeId: inspectionId,
    match: (f) => String(f.itemKey ?? "").startsWith("body."),
    onSent: (r, fields) => {
      const f = fileOfSent(r);
      const key = whereOf(fields).itemKey;
      if (f && key) addFile(key)(f);
    },
  });
  return (
    <>
      <BodyshopFindings
        inspectionId={inspectionId}
        initial={initial}
        canEdit={canEdit}
        canCheck={canCheck}
        photos={(panel) => {
          const mine = files.filter((f) => f.itemKey === keyOf(panel));
          const onTheWay = pending.filter((p) => whereMatch({ itemKey: keyOf(panel) })(p.fields)).length;
          return {
            count: mine.length,
            pending: onTheWay,
            node: <InspectionMedia key={keyOf(panel)} inspectionId={inspectionId} files={mine} where={{ itemKey: keyOf(panel) }} disabled={!canEdit} onAdded={addFile(keyOf(panel))} onRemoved={(id) => { setFiles((p) => p.filter((x) => x.id !== id)); setGoneIds((g) => (g.includes(id) ? g : [...g, id])); }} />,
          };
        }}
        parts={(panel) => (
          <div className="flex flex-wrap items-center gap-1.5" data-body-parts={panel}>
            {list.filter((e) => e.item_key === keyOf(panel)).map((e) => (
              <span key={e.id} className="inline-flex items-center gap-1 rounded-control border border-line-strong bg-white px-2 py-1 text-xs font-semibold">
                {partsListLine(e)}
                {canEdit ? <button type="button" aria-label={`Remove ${e.name}`} onClick={() => void saveList(listRef.current.filter((x) => x.id !== e.id))} className="min-h-6 px-1 font-bold text-red">×</button> : null}
              </span>
            ))}
            {canEdit ? <button type="button" onClick={() => setPicker(panel)} className="min-h-9 rounded-control border border-dashed border-line-strong px-3 text-xs font-bold" data-body-add-part>+ Parts</button> : null}
            {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
          </div>
        )}
      />
      {picker ? (
        <PartPicker
          title={`Parts · ${panelLabel(picker)}`}
          catalogue={catalogue}
          selected={list.filter((e) => e.item_key === keyOf(picker))}
          itemKey={keyOf(picker)}
          source="item"
          onDone={(entries) => { void saveList([...listRef.current.filter((e) => e.item_key !== keyOf(picker)), ...entries]); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}
