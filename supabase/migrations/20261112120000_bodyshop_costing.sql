-- Bodyshop costing (21 October 2026, batch section 4): profit must be real, internal only.
-- 1. Our own bodyshop work (film, tint, ceramic) is never "Outside work": outside work is only when
--    another company does the job. The code now reads quotation_lines.outside_work for that, so the
--    wrongly-flagged bodyshop services and their lines are put right here (data correction, no money
--    changes; the lock trigger is bypassed for the flag only).
-- 2. Default installer hours per bodyshop service (services.installer_hours, editable in Settings),
--    copied onto each quotation line (quotation_lines.installer_hours) so the internal box can show
--    "Estimated installer hours: X h × bodyshop rate" and count it against profit.

alter table public.services add column if not exists installer_hours numeric(6,2);
alter table public.quotation_lines add column if not exists installer_hours numeric(6,2);

-- The agreed defaults, most specific last so it wins.
update public.services set installer_hours = 96 where is_active and bodyshop_kind in ('ppf', 'coloured_ppf') and name ~* 'exterior';
update public.services set installer_hours = 8  where is_active and name ~* 'ppf' and name ~* 'inter[io]or';
update public.services set installer_hours = 16 where is_active and name ~* 'dismantle';
update public.services set installer_hours = 12 where is_active and name ~* '(detail|polish)' and (bodyshop_kind is not null or name ~* 'ppf');
update public.services set installer_hours = 4  where is_active and name ~* '(sides|side).*(rear)' and name ~* '(tint|film|heat)';
update public.services set installer_hours = 2  where is_active and name ~* 'windshield' and name ~* '(film|tint|clear)';
update public.services set installer_hours = 2  where is_active and name ~* 'pano' and name ~* '(roof|tint|film)';
update public.services set installer_hours = 4  where is_active and name ~* 'ceramic' and name ~* 'ppf' and name !~* 'inter[io]or';
update public.services set installer_hours = 4  where is_active and name ~* 'ceramic' and name ~* '(inter[io]or|leather)';

-- The owner's fallback for other bodyshop services, editable in Settings > Packages.
insert into public.settings (key, value, label)
  values ('bodyshop_default_installer_hours', to_jsonb(8), 'Default installer hours for other bodyshop services')
  on conflict (key) do nothing;

-- Our own bodyshop services were marked Outside work: fix the services and every line that copied it.
update public.services set outside_work = false where bodyshop_kind is not null and outside_work;
set session_replication_role = replica;
update public.quotation_lines l set outside_work = false
  from public.services s where s.id = l.service_id and s.bodyshop_kind is not null and l.outside_work;
-- Open quotations pick up the default hours at once (approved ones read real clockings instead).
update public.quotation_lines l set installer_hours = s.installer_hours
  from public.services s, public.quotations q
  where s.id = l.service_id and q.id = l.quotation_id and l.is_active and l.installer_hours is null
    and s.installer_hours is not null and q.status in ('draft', 'sent', 'opened');
set session_replication_role = default;

notify pgrst, 'reload schema';
