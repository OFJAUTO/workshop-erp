-- OFF-SITE BACKUPS (5 November 2026, approved by the owner): three rows in the background-jobs
-- watch list, so Settings > Background jobs shows every run and the owner's bell rings when the
-- nightly backup is late (over 36 hours), the weekly storage copy misses its week, the monthly
-- restore test misses its month, or any of them records a failure.
insert into public.background_jobs (key, label, schedule_label, late_after_minutes) values
  ('offsite_backup', 'Off-site database backup', 'every night at 04:30', 2160),
  ('offsite_storage', 'Off-site storage copy', 'every Sunday morning', 11520),
  ('offsite_restore', 'Monthly restore test', 'the 1st of each month', 50400)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
