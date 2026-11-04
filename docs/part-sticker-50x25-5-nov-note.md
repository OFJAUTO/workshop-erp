# Part stickers 50 × 25 mm — 5 November 2026 (night)

What the owner asked for (4 November): "our labels are 50 × 25 mm (width × height, landscape).
Set Printer 1 to 50 × 25 mm as the default and design the sticker for that shape: QR code on the
left (about 21 mm square), on the right the OFJ logo, job number (big), position (e.g. FRONT
LEFT) and the part name with '1 OF 1' in the black bar. Everything on ONE label, nothing cut off,
readable at arm's length."

This is the first half of the part-stickers work — the fuller stickers message still waiting in
the queue will be folded into the same sticker when it arrives, not built again.

## The new sticker

Exactly the dictated layout: the QR fills the left at 21 mm; the right column stacks the OFJ
logo, the job number BIG (the arm's-length line), the position in bold capitals, and the black
bar with the part name and "1 OF 2". The date is no longer printed on the face (it lives in the
ERP behind the QR). A normal name ("FRONT BRAKE PADS SET") sits at 2.6 mm over two lines; an
unusually long name may take three lines and shrink further — never cut off, and the test print
proves nothing ever overflows the label.

Same sticker everywhere: the receiving print page, the handover sheet, the Settings preview and
the test print (`/parts/labels/…?test=1` now shows the position too, so a printer test shows the
whole layout).

## The size

- The DEFAULT part-sticker size is now 50 × 25 (was 40 × 30).
- **Waiting for apply:** `20261205090000_part_sticker_50x25.sql` moves the STORED size on live to
  50 × 25 (backup `backups/2026-11-04T21-23-50`). Until then the new design prints at the old
  40 × 30 — or type 50 and 25 in Settings > Stickers yourself, same thing.
- Printer 1 (the part-sticker printer named in Settings) then feeds 50 × 25 pages: the print page
  sets the paper size itself (`size: 50mm 25mm`), so the printer driver only needs its 50 × 25
  label roll selected once.

## Proof

`npm run test:sticker50` (7 checks: the label is 50 × 25, the QR 21 mm, the position on it, the
name bar with "1 OF 2", nothing cut off, the paper size, the Settings preview) and test-z S4
re-proven (long names shrink and wrap, never "…", the job number one line, one print job).
Before/after pictures in `tests/browser/shots/sticker-50x25/`: the old sticker at its 40 × 30,
the old layout squeezed into 50 × 25, and the new label.
