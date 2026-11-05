# Disaster recovery — plain words (5 November 2026)

What to do if the PC dies, a service locks us out, or data is lost. **Names only here — no
passwords, no keys, ever.** Passwords live in your password manager; the backup encryption key
has ONE copy there too (without it the off-site backups cannot be opened).

## The accounts the system depends on

All of these should be owned by **Omar's own email** with **2-step sign-in ON**. Tick the last
column yourself and tell Claude if any row is wrong.

| Service | What it holds | Owner | 2-step on? |
|---|---|---|---|
| GitHub (github.com/OFJAUTO/workshop-erp) | ALL the code, the docs, the backup schedules, the secrets store | Omar | confirm |
| Vercel (project workshop-erp) | runs the live site erp.ofjauto.com | Omar | confirm |
| Supabase — live project | the live database and all photos/videos/PDFs | Omar | confirm |
| Supabase — test project (workshop-erp-test) | the test copy the checks run on | Omar | confirm |
| Backblaze B2 (bucket ofj-erp-backups) | the OFF-SITE encrypted backups | Omar | confirm |
| Zoho Books | the accounts books (OFJ TEST now; REAL at go-live) | Omar / Mathew | confirm |
| Google Workspace (scans@ofjauto.com) | the scan-reports mailbox; the supplier-LPO email sender | Omar | confirm |
| Domain ofjauto.com (the registrar it was bought at) | the web address itself | Omar | confirm |
| Network International (N-Genius) | the card machine and payment links | Omar | confirm |

## Where every copy of everything lives

- **Code, documents, rules, tests**: the GitHub repository. Nothing of the code exists only on
  the PC.
- **Database**: live in Supabase; a fresh ENCRYPTED copy lands in Backblaze every night at 04:30
  (30 daily + 12 monthly copies kept). Proven restorable by the automatic monthly restore test.
- **Photos, videos, PDFs**: live in Supabase storage; an encrypted incremental copy lands in
  Backblaze every Sunday morning.
- **Only on the PC** (checked 5 November 2026): the two secret files `.env.local` and
  `.env.test.local` (recreatable — every value comes from the services above; Vercel holds the
  live ones too), and the local `backups/` folder (being moved to Backblaze and then deleted).
  Everything else on the PC is a copy of what GitHub holds.

## If the PC dies: a new PC in five steps

1. Install Git and Node.js (nodejs.org, the LTS button), and sign into GitHub.
2. `git clone https://github.com/OFJAUTO/workshop-erp` into a folder.
3. Recreate `.env.local`: copy `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` from Supabase (Project Settings → API), `SUPABASE_DB_PASSWORD`
   (Project Settings → Database; reset it if unknown), `SUPABASE_ACCESS_TOKEN` (your Supabase
   account → Access Tokens), `CRON_SECRET` (Vercel → the project → Settings → Environment
   Variables). Same again for `.env.test.local` from the TEST project.
4. `npm install` in the folder, then `npm run dev` to check it runs.
5. Nothing else is needed — the live site never depended on the PC, and the backups never ran
   from it.

## If data is lost: restoring a backup

- **The database** (the big one): download the wanted copy from Backblaze (`db/daily/…` or
  `db/monthly/…`), then on the PC:
  1. decrypt and unpack it — Claude does this with the key from your safe place;
  2. `node --env-file=.env.local scripts/db-restore.mjs <the unpacked folder>` puts every table
     back exactly as it was at that night's 04:30.
- **One photo/video/PDF or all of them**: the encrypted copies sit in Backblaze under
  `storage/<bucket>/<path>.enc`; decrypted with the same key and uploaded back to Supabase
  storage. Claude has the script pieces for this in `scripts/offsite/`.
- **A quick same-day undo** (wrong apply, bad change): the PC-made pre-change backups
  (`scripts/db-restore.mjs backups/<stamp>`) are faster when the PC is alive — the off-site
  copies are for when it is not.

## If one service locks us out

- **Vercel down/locked**: the code is on GitHub — a new Vercel project from the same repository
  with the same environment variables brings the site back; point erp.ofjauto.com at it (domain
  DNS at the registrar).
- **Supabase locked**: the nightly Backblaze copy restores into a NEW Supabase project
  (`scripts/db-restore.mjs` after the migrations run), storage refills from the Backblaze
  `storage/` copies; then the new project's keys go into Vercel.
- **GitHub locked**: the PC's clone of the repository is a full copy of the code and history;
  push it to a new repository.
- **Backblaze locked**: nothing live is affected — the live system never reads from it; fix the
  account, the next night's backup resumes.

## The alarms

Settings → Background jobs shows the three off-site jobs (nightly backup, weekly storage copy,
monthly restore test). If one fails or misses its time (backup older than 36 hours), the owner's
bell rings by itself — no one has to remember to check.
