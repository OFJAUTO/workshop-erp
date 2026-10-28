"use client";

import { Input } from "@/components/ui";
import { authCodeProblem, authCodeWhere, cleanAuthCode } from "@/lib/auth-code";

/**
 * THE auth code box (29 October 2026) for card-machine and payment-link payments, in the payment form and the deposit
 * panel alike: 6 letters or digits from the card slip or the payment confirmation, typed in capitals, required. It is
 * the key that matches the payment to the bank's settlement report.
 */
export function AuthCodeInput({ method, value, onChange, name = "auth_code" }: { method: string; value: string; onChange: (v: string) => void; name?: string }) {
  const problem = value ? authCodeProblem(method, value) : null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">Auth code (from {authCodeWhere(method)}, required)</span>
      <Input
        name={name}
        value={value}
        onChange={(e) => onChange(cleanAuthCode(e.target.value).slice(0, 6))}
        required
        minLength={6}
        maxLength={6}
        pattern="[A-Za-z0-9]{6}"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="e.g. 756117"
        className="max-w-44 font-mono uppercase tracking-widest"
        data-auth-code
      />
      {problem && value.length >= 6 ? <span className="text-xs font-semibold text-red" data-auth-code-problem>{problem}</span> : null}
    </label>
  );
}
