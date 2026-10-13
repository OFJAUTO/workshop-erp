"use client";

import { useRef, useState, type ReactNode } from "react";
import { CameraCapture } from "./CameraCapture";

/** A phone or tablet with a camera the page can open itself. On a PC the file picker is used. */
export function usesInPageCamera(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const coarse = (window.matchMedia?.("(pointer: coarse)")?.matches ?? false) || navigator.maxTouchPoints > 0;
  return coarse && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * One real button for every photo: "camera" opens the camera inside the page on a phone or tablet (the file
 * picker on a PC); "gallery" opens the device's photos. The hidden file input is clicked by the button itself,
 * never by a label, so a tap always does something, and a tap that does nothing is reported as a failure.
 */
export function PhotoButton({
  source = "camera",
  multiple = false,
  accept,
  disabled = false,
  className = "",
  title,
  children,
  onFiles,
  onProblem,
}: {
  source?: "camera" | "gallery";
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  className?: string;
  /** The camera window's title. */
  title?: string;
  children: ReactNode;
  onFiles: (files: File[]) => void;
  /** The camera could not be opened (blocked, missing, busy): logged by the caller. */
  onProblem?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);

  function openFiles() {
    const el = inputRef.current;
    if (!el) return;
    el.value = "";
    el.click();
  }
  function onClick() {
    if (disabled) return;
    if (source === "camera" && usesInPageCamera()) setCamera(true);
    else openFiles();
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={disabled} className={className} data-photo-button={source}>
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept ?? (source === "camera" ? "image/*" : "image/*,.heic,.heif")}
        capture={source === "camera" ? "environment" : undefined}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {camera ? (
        <CameraCapture
          multiple={multiple}
          title={title ?? (typeof children === "string" ? children : "Take a photo")}
          onCapture={(files) => {
            setCamera(false);
            if (files.length) onFiles(files);
          }}
          onClose={() => setCamera(false)}
          onFallback={() => {
            setCamera(false);
            openFiles();
          }}
          onProblem={(p) => onProblem?.(`${p.kind}: ${p.message}`)}
        />
      ) : null}
    </>
  );
}
