# Gate-in videos much clearer (9 November 2026, Section 7)

## 1. How it was until today (read on live, nothing changed)

- **How they were taken:** the "Record with the camera" button opened the phone's own camera app through the web page. On an iPhone, Safari then saves the video at its "medium" web quality.
- **Five newest gate-in videos (9 Nov):**
  - **480 × 360 pixels, about 24 frames a second, 0.85 Mbps**;
  - 1.2 to 19 MB each, 12 seconds to 3 minutes.
  - That is why they look blurry.
- **Re-compression:** none by the ERP. The file was stored as the phone handed it over. The phone itself had already shrunk it.
- **Volume:**
  - Gate-in: 131 videos, 1.17 GB in total, average **9.0 MB**, largest 19.4 MB.
  - Inspection: 13 videos, 283 MB.
  - Per month: 83 gate-in videos (691 MB) in October, 48 (481 MB) so far in November, so about **90 a month**.
- **All storage today:** 2.45 GB (photos, videos, PDFs).

## 2. What changed

- **Recording:** "Record video (1080p)" now records inside the page with the back camera, at **1920 × 1080, 30 fps, 8 Mbps** (about 60 MB a minute). The file is stored **exactly as recorded**: no shrinking, no re-compression.
  - The screen shows the quality before recording ("1920 × 1080 · 30 fps").
- **Too low is refused:** a camera giving less than 720p is refused with a message. So is a video chosen from the phone under 720p (for example the old 480 × 360 ones): "This video is only 480 × 360, too blurry for the record. Record it again here…".
- **Upload:** resumable, in the background, with progress, through the existing send queue. A recording is never lost: it stays on the device until the server has it, also after a reload. The box turns green with **"Video uploaded ✓"**; a failed send shows Try again.
- **The customer's link:** plays the same file, streamed (it starts before the whole file is downloaded). Staff get **Download original** under each video.
- **Archive:**
  - 12 months after the car leaves, a monthly GitHub job (never this PC) moves the video to the Backblaze archive, encrypted, checked, then removed from Supabase.
  - The video's record keeps where it went; `scripts/offsite/restore-video.mjs` brings it back.
  - You change the 12 months in Settings ("Videos stay in the app for").
- **Storage line:** in Settings › Background jobs, "Video storage: X GB · about USD Y a month (N videos) · added this month Z GB" (after the apply).

## 3. What to expect in size and cost

- At 1080p a 2-minute walk-around is about **120 MB** (before: about 9 MB).
- About 90 a month at about 1.5 minutes each comes to roughly **8 GB a month**.
- Supabase charges about USD 0.021 per GB a month. After 12 months that is about 100 GB in the app, around **USD 2 a month**; then older videos move to the archive.

## Waiting for apply

`supabase/migrations/20261211120000_video_archive.sql`: the archived stamp on videos, the storage summary for the Settings line, the 12-month setting and the archive job's row. The 1080p recording, the 720p refusal and Download original work without it.
