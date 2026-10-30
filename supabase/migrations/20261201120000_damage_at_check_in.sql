-- Damage already on the car (30 October 2026, night batch section 4).
--
-- gate_ins.damage_after: damage found AFTER check-in (a mark under the dirt, a chip seen on the lift), kept apart from
--   what the car came in with: [{ id, panel, damage[], severity, note, at, by, by_name, sent_at }]. Its photos are
--   gate_in_media rows of kind damage_photo with the caption "after:<id>"; the check-in photos of one panel carry
--   "panel:<key>" (both kinds are shown in the customer's "Damage already on the car" section, never as loose photos).
-- approval_requests.damage_snapshot: what the customer confirmed when approving - the marks, the photo ids and the
--   time - so a later change to the gate-in never changes what was agreed.
-- settings.whatsapp_damage_found_template: the message telling the customer about damage found after check-in.
-- gate_ins has column-level select grants for the login role (customer privacy, 29 October): the new column gets its own.
alter table public.gate_ins add column if not exists damage_after jsonb not null default '[]'::jsonb;
grant select (damage_after) on public.gate_ins to authenticated;

alter table public.approval_requests add column if not exists damage_snapshot jsonb;

insert into public.settings (key, label, value)
values ('whatsapp_damage_found_template', 'WhatsApp: damage found after check-in', to_jsonb(E'Dear [name],

While working on your *[make model]* ([plate]) we found damage that could not be seen when the car arrived:
[damage]

The photos are on your job card:
[link]

OFJ Automotive'::text))
on conflict (key) do nothing;

comment on column public.gate_ins.damage_after is 'Damage found after check-in (30 Oct 2026): list of {id, panel, damage, severity, note, at, by, by_name, sent_at}.';
comment on column public.approval_requests.damage_snapshot is 'The damage the customer confirmed at approval (30 Oct 2026): {marks, photos, at}.';
notify pgrst, 'reload schema';
