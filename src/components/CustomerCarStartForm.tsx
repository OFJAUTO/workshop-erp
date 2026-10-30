"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Words } from "@/components/Words";
import type { FormState } from "@/lib/form-state";
import { CustomerCarChooser, type ChooserCar, type ChooserCustomer, type ChooserMake, type ChooserModel } from "@/components/CustomerCarChooser";

/** The form's double-tap lock (FormGuard) ends when the server's answer is already on screen, so the next choice is not swallowed. */
function ReleaseFormLock() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (form) delete form.dataset.busyUntil;
  }, []);
  return <span ref={ref} hidden />;
}

/**
 * The CHOSEN car already has an open estimate (30 October 2026): a warning with a way forward, never a dead end.
 * "This car already has an open estimate: E-00035 · AED 6,615.00 · sent 30 Oct" with Open E-00035 and Make an
 * additional estimate. The additional estimate is made from the window's own estimate (its customer and car), and
 * the button skips the browser's field check, so it creates one every time. "Choose another car" closes it.
 */
function OpenEstimateQuestion({ v, state }: { v: Record<string, string>; state: FormState }) {
  // Closed by hand until the server answers again (the same car asked twice reopens it).
  const [closedFor, setClosedFor] = useState<FormState | null>(null);
  useEffect(() => {
    if (closedFor === state) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setClosedFor(state);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closedFor, state]);
  if (!v.estimate_dup_id || closedFor === state) return null;
  let list: { id: string; number: string; line: string }[] = [];
  try {
    list = JSON.parse(v.estimate_dup_list || "[]");
  } catch {}
  if (!list.length) list = [{ id: v.estimate_dup_id, number: v.estimate_dup_number, line: v.estimate_dup_number }];
  const first = list[0];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-labelledby="open-estimate-title" data-estimate-duplicate>
      <ReleaseFormLock />
      <input type="hidden" name="additional_to" value={first.id} />
      <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-4 shadow-xl">
        <div className="flex flex-col gap-1">
          {v.estimate_dup_car ? <span className="text-xs font-bold tracking-[0.08em] uppercase text-muted" data-estimate-dup-car>{v.estimate_dup_car}</span> : null}
          {list.length === 1 ? (
            <h2 id="open-estimate-title" className="text-lg font-extrabold">
              This car already has an open estimate: <Words text={first.line} data-estimate-dup-line={first.number} />
            </h2>
          ) : (
            <>
              <h2 id="open-estimate-title" className="text-lg font-extrabold">This car already has {list.length} open estimates:</h2>
              <ul className="flex flex-col gap-1 text-sm font-semibold">
                {list.map((e) => (
                  <li key={e.id} data-estimate-dup-line={e.number}>
                    <Link href={`/estimates/${e.id}`} className="underline underline-offset-4"><Words text={e.line} /></Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-sm text-muted">Open it to change it, or make an additional estimate for more work on this car. Nothing is replaced: both stay on the car.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Link href={`/estimates/${first.id}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-estimate-open-existing>
            Open {first.number}
          </Link>
          <button type="submit" name="confirm_new" value="1" formNoValidate className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-white" data-estimate-new-anyway data-estimate-additional>
            Make an additional estimate
          </button>
        </div>
        <button type="button" onClick={() => setClosedFor(state)} className="self-start min-h-11 text-sm font-semibold underline underline-offset-4" data-estimate-dup-close>
          Choose another car
        </button>
      </div>
    </div>
  );
}

/** The form around the three-choice chooser: a server page hands in the lists and the action, this client part renders the form. */
export function CustomerCarStartForm({ action, initialValues = {}, customers, cars, makes, models, submitLabel, testId }: { action: FormAction; initialValues?: Record<string, string>; customers: ChooserCustomer[]; cars: ChooserCar[]; makes: ChooserMake[]; models: ChooserModel[]; submitLabel: string; testId?: string }) {
  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-5">
      {(v, state) => (
        <div className="flex flex-col gap-5" data-start-form={testId}>
          {v.bodyshop ? <input type="hidden" name="bodyshop" value={v.bodyshop} /> : null}
          <CustomerCarChooser v={v} customers={customers} cars={cars} makes={makes} models={models} />
          <div><SubmitButton>{submitLabel}</SubmitButton></div>
          <OpenEstimateQuestion v={v} state={state} />
        </div>
      )}
    </ActionForm>
  );
}
