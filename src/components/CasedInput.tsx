"use client";

import { knownWordsFromPage, tidyText, type TextCase } from "@/lib/text-case";

/**
 * A text box that tidies its own case when the person leaves it: names to Title Case, codes to
 * CAPITALS, descriptions to sentence case. The phone keyboard is told the same (autoCapitalize),
 * and the database does it again on save, so nothing shouty or all-lower-case gets through.
 */
export function CasedInput({ textCase, onBlur, onChange, autoCapitalize, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { textCase: TextCase }) {
  return (
    <input
      autoCapitalize={autoCapitalize ?? (textCase === "upper" ? "characters" : textCase === "title" ? "words" : "sentences")}
      onChange={onChange}
      onBlur={(e) => {
        const fixed = tidyText(e.target.value, textCase, knownWordsFromPage());
        if (fixed !== e.target.value) {
          e.target.value = fixed;
          onChange?.(e as unknown as React.ChangeEvent<HTMLInputElement>);
        }
        onBlur?.(e);
      }}
      {...props}
    />
  );
}

export function CasedTextarea({ textCase, onBlur, onChange, autoCapitalize, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { textCase: TextCase }) {
  return (
    <textarea
      autoCapitalize={autoCapitalize ?? (textCase === "upper" ? "characters" : textCase === "title" ? "words" : "sentences")}
      onChange={onChange}
      onBlur={(e) => {
        const fixed = tidyText(e.target.value, textCase, knownWordsFromPage());
        if (fixed !== e.target.value) {
          e.target.value = fixed;
          onChange?.(e as unknown as React.ChangeEvent<HTMLTextAreaElement>);
        }
        onBlur?.(e);
      }}
      {...props}
    />
  );
}
