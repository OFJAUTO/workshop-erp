"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ChoiceButtons, Field, Input, Notice, Textarea } from "@/components/ui";

export function GateOutForm({
  action,
  keysCount,
  keychain,
  dashCam,
  canOverride,
}: {
  action: FormAction;
  keysCount: number;
  keychain: boolean;
  dashCam: boolean;
  canOverride: boolean;
}) {
  const [returned, setReturned] = useState<string>(String(keysCount));
  const [chain, setChain] = useState<string>(keychain ? "yes" : "no");
  const mismatch = Number(returned) !== keysCount || (chain === "yes") !== keychain;

  return (
    <ActionForm action={action}>
      {(v) => (
        <>
          <Field label="Number of keys returned">
            <div className="grid grid-cols-4 gap-2" onChange={(e) => setReturned((e.target as HTMLInputElement).value)}>
              <ChoiceButtons name="keys_returned" columns={4} defaultValue={v.keys_returned ?? String(keysCount)} options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))} />
            </div>
          </Field>
          <Field label="Keychain returned">
            <div onChange={(e) => setChain((e.target as HTMLInputElement).value)}>
              <ChoiceButtons name="keychain_returned" columns={2} defaultValue={v.keychain_returned ?? (keychain ? "yes" : "no")} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
            </div>
          </Field>

          {mismatch ? (
            canOverride ? (
              <>
                <Notice tone="error">
                  Does not match gate-in ({keysCount} key{keysCount === 1 ? "" : "s"}, {keychain ? "with" : "no"} keychain). Gate-out is blocked unless you override with a reason. The override is logged.
                </Notice>
                <Field label="Reason for override">
                  <Textarea name="override_reason" defaultValue={v.override_reason} rows={2} required />
                </Field>
              </>
            ) : (
              <Notice tone="error">
                Does not match gate-in ({keysCount} key{keysCount === 1 ? "" : "s"}, {keychain ? "with" : "no"} keychain). Gate-out is blocked. Only the owner or workshop manager can override.
              </Notice>
            )
          ) : null}

          {dashCam ? (
            <label className="flex items-center gap-3 min-h-12 rounded-control border border-line-strong bg-white px-4 cursor-pointer">
              <input type="checkbox" name="dash_cam_reconnected" className="h-5 w-5 accent-ink" required />
              <span className="text-sm font-bold">Dash cam reconnected</span>
            </label>
          ) : null}

          <Field label="Notes" optional>
            <Input name="notes" defaultValue={v.notes} />
          </Field>

          <div>
            <SubmitButton tone={mismatch && !canOverride ? "secondary" : "primary"}>Gate out and close the job</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
