# Uploads: every staff upload straight to storage, kept on the device until it arrives

31 October 2026 (night batch section 10, finished)

## What changed for the staff

**A file now stays on the device from the moment it is picked until OFJ's server confirms it.** This covers every
photo, video and PDF on every staff upload screen.

- **No signal** (a basement, a dead spot): the photo shows at once with its own picture and the words
  "Saved on this device – no signal, it sends by itself when the signal is back". It goes by itself when the signal
  is back, from whichever ERP page is open.
- **The page closed, a new version, the phone went to sleep:** the file is still there and still goes.
- **The shared tablet's idle lock signed the person out:** the file still arrives, recorded under the person who
  took it, with the time they took it (not the time it arrived).
- **Big videos** go in 6 MB pieces. A dropped signal costs one piece, never the whole video: the send carries on
  from where it stopped.
- **A small pill** at the bottom left ("2 files waiting to send") appears only while files are on the device. Tap it
  to see each file, "Try again now" or "Remove".
- **A file the place can never take** stops in red with the reason in plain words, instead of trying for ever.
  Examples: the report was approved and locked meanwhile, or the file is too big.
- Nothing turns green or "done" until the server has the file. Buttons that need the file first still wait for it:
  recording a card payment needs the slip, the gate-out needs the km photo, a stage hand-over needs its photo.

## The list (10.1): every upload place and how it sends now

**Straight to storage and kept on the device (the send queue):**

| Area | Upload places |
|---|---|
| Gate-in | Car picture; exterior and interior videos; dashboard; keys front and back; the four wheels; damage close-ups; a photo per marked panel on the car outline; "damage found after check-in" (job card and technician's screen); the phone QR page |
| Loose items | The photo under each item line (was through the server) |
| Inspection | Checklist items (photo, video); brake discs and pads; tyres; A/C vent reading; battery printout; the pre-scan PDF (both places); bodyshop finding panels; road test |
| QC | The post-scan PDF |
| Bodyshop | Stage hand-over photos; problem photo; tint fitted; PPF recheck points; 10-day check; customer-update photos; removed parts; the film plotter photo (was through the server); the PPF section tablet's tint photo (was through the server) |
| Work | Additional work found |
| Gate-out | km / instrument cluster photo; old parts handed over; handover or loading photos and video |
| Payment proof | Card slip or transfer proof when recording a payment or a deposit; the advance payment before the proforma (was through the server); proof of paying a supplier on an LPO (was through the server); commission voucher or bank slip (was through the server) |
| Parts invoices | Supplier invoice scans (receiving, the LPO's invoice card); the credit note scan for a part sent back (was through the server) |
| Recovery | The driver's one-button page keeps its own queue, as before. The office backup photo goes straight to storage, without the device queue (an office PC fallback). |

**Still through the server, on purpose:**

| Place | Why |
|---|---|
| Card settlements: the bank's report | It is read (PDF, CSV or Excel) before it is kept. Small, desk PC. |
| Parts > Import prices: Excel/CSV, supplier PDFs, screenshots | Read in memory and never kept. |
| Settings > Stickers: the logo | Owner only, tiny, the type check matters. |
| Team > a person's photo | A small round crop (about 30 KB). |
| Cars: the car picture crop | Tiny crop. |
| Cars: "Add a photo" | Shrunk on the device first. **The one left worth moving later.** |
| Parts table: "Attach diagram" | Parts desk PC; photos are shrunk. A PDF over about 4 MB would fail. |
| A payment proof on an invoice with no job | No such invoice exists today. "Pending charges" will add them, with their own upload place. |

The old routes (`/api/media/*`, `/api/files/*`, `/api/inspection-media/prepare|register`, `/api/parts/supplier-proof`,
`/api/commissions/proof`, and the file fields of the converted forms) still answer, for pages opened before this
change. They can go in a few days.

## How it works (for the next developer)

- **THE door:** `/api/uploads/grant`, `/api/uploads/prepare` and `/api/uploads/register`. They are public paths that
  check a sending permit or the session themselves.
  - Each kind of place is one `TargetSpec` in `src/lib/upload-targets/`: `gate_in`, `inspection`, `job_file`,
    `supplier_proof`, `commission_proof`, `credit_note`, `loose_item`.
  - The browser names every file with its own uuid, so the object path is the same on every try. A resumable video
    carries on; a stored file is never sent twice (prepare answers `exists`); a second register answers with the
    first row.
  - Refusals carry `permanent`.
- **Sending permit** (`src/lib/upload-grant.ts`): an HMAC permit (12 hours) for one place, made while the person may
  add files there.
  - It is kept with each queued file, so the file arrives after a sign-out, the idle lock or the phone link's end.
  - A late file taken before an inspection was submitted or approved is still accepted.
  - The PIN-only section tablet receives one after its PIN step.
- **The queue** (`src/lib/send-queue.ts`):
  - IndexedDB `erp-send-queue`.
  - One runner per browser (Web Lock) in the root layout's `SendQueueHost`.
  - Two lanes: files up to 6 MB, and bigger ones.
  - Waits after a failure: 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min. When the signal is back, everything
    waiting is sent at once.
- **Screens** use `useSendQueue` (`src/lib/use-send-queue.ts`).
- **Resumable sends are ON** for files over 6 MB. `NEXT_PUBLIC_RESUMABLE_UPLOADS=0` switches them off.
- **Fixed on the way:**
  - "Damage found after check-in" photos were refused for technicians and managers.
  - Inspection photos were refused on the owner's direct edit, the bodyshop findings after approval and road tests
    after approval. The X now follows the same rule as adding.
  - A late QC post-scan PDF now becomes the round's post-scan.
  - A late payment proof now joins its payment.
  - Repeated registers no longer make duplicate rows.

## The storage limit (done 31 October, with the owner's OK)

**The live storage refused any file over 50 MB.** This is the project setting "Upload file size limit"; the video folders
already allowed 500 MB, but the project limit wins.

- Four inspection videos were refused this way since 29 October (the biggest 88.7 MB).
- Raised to **500 MB** on live (and on the test project) on 31 October, with the owner's OK.
- Anything above 500 MB stops with "Too big to send (… MB is over the limit)" instead of failing quietly.

## Proof (on the test database)

- `npm run test:uploads`, 23 checks:
  - the door: same path on every try, a repeat records nothing new, wrong types and places refused for good, a forged
    permit gets nothing;
  - a photo picked with no signal kept on the device, sent from another page when the signal came back, with the time
    it was taken;
  - signed out before sending: it still arrived, under the technician;
  - a photo the approved report can no longer take stops in red with the reason;
  - a 13 MB video in 6 MB resumable pieces, stored whole.
- `npm run test:uploads-video`, 5 checks: **a 200 MB inspection video on slow 3G** (400 kbit/s, 400 ms).
  - It took 67.9 minutes, in 35 resumable pieces.
  - The signal was cut for a minute at 72 MB; it carried on from 78 MB, not from zero.
  - Stored whole: 209,715,220 bytes.
- Pictures are in `tests/browser/shots/uploads/`.

## Found while testing

- **Big files could not be sent resumably at all.** The plain resumable endpoint checks the bucket's row rules, and
  with a one-time address every piece was refused (403). Resumable sends now use storage's signed endpoint
  (`/upload/resumable/sign`).
- **The 403 showed as "No signal".** The words rule matched "load failed" inside "Upload failed". Now "no signal" is
  said only when there was no answer at all.
- **Two independent reviews** (22 + 10 findings, 4 refuted) led to the shape described above:
  - permits kept per person, and files waiting for their own taker;
  - the two lanes, with a lock per file;
  - the bytes stored once;
  - database hiccups answered "try again";
  - repeated payment taps recognised;
  - late files (QC post-scan, body panels) only where they belong.
