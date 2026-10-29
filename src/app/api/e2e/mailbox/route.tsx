import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { processMail, type MailAttachmentIn } from "@/lib/mailbox";
import { mailboxConnection, openToken, saveConnection } from "@/lib/google-mailbox";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Local tests only: feeds one email through the same steps the mailbox reader uses (the VIN found in the subject, the
 * body or inside the PDF; the match; the files; the notifications). `pdfText` makes a one-page PDF with those words
 * as the attachment; `imageBase64` attaches a picture. Never in production.
 */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { from?: string; subject?: string; text?: string; pdfText?: string; fileName?: string; imageBase64?: string; messageId?: string; connectTest?: { refreshToken: string } };
  // A test connection through the same store as the real sign-in. Refused when a real mailbox is connected (the database is shared).
  if (body.connectTest) {
    const current = await mailboxConnection();
    if (current && !current.mailbox.startsWith("e2e")) return NextResponse.json({ error: "A real mailbox is connected; the test leaves it alone." }, { status: 409 });
    const admin = createAdminClient();
    const { data: owner } = await admin.from("staff").select("id").eq("role_id", "owner").eq("is_active", true).limit(1).maybeSingle();
    await saveConnection("e2e-scans@ofjauto.com", body.connectTest.refreshToken, owner?.id ?? null);
    const { data: row } = await admin.from("google_mailbox_tokens").select("refresh_token_enc").eq("is_active", true).order("connected_at", { ascending: false }).limit(1).maybeSingle();
    const stored = String(row?.refresh_token_enc ?? "");
    return NextResponse.json({ ok: !!stored, plainStored: stored.includes(body.connectTest.refreshToken), roundTrip: openToken(stored) === body.connectTest.refreshToken });
  }
  const attachments: MailAttachmentIn[] = [];
  if (body.pdfText) {
    const pdf = await renderToBuffer(
      <Document>
        <Page size="A4" style={{ padding: 40, fontSize: 12, fontFamily: "Helvetica" }}>
          <Text>{body.pdfText}</Text>
        </Page>
      </Document>,
    );
    attachments.push({ name: body.fileName ?? "autel-report.pdf", contentType: "application/pdf", bytes: Buffer.from(pdf) });
  }
  if (body.imageBase64) attachments.push({ name: body.fileName ?? "scan.jpg", contentType: "image/jpeg", bytes: Buffer.from(body.imageBase64, "base64") });
  // eslint-disable-next-line react-hooks/purity
  const result = await processMail({ messageId: body.messageId ?? `e2e-${Date.now()}`, from: body.from ?? "scanner@example.com", subject: body.subject ?? "", text: body.text ?? "", attachments });
  return NextResponse.json(result);
}
