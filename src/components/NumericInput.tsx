"use client";

/** A number or money box: letters typed by mistake disappear as you type; decimals keep one dot. */
export function NumericInput({ className = "", onChange, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const clean = props.inputMode === "decimal" ? (v: string) => { const t = v.replace(/,/g, ".").replace(/[^\d.]/g, ""); const i = t.indexOf("."); return i === -1 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, ""); } : (v: string) => v.replace(/[^\d]/g, "");
  return (
    <input
      className={className}
      spellCheck={false}
      onChange={(e) => {
        const c = clean(e.target.value);
        if (c !== e.target.value) e.target.value = c;
        onChange?.(e);
      }}
      {...props}
    />
  );
}
