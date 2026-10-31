"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { PhotoButton } from "@/components/PhotoButton";
import { ChoiceButtons, Field, Input, Textarea } from "@/components/ui";
import { enqueue } from "@/lib/send-queue";
import { reportUploadFailure, shrinkPhoto } from "@/lib/upload-client";

type Row = { key: number };
/** A line's photo, made small and kept on this device until the job card exists and it can go to its item. */
type ItemPhoto = { blob: Blob; type: string; url: string; takenAt: number };

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_BUTTON = "inline-flex min-h-11 w-fit items-center gap-2 rounded-control border border-line-strong bg-white px-4 text-sm font-bold";

/**
 * The short gate-in for loose items: one line per item (what it is, a few words, how many, a photo),
 * who brought them, what the customer wants, and what we saw at the counter.
 *
 * 31 October 2026: the photos never travel with the form. Each one is made small on the device and kept here; once the
 * job card and its items exist, every photo is handed to THE send queue under its own item (it keeps going after the page
 * moves on, without signal too) and the job card opens.
 */
export function LooseItemsForm({ action, itemTypes, customer }: { action: FormAction; itemTypes: readonly string[]; customer: { id: string; name: string; phone: string } | null }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([{ key: 0 }]);
  const [next, setNext] = useState(1);
  const [photos, setPhotos] = useState<Record<number, ItemPhoto>>({});
  const [photoProblem, setPhotoProblem] = useState<Record<number, string>>({});
  // The rows and photos as last shown, read when the server's answer arrives (never during a render).
  const rowsRef = useRef(rows);
  const photosRef = useRef(photos);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    rowsRef.current = rows;
    photosRef.current = photos;
  });
  useEffect(() => {
    const set = urls.current;
    return () => {
      for (const u of set) URL.revokeObjectURL(u);
      set.clear();
    };
  }, []);

  function forget(url: string) {
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  }

  async function pick(key: number, file: File | undefined) {
    if (!file) return;
    setPhotoProblem((p) => ({ ...p, [key]: "" }));
    const small = await shrinkPhoto(file);
    if (!PHOTO_TYPES.includes(small.type)) {
      setPhotoProblem((p) => ({ ...p, [key]: "That photo could not be read. Take it again, or use a JPG or PNG." }));
      return;
    }
    const url = URL.createObjectURL(small.blob);
    urls.current.add(url);
    const old = photosRef.current[key];
    if (old) forget(old.url);
    setPhotos((cur) => ({ ...cur, [key]: { blob: small.blob, type: small.type, url, takenAt: Date.now() } }));
  }

  function dropPhoto(key: number) {
    const old = photosRef.current[key];
    if (old) forget(old.url);
    setPhotos((cur) => {
      const copy = { ...cur };
      delete copy[key];
      return copy;
    });
  }

  // The server opens the job card and its items; then each line's photo goes to the queue under its item, and the job
  // card opens. Only the photos travel this way: nothing here waits for them.
  const send = useCallback<FormAction>(
    async (state, formData) => {
      const r = await action(state, formData);
      const v = r.values ?? {};
      if (!r.error && v.jobId && v.href) {
        const ids = String(v.itemIds ?? "").split(",");
        const lines = rowsRef.current;
        const kept = photosRef.current;
        for (let i = 0; i < lines.length; i++) {
          const itemId = ids[i];
          const photo = kept[lines[i].key];
          if (!itemId || !photo) continue;
          try {
            await enqueue({ target: "loose_item", scopeId: v.jobId, blob: photo.blob, contentType: photo.type, fields: { itemId }, takenAt: photo.takenAt });
          } catch (err) {
            reportUploadFailure({ jobId: v.jobId, kind: "loose_item:item_photo", step: "upload", error: err });
          }
        }
        router.push(v.href);
      }
      return r;
    },
    [action, router],
  );

  return (
    <ActionForm action={send}>
      {(v) => (
        <>
          <input type="hidden" name="photos_by_browser" value="1" />
          {customer ? (
            <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-chip px-4 py-3">
              <input type="hidden" name="customer_id" value={customer.id} />
              <span className="font-bold">{customer.name}</span>
              <span className="text-sm text-muted">{customer.phone}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-card border border-line p-3">
              <Field label="Customer's name">
                <Input name="new_name" defaultValue={v.new_name} required textCase="title" />
              </Field>
              <Field label="Phone">
                <Input name="new_phone" type="tel" inputMode="tel" defaultValue={v.new_phone} required />
              </Field>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {rows.map((r, i) => {
              const photo = photos[r.key];
              return (
                <div key={r.key} className="flex flex-col gap-3 rounded-card border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Item {i + 1}</span>
                    {rows.length > 1 ? <button type="button" onClick={() => { dropPhoto(r.key); setRows((rs) => rs.filter((x) => x.key !== r.key)); }} className="min-h-9 rounded-control border border-line px-3 text-xs font-semibold">Remove</button> : null}
                  </div>
                  <ChoiceButtons name={`item_type_${i}`} columns={4} defaultValue={v[`item_type_${i}`] ?? ""} options={itemTypes.map((t) => ({ value: t, label: t }))} />
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px] gap-3">
                    <Field label="Or type what it is">
                      <Input name={`item_type_other_${i}`} defaultValue={v[`item_type_other_${i}`]} placeholder="Own word" textCase="title" />
                    </Field>
                    <Field label="A few words (size, brand, colour)">
                      <Input name={`item_description_${i}`} defaultValue={v[`item_description_${i}`]} placeholder="21 inch, black, kerb marks" textCase="sentence" />
                    </Field>
                    <Field label="How many">
                      <Input name={`item_quantity_${i}`} type="number" inputMode="numeric" min={1} step={1} defaultValue={v[`item_quantity_${i}`] ?? "1"} required />
                    </Field>
                  </div>
                  <div className="flex flex-col gap-1.5" data-loose-photo={i}>
                    <span className="text-sm font-semibold">Photo (optional)</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo.url} alt={`Item ${i + 1}`} className="h-16 w-16 rounded-control bg-chip object-cover" data-loose-photo-preview />
                      ) : null}
                      <PhotoButton source="camera" className={PHOTO_BUTTON} title={`Photo of item ${i + 1}`} onFiles={(f) => void pick(r.key, f[0])} onProblem={(m) => reportUploadFailure({ kind: "loose_item:item_photo", step: "camera", error: m })}>
                        {photo ? "Take it again" : "Take photo"}
                      </PhotoButton>
                      <PhotoButton source="gallery" className={`${PHOTO_BUTTON} text-xs`} title="From gallery" onFiles={(f) => void pick(r.key, f[0])}>
                        From gallery
                      </PhotoButton>
                      {photo ? <button type="button" onClick={() => dropPhoto(r.key)} className="min-h-11 rounded-control border border-line px-3 text-xs font-semibold text-muted" data-loose-photo-remove>Remove photo</button> : null}
                    </div>
                    {photo ? <span className="text-xs text-muted">Kept on this device: it goes to the item by itself once the job card is open, even without signal.</span> : null}
                    {photoProblem[r.key] ? <span className="text-xs font-semibold text-red">{photoProblem[r.key]}</span> : null}
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={() => { setRows((rs) => [...rs, { key: next }]); setNext((n) => n + 1); }} className="min-h-11 self-start rounded-control border border-ink px-4 text-sm font-bold">+ Another item</button>
          </div>

          <Field label="Who brought the items? (name, if not the customer)">
            <Input name="brought_by" defaultValue={v.brought_by} textCase="title" />
          </Field>
          <Field label="What does the customer want? One line per request">
            <Textarea name="requests" rows={3} defaultValue={v.requests} required textCase="sentence" placeholder={"Repair the kerb damage and repaint\nBalance all four"} />
          </Field>
          <Field label="What we saw at the counter (optional)">
            <Textarea name="assessment_note" rows={2} defaultValue={v.assessment_note} textCase="sentence" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Which side does the work?">
              <ChoiceButtons name="department" columns={2} defaultValue={v.department ?? "mechanical"} options={[{ value: "mechanical", label: "Mechanical" }, { value: "bodyshop", label: "Bodyshop" }]} />
            </Field>
            <Field label="Priority">
              <ChoiceButtons name="priority" columns={3} defaultValue={v.priority ?? "normal"} options={[{ value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }]} />
            </Field>
          </div>
          <SubmitButton size="lg">Open the job card</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
