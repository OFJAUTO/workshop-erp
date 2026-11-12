# Inspection photos and videos never lost – 12 November 2026

## The cause (Step 0)

Since 31 October every file is saved on the tablet first and sent by a queue, so a file that reached the queue was never lost. The losses happened before the queue or around it:

1. **The idle lock threw the video away.** On a shared tablet the ERP signs the technician out after 120 seconds without a touch. Inspection videos still opened the tablet's own camera app, and while it was open the ERP page got no touches. A 60-second video plus framing took more than two minutes, so the lock fired, the page jumped to the PIN screen, and the video the camera app handed back had no screen left to land on. It was never saved, and so it never showed as a failure.
2. **Android closes the browser page while the camera app is open** when memory is low, as on the Android 10 workshop tablets. The page reloads with nothing in it.
3. **A dark screen freezes the page.** Nothing kept the screen on, so sending stopped until someone touched the tablet. Photos took up to 23 minutes to arrive (live: average 55 s, 1 in 10 over 3½ minutes).
4. **Photos went one at a time.**
5. **The server never knew a file existed on a tablet.** The report could not say what was missing, it could go to the customer without the photos, and nobody was told.

## Live, read-only, last 7 days

- No file reached storage without being recorded. Every lost file was lost on the tablet.
- **1 video in the whole week**: 2 seconds, J-01006. Six technicians, all on Android 10 tablets (Mech 3, Mechanical 2, Mechanic 1, Mechanic Tablet 2).
- Reports with bad findings and few or no photos (the likely losses; the old records cannot prove which):

| Job | Car | Technician | Bad items | Photos | Videos |
|---|---|---|---|---|---|
| J-01003 | M 77358 | Hazem | 8 | 0 | 0 |
| J-01006 | S 47571 | Hazem | 3 | 0 | 1 (2 s) |
| J-01007 | FF 33052 | Hazem | 10 | 4 | 0 |
| J-01005 | 4 35944 | Hazem | 27 | 11 | 0 |
| J-01001 | E 42390 | Miguel | 4 | 3 | 0 |
| J-00995 | M 1000 | Miguel | 4 | 5 | 0 |

- Failure log: no inspection upload failures, only 2 "camera blocked" (one tablet's camera permission). That fits: the files vanished before the queue saw them.

## The fix (one shared uploader)

All staff uploads already go through THE queue (`src/lib/send-queue.ts` + `useSendQueue`): inspection, gate-in, gate-out, bodyshop, job files, proofs. So everything below applies to every place at once.

- `src/lib/screen-hold.ts`: the idle lock waits while a camera is open (photos or video), while a file picker or the camera app is open, and while files are being got ready (`holdIdleLock`, `holdWhilePicking`; `IdleLock` re-arms instead of signing out).
- Inspection **Video** records inside the page at 1920 × 1080, the same `VideoRecorder` as gate-in, about 60 MB a minute, never 4K. "Use the camera app instead" stays as a backup.
- The queue: three photos at a time plus videos in their own lane, the screen kept awake while files are on their way (Wake Lock), "Leave the page?" before closing, and "7 of 12 uploaded – sending, keep the tablet on" on the pill.
- `upload_pending` (server only, **WAITING FOR APPLY**): the tablet announces each file the moment it is saved (`/api/uploads/announce`: id, car, item, who took it, which tablet, size, state). The upload door marks it arrived.
  - The job card and the inspection page say "4 files still uploading from Mech 3".
  - Send to customer is greyed with the reason, and `createReportLink` refuses.
  - The five-minute job bells the car's advisors after 15 minutes (`uploads_late`, inspection files only).
- The report is never held up: Submit and the manager's Approve go at once, with the line beside the button. Only a bodyshop finding whose only photo is still on the way still waits, as before.
- A file shows as attached only once the server has recorded it. A file that cannot be sent is red with "Try again" and "Remove".
- Not built: sending with the browser fully closed (Chrome on Android gives a closed page only a few minutes in the background). The files wait safely on the tablet and go the moment any ERP page opens, a big video continuing from where it stopped (6 MB pieces).

## Storage per inspection

- A photo is resized on the tablet to 2000 px JPEG (0.4–0.9 MB), plus the two pre-made sizes (about 0.5 MB): up to **1.4 MB a photo**.
- A video is 1080p, about **60 MB a minute** (60 s maximum), plus a small picture.
- **Typical** (10–25 photos, 2 videos of 20 s): about **50–75 MB** an inspection.
- **Worst case** (40 photos, 5 videos of a full minute): about **360 MB**.
- At this week's pace (about 65 inspections a month):
  - typical adds about 4–5 GB a month (under USD 0.10 a month for each month kept);
  - worst case adds about 23 GB a month (about USD 0.50 a month for each month kept).
- At USD 0.021 per GB-month after Supabase's included storage. Old videos already go to the cheaper archive (9 November).

## Proof (TEST)

`npm run test:inspuploads`: 24/24. Screenshots in `docs/proof/2026-11-12-inspection-uploads/`.
