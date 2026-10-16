-- 16 October 2026: scan reports are read straight from the Google Workspace mailbox (scans@ofjauto.com) every few
-- minutes. Each Gmail message is processed once; the last check is shown on the Scan reports page.
alter table public.inbound_scans add column if not exists gmail_message_id text;
alter table public.inbound_emails add column if not exists gmail_message_id text;
create index if not exists inbound_scans_gmail_message_idx on public.inbound_scans (gmail_message_id);
create index if not exists inbound_emails_gmail_message_idx on public.inbound_emails (gmail_message_id);

insert into public.settings (key, value, label, description) values
  ('scans_mailbox_last_check', '{}'::jsonb, 'Scan mailbox: last check', 'When the mailbox was last read and what came in (written by the system).')
on conflict (key) do nothing;
