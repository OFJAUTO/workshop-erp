"use client";

import { Input } from "@/components/ui";
import { AUTH_OPTIONAL_HINT, authCodeNote, authCodeProblem, authCodeRefusal, cleanAuthCode } from "@/lib/auth-code";

/**
 * THE auth code box (29 October 2026) for card-machine and payment-link payments: the payment form (money page,
 * invoice page, the Record payment window), the deposit panel and the advisors' "Payment received – send to accounts".
 * 6 letters or digits from the card slip or the payment confirmation, typed in capitals.
 *
 * 3 November 2026 (section 5): OPTIONAL everywhere ("Optional – helps match the bank report"). Left empty, or holding a
 * code a bank never prints (111111, 123456 …), the payment is saved as "Auth code missing" and flagged for accounts;
 * only a code of the wrong length is refused. `required` is the "Add auth code" box, where a real code is the point: there
 * a made-up code is named in red with the same words the server refuses it with (never "saved as missing").
 */
export function AuthCodeInput({ method, value, onChange, name = "auth_code", required = false }: { method: string; value: string; onChange: (v: string) => void; name?: string; required?: boolean }) {
  const problem = value ? authCodeProblem(method, value) : null;
  const refused = required && value.length >= 6 ? authCodeRefusal(method, value) : null;
  const note = !required && value.length >= 6 ? authCodeNote(method, value) : null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{required ? "Auth code" : "Auth code (optional)"}</span>
      <Input
        name={name}
        value={value}
        onChange={(e) => onChange(cleanAuthCode(e.target.value).slice(0, 6))}
        required={required}
        minLength={6}
        maxLength={6}
        pattern="[A-Za-z0-9]{6}"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        spell={false}
        placeholder="e.g. 756117"
        className="max-w-44 font-mono uppercase tracking-widest"
        data-auth-code
      />
      {!required ? <span className="text-xs text-muted" data-auth-optional-hint>{AUTH_OPTIONAL_HINT}</span> : null}
      {problem && value.length >= 6 ? <span className="text-xs font-semibold text-red" data-auth-code-problem>{problem}</span> : null}
      {refused ? <span className="text-xs font-semibold text-red" data-auth-code-refused>{refused}</span> : null}
      {note ? <span className="text-xs font-semibold text-amber-bar" data-auth-code-note>{note}</span> : null}
    </label>
  );
}
