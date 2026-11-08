import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { CHANGE_WORDS, METHOD_WORDS } from "@/lib/passkey-rules";
import type { SignInLine } from "@/lib/sign-in-data";

/** THE sign-in log list: every sign-in (and refused one) and every change to a person's ways in, newest first. */
export function SignInLog({ lines, showPerson = false, empty = "Nothing yet." }: { lines: SignInLine[]; showPerson?: boolean; empty?: string }) {
  if (!lines.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line" data-sign-in-log>
      {lines.map((l, i) => {
        const label = l.kind === "sign_in" ? `${METHOD_WORDS[l.what] ?? l.what} sign-in` : (CHANGE_WORDS[l.what] ?? l.what);
        const tone = l.kind === "change" ? "outline" : !l.ok ? "red" : l.what === "password_backup" ? "amber" : l.what === "passkey" ? "green" : "neutral";
        return (
          <li key={i} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-sign-in-line={l.kind} data-what={l.what} data-ok={l.ok ? "1" : "0"}>
            <span className="text-muted tabular-nums shrink-0">{formatDateTime(l.at)}</span>
            {showPerson && l.staffName ? <span className="font-semibold">{l.staffName}</span> : null}
            <Badge tone={tone}>{l.kind === "sign_in" && !l.ok ? `${label} refused` : label}</Badge>
            {l.detail ? <span className="text-muted break-words min-w-0">{l.detail}</span> : null}
            {l.byName && l.byName !== l.staffName ? <span className="text-muted">by {l.byName}</span> : null}
            {l.device ? <span className="text-faint text-xs">{l.device}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
