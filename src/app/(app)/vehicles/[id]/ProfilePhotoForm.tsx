"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ImageCropper } from "@/components/ImageCropper";

export function ProfilePhotoForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {() => (
        <>
          <ImageCropper name="photo" shape="wide" outputWidth={960} outputHeight={600} capture="environment" label="Choose or take a picture" />
          <div>
            <SubmitButton size="md" tone="secondary">
              Save as the car&apos;s picture
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
