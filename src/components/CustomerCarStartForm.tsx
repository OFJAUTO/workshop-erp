"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
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

/** The form around the three-choice chooser: a server page hands in the lists and the action, this client part renders the form. */
export function CustomerCarStartForm({ action, initialValues = {}, customers, cars, makes, models, submitLabel, testId }: { action: FormAction; initialValues?: Record<string, string>; customers: ChooserCustomer[]; cars: ChooserCar[]; makes: ChooserMake[]; models: ChooserModel[]; submitLabel: string; testId?: string }) {
  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-5">
      {(v) => (
        <div className="flex flex-col gap-5" data-start-form={testId}>
          {v.bodyshop ? <input type="hidden" name="bodyshop" value={v.bodyshop} /> : null}
          <CustomerCarChooser v={v} customers={customers} cars={cars} makes={makes} models={models} />
          <div><SubmitButton>{submitLabel}</SubmitButton></div>
          {/* An open estimate for the same customer and car already exists: open it, or start a new one on purpose. */}
          {v.estimate_dup_id ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" data-estimate-duplicate>
              <ReleaseFormLock />
              <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-4 shadow-xl">
                <h2 className="text-lg font-extrabold">{v.estimate_dup_name} already has {v.estimate_dup_number} – open it instead?</h2>
                <p className="text-sm text-muted">It is still open (being prepared or waiting for the customer). A second estimate for the same car is usually a mistake; for a variation use Copy estimate on it.</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="submit" name="confirm_new" value="1" className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-estimate-new-anyway>Create a new one anyway</button>
                  <Link href={`/estimates/${v.estimate_dup_id}`} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white" data-estimate-open-existing>Open {v.estimate_dup_number}</Link>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </ActionForm>
  );
}
