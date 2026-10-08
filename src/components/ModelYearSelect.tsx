"use client";

import { useState } from "react";
import { Input, Select } from "./ui";

/** Model years: the last 20, newest first; from 1 June next year's model year appears; "Older or other" lets you type. */
export function modelYearOptions(now = new Date()) {
  const year = now.getFullYear();
  const latest = now.getMonth() >= 5 ? year + 1 : year;
  return Array.from({ length: 20 }, (_, i) => latest - i);
}

/**
 * The model year list. Works on its own (`defaultValue`) or driven by the form (`value` and
 * `onChange`), for example pre-selected from the VIN and marked "from VIN" until the advisor
 * changes it.
 */
export function ModelYearSelect({
  defaultValue,
  value,
  onChange,
  fromVin = false,
  required = true,
}: {
  defaultValue?: string;
  value?: string;
  onChange?: (year: string) => void;
  fromVin?: boolean;
  required?: boolean;
}) {
  const years = modelYearOptions();
  const start = value ?? defaultValue ?? "";
  const toChoice = (y: string) => (y && years.includes(Number(y)) ? y : y ? "__other__" : "");
  const [ownChoice, setOwnChoice] = useState(toChoice(start));
  const [ownOther, setOwnOther] = useState(start && !years.includes(Number(start)) ? start : "");
  const controlled = value !== undefined;
  const choice = controlled ? toChoice(value) : ownChoice;
  const other = controlled ? (choice === "__other__" ? value : "") : ownOther;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select
          name="model_year_choice"
          value={choice}
          onChange={(e) => {
            const next = e.target.value;
            if (controlled) onChange?.(next === "__other__" ? "" : next);
            else setOwnChoice(next);
            if (next === "__other__" && controlled) onChange?.("__other__");
          }}
          required={required}
        >
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
        {fromVin && choice && choice !== "__other__" ? <span className="shrink-0 rounded-full bg-chip px-2.5 py-1 text-[11px] font-bold">from VIN</span> : null}
      </div>
      {choice === "__other__" ? (
        <Input
          name="model_year_other"
          value={other === "__other__" ? "" : other}
          onChange={(e) => (controlled ? onChange?.(e.target.value || "__other__") : setOwnOther(e.target.value))}
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
