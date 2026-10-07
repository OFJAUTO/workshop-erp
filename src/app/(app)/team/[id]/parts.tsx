"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ImageCropper } from "@/components/ImageCropper";
import { Button, Field, Input } from "@/components/ui";

export function PinResetForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {() => (
        <>
          <Field label="New 4-digit PIN">
            <Input name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" />
          </Field>
          <SubmitButton size="md" tone="secondary">
            Save new PIN
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function PhotoForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3 flex-1">
      {() => (
        <>
          <ImageCropper name="photo" shape="circle" outputWidth={320} outputHeight={320} capture="user" label="Choose or take a photo" />
          <div>
            <SubmitButton size="md" tone="secondary">
              Save photo
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  const wa = `https://wa.me/?text=${encodeURIComponent("Your Workshop ERP setup link (works once): " + link)}`;
  return (
    <div className="flex flex-col gap-3">
      <textarea readOnly value={link} rows={3} className="w-full rounded-control border border-line-strong bg-canvas p-3 text-xs break-all" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={copy} tone="secondary">
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center min-h-11 px-5 rounded-control bg-ink text-white text-sm font-bold"
        >
          Send on WhatsApp
        </a>
      </div>
    </div>
  );
}
