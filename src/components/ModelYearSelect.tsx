"use client";

import { useState } from "react";
import { Input, Select } from "./ui";

/** Model years: the last 20, newest first; from 1 June next year's model year appears; "Older or other" lets you type. */
export function modelYearOptions(now = new Date()) {
  const year = now.getFullYear();
  const latest = now.getMonth() >= 5 ? year + 1 : year;
  return Array.from({ length: 20 }, (_, i) => latest - i);
}

export function ModelYearSelect({ defaultValue, required = true }: { defaultValue?: string; required?: boolean }) {
  const years = modelYearOptions();
  const preset = defaultValue && years.includes(Number(defaultValue)) ? defaultValue : defaultValue ? "__other__" : "";
  const [choice, setChoice] = useState(preset);
  return (
    <div className="flex flex-col gap-2">
      <Select name="model_year_choice" value={choice} onChange={(e) => setChoice(e.target.value)} required={required}>
        <option value="" disabled>
          Choose…
        </option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
        <option value="__other__">Older or other</option>
      </Select>
      {choice === "__other__" ? (
        <Input
          name="model_year_other"
          defaultValue={defaultValue && !years.includes(Number(defaultValue)) ? defaultValue : ""}
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          placeholder="Four digits, e.g. 2003"
          required={required}
          autoFocus
        />
      ) : null}
    </div>
  );
}
