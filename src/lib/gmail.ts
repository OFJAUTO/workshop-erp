import "server-only";
import { createPrivateKey, createSign } from "node:crypto";

/**
 * Sending email through Google Workspace (Gmail API) with a service account that may act as one mailbox.
 *
 * Keys live in Vercel environment variables only:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  the service account's address (…@….iam.gserviceaccount.com)
 *   GOOGLE_SERVICE_ACCOUNT_KEY    its private key (the "private_key" from the JSON file; line breaks may be written as \n)
 * The mailbox to send from (for example peter@ofjauto.com) is a setting; Google Workspace must allow the service
 * account to send as it (domain-wide delegation with the gmail.send scope).
 */

export function gmailConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let cachedToken: { sub: string; token: string; expires: number } | null = null;

/** An access token for the mailbox, through the service account's signed claim. */
async function accessToken(sub: string): Promise<string> {
  if (cachedToken && cachedToken.sub === sub && cachedToken.expires > Date.now() + 60000) return cachedToken.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
  const pem = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: email, sub, scope: "https://www.googleapis.com/auth/gmail.send", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(createPrivateKey(pem)));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${signature}` }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google refused the sign-in${json.error_description ? `: ${json.error_description}` : json.error ? `: ${json.error}` : ""}.`);
  cachedToken = { sub, token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

export type MailAttachment = { filename: string; content: Buffer; contentType: string };

/** Sends one email with attachments from the mailbox. Throws with a plain-words reason when it cannot. */
export async function sendGmail(input: { from: string; fromName?: string; to: string; subject: string; text: string; attachments?: MailAttachment[] }): Promise<{ id: string }> {
  if (!gmailConfigured()) throw new Error("Email is not set up yet: the Google Workspace keys are missing.");
  const token = await accessToken(input.from);
  const boundary = `ofj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
  const parts: string[] = [
    `From: ${input.fromName ? `${encodeHeader(input.fromName)} <${input.from}>` : input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.text, "utf8").toString("base64"),
  ];
  for (const a of input.attachments ?? []) {
    parts.push(`--${boundary}`, `Content-Type: ${a.contentType}; name="${a.filename}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${a.filename}"`, "", a.content.toString("base64"));
  }
  parts.push(`--${boundary}--`, "");
  const raw = b64url(parts.join("\r\n"));
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) throw new Error(`Google did not accept the email${json.error?.message ? `: ${json.error.message}` : ""}.`);
  return { id: json.id };
}
