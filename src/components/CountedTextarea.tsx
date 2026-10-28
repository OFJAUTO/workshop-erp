"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui";
import { TextCounter } from "@/components/TextCounter";
import { LINE_TEXT_MAX } from "@/lib/text-limits";

/** A plain form's long-text box with THE live counter: typing stops at the limit, nothing is ever cut afterwards. */
export function CountedTextarea({ max = LINE_TEXT_MAX, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { max?: number }) {
  const [length, setLength] = useState(String(props.defaultValue ?? "").trim().length);
  return (
    <>
      <Textarea {...props} maxLength={max} onInput={(e) => setLength((e.target as HTMLTextAreaElement).value.trim().length)} />
      <TextCounter length={length} max={max} />
    </>
  );
}
