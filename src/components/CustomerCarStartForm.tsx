"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { CustomerCarChooser, type ChooserCar, type ChooserCustomer, type ChooserMake, type ChooserModel } from "@/components/CustomerCarChooser";

/** The form around the three-choice chooser: a server page hands in the lists and the action, this client part renders the form. */
export function CustomerCarStartForm({ action, initialValues = {}, customers, cars, makes, models, submitLabel, testId }: { action: FormAction; initialValues?: Record<string, string>; customers: ChooserCustomer[]; cars: ChooserCar[]; makes: ChooserMake[]; models: ChooserModel[]; submitLabel: string; testId?: string }) {
  return (
    <ActionForm action={action} initialValues={initialValues} className="flex flex-col gap-5">
      {(v) => (
        <div className="flex flex-col gap-5" data-start-form={testId}>
          {v.bodyshop ? <input type="hidden" name="bodyshop" value={v.bodyshop} /> : null}
          <CustomerCarChooser v={v} customers={customers} cars={cars} makes={makes} models={models} />
          <div><SubmitButton>{submitLabel}</SubmitButton></div>
        </div>
      )}
    </ActionForm>
  );
}
