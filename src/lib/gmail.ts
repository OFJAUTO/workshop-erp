import "server-only";
import { createPrivateKey, createSign } from "node:crypto";

/**
 * Google Workspace (Gmail API) with a service account that may act as a mailbox: sending the supplier LPO from the
 * workshop's mailbox, and reading the scans mailbox (scans@ofjauto.com) for the Autel reports.
 *
 * Keys live in Vercel environment variables only:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  the service account's address (…@….iam.gserviceaccount.com)
 *   GOOGLE_SERVICE_ACCOUNT_KEY    its private key (the "private_key" from the JSON file; line breaks may be written as \n)
 *   SCANS_MAILBOX                 the mailbox the scanner's reports arrive in (scans@ofjauto.com)
 * Google Workspace must allow the service account to act as the mailbox (domain-wide delegation): gmail.send for
 * the sending mailbox, gmail.readonly for the scans mailbox. Nothing is ever changed or deleted in the mailbox.
 */

export const SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send";
export const SCOPE_READ = "https://www.googleapis.com/auth/gmail.readonly";

/** The scans mailbox address from Vercel, or "" when not set. */
export function scansMailbox(): string {
  return String(process.env.SCANS_MAILBOX ?? "").trim();
}

export function gmailConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const cachedTokens = new Map<string, { token: string; expires: number }>();

/** An access token for the mailbox and the scope, through the service account's signed claim. */
async function accessToken(sub: string, scope: string = SCOPE_SEND): Promise<string> {
  const cacheKey = `${sub}|${scope}`;
  const cached = cachedTokens.get(cacheKey);
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
  const pem = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: email, sub, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
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
  cachedTokens.set(cacheKey, { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}

/* ---------------- Reading the scans mailbox ---------------- */

export type GmailPart = { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId?: string; internalDate?: string; payload?: GmailPart };

async function gmailGet<T>(mailbox: string, path: string): Promise<T> {
  const token = await accessToken(mailbox, SCOPE_READ);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Google refused reading the mailbox${json?.error?.message ? `: ${json.error.message}` : ""}.`);
  return json;
}

/** The ids of the messages matching a Gmail search (newest first), up to max. */
export async function listMessages(mailbox: string, q: string, max = 30): Promise<string[]> {
  const json = await gmailGet<{ messages?: { id: string }[] }>(mailbox, `messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
  return (json.messages ?? []).map((m) => m.id);
}

/** One message in full: headers, body parts and attachment ids. */
export async function getMessage(mailbox: string, id: string): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(mailbox, `messages/${id}?format=full`);
}

/** The bytes of one attachment. */
export async function getAttachment(mailbox: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const json = await gmailGet<{ data?: string }>(mailbox, `messages/${messageId}/attachments/${attachmentId}`);
  return fromB64url(json.data ?? "");
}

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function walk(p: GmailPart | undefined, out: GmailPart[]) {
  if (!p) return;
  out.push(p);
  for (const c of p.parts ?? []) walk(c, out);
}

/** A header's value ("From", "Subject"), or null. */
export function headerOf(msg: GmailMessage, name: string): string | null {
  const h = (msg.payload?.headers ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

/** The plain text of the message (the text/plain part, else the HTML with its tags taken out). */
export function textBodyOf(msg: GmailMessage): string {
  const parts: GmailPart[] = [];
  walk(msg.payload, parts);
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain?.body?.data) return fromB64url(plain.body.data).toString("utf8");
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (html?.body?.data) return fromB64url(html.body.data).toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

/** The attachments: name, type, and either the bytes (small ones come inline) or the id to fetch. */
export function attachmentsOf(msg: GmailMessage): { filename: string; mimeType: string; attachmentId: string | null; data: Buffer | null }[] {
  const parts: GmailPart[] = [];
  walk(msg.payload, parts);
  return parts
    .filter((p) => (p.filename && p.filename.length > 0) || (p.body?.attachmentId && p.mimeType && !p.mimeType.startsWith("text/")))
    .map((p) => ({ filename: p.filename || "attachment", mimeType: p.mimeType || "application/octet-stream", attachmentId: p.body?.attachmentId ?? null, data: p.body?.data ? fromB64url(p.body.data) : null }));
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
