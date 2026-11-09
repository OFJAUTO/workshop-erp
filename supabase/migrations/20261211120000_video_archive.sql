-- Gate-in videos much clearer (9 November 2026, Section 7). Videos are now 1080p (about 60 MB a minute), so they leave
-- Supabase 12 months after the car leaves (the owner can change the months) and live on in the Backblaze archive only,
-- still retrievable (scripts/offsite/restore-video.mjs). A monthly line in Settings shows the video storage.

alter table public.gate_in_media
  add column if not exists archived_at timestamptz,
  add column if not exists archive_key text;
alter table public.inspection_media
  add column if not exists archived_at timestamptz,
  add column if not exists archive_key text;

-- The months a video stays in Supabase after the car leaves (Settings > Background jobs).
insert into public.settings (key, label, value)
values ('video_archive_months', 'Months a video stays in the app after the car leaves (then the off-site archive only)', to_jsonb(12))
on conflict (key) do nothing;

-- The video storage now and this month, read by the owner's Settings line (server only).
create or replace function public.video_storage_summary()
returns table (total_bytes bigint, total_videos integer, month_bytes bigint, month_videos integer)
language sql
security definer
set search_path = public, storage, pg_temp
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint,
         count(*)::integer,
         coalesce(sum((metadata->>'size')::bigint) filter (where created_at >= date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'), 0)::bigint,
         (count(*) filter (where created_at >= date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'))::integer
    from storage.objects
   where (metadata->>'mimetype') like 'video/%';
$$;
revoke all on function public.video_storage_summary() from public, anon, authenticated;
grant execute on function public.video_storage_summary() to service_role;

-- The monthly archive run (GitHub, never the PC) reports in like the backups.
insert into public.background_jobs (key, label, schedule_label, late_after_minutes)
values ('offsite_video_archive', 'Monthly video archive to Backblaze', 'Monthly, the 2nd at 06:30 Dubai (GitHub)', 46 * 24 * 60)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
