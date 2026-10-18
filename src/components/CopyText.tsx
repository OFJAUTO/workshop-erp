"use client";

import { useState } from "react";

/** A Copy button next to a message button: copies the full text, says "Copied" for a moment. */
export function CopyText({ text, label = "Copy", small = false }: { text: string; label?: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-copy-text
      className={`inline-flex items-center justify-center rounded-control border border-line-strong bg-white font-bold ${small ? "min-h-9 px-3 text-xs" : "min-h-11 px-4 text-sm"} ${copied ? "text-green" : ""}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* an old browser without the clipboard: nothing to show */
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
