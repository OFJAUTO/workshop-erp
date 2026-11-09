"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui";
import { passwordChecks, PASSWORDS_DIFFER_WORDS, PASSWORD_MIN_LENGTH, PASSWORD_RULE_WORDS } from "@/lib/password-rules";

/**
 * THE box for choosing a password (setup link, change password): the new password twice, with the rule ticked off
 * as it is typed. The server checks the same rule (password-rules.ts) and Supabase refuses leaked passwords.
 */
export function PasswordBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const checks = passwordChecks(pw);
  const differs = again.length > 0 && again !== pw;

  return (
    <div className="flex flex-col gap-4" data-password-box>
      <p className="text-sm text-muted" data-password-rule>{PASSWORD_RULE_WORDS}</p>
      <Field label="New password">
        <Input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required autoFocus={autoFocus} value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
        {checks.map((c) => (
          <li key={c.key} className={c.ok ? "text-green-text font-semibold" : "text-muted"} data-password-check={c.key} data-ok={c.ok ? "1" : "0"}>
            {c.ok ? "✓" : "○"} {c.words}
          </li>
        ))}
      </ul>
      <Field label="Type it again">
        <Input name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required value={again} onChange={(e) => setAgain(e.target.value)} />
      </Field>
      {differs ? (
        <p className="text-sm font-semibold text-red -mt-2" data-password-differs>
          {PASSWORDS_DIFFER_WORDS}
        </p>
      ) : null}
    </div>
  );
}
