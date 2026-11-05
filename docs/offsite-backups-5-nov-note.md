# Off-site backups — part 1 built (5 November 2026, the owner's "approve backups")

The plan the owner approved: Backblaze B2 in his name (USD 0.00/month at today's size, USD 6.95
ceiling at a full terabyte), scheduled from GitHub's cloud — never from the PC. This note covers
part 1 (everything that does not need the Backblaze key); part 2 runs the moment the owner says
"key saved".

## Built and proven

- **The nightly database backup** (`scripts/offsite/backup-db.mjs`, workflow
  `offsite-backup.yml`, 04:30 Dubai): every table dumped read-only, packed, **encrypted
  (AES-256-GCM)**, uploaded, 30 daily + 12 monthly copies kept, older ones pruned. Proven by a
  full local roundtrip on the real data: 111 tables, 250,256 rows, 24.7 MB encrypted, decrypted
  and matched exactly (`npm run backup:offsite -- --dry-run`).
- **The weekly storage copy** (`backup-storage.mjs`, `offsite-storage.yml`, Sundays 05:30):
  photos/videos/PDFs, incremental by an encrypted manifest, each file encrypted. Files deleted in
  the app stay in the backup.
- **The monthly restore test** (`restore-test.mjs`, `offsite-restore-test.yml`, the 1st, 06:00):
  the newest copy restored into the TEST project's own scratch schema (the test data and its
  anonymisation are never touched), every table's count checked against the dump, known records
  checked, report on the heartbeat row.
- **The alarms**: three rows in Settings > Background jobs (migration `20261205120000`, WAITING
  FOR APPLY with backup `backups/2026-11-05T05-15-52`); the owner's bell rings when the nightly
  copy is late (36 h), the weekly misses its week, the monthly misses its month, **or any of them
  records a failure** (`checkLateJobs` now bells a failed offsite run at once).
- **The secrets**: five set in the GitHub repository's secret store without ever printing a value
  (the two pooler database addresses — GitHub's runners have no IPv6 and Supabase's direct host is
  IPv6-only — the storage address and service key, and the generated encryption key). The key's
  ONE safe copy is a local file for the owner's password manager, deleted on his "key copied".
- **The one-off move of the PC's `backups/` folder** (125 folders, 20 GB):
  `npm run backup:migrate-local` packs, encrypts and uploads each folder, VERIFIES each by
  downloading and decrypting it again, prints the delete list, and `--delete` removes only the
  verified ones. Runs in part 2.
- **`docs/disaster-recovery.md`**: the plain-words guide — the account list (names only, no
  secrets), the new-PC steps, the restore steps, and the PC-only audit (only the two secret files
  and the backups folder exist solely on the PC; both covered).
- Unit test `tests/unit/offsite-backup.test.mjs` (roundtrip, tamper refused, wrong key refused,
  retention 30/12) in `npm run test:unit`.

## Part 2 (on "key saved")

Set the three B2 secrets, run the nightly workflow by hand and verify the copy in the bucket, run
the storage copy, move the PC's 20 GB with the verify-then-delete list, and run the restore test
once for the report.

Lesson: GNU tar on Windows reads any `C:\…` argument as a REMOTE HOST ("Broken pipe"); the
archive name goes in relative to its own folder and directories as `/c/…` (a no-op on Linux).
