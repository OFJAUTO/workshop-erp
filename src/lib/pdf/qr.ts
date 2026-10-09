import "server-only";
import QRCode from "qrcode";

/** A QR code as a PNG for the PDFs and the part labels. */
export async function qrPng(text: string, size = 240): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: "png", width: size, margin: 1, errorCorrectionLevel: "M" });
}

/** A QR code as a data address for web pages (labels, previews). */
export async function qrDataUrl(text: string, size = 240): Promise<string> {
  return QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M" });
}
