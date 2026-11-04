-- RESEND THE VEHICLE CHECK-IN LINK (queue of 4 November 2026): the WhatsApp message for a link resent
-- AFTER approval (the read-only copy - no approval asked). A missing settings row silently drops edits
-- (23 October lesson), so the row is seeded here; the code falls back to the built-in wording until then.

insert into public.settings (key, value, label)
values ('whatsapp_checkin_copy_template', to_jsonb('Dear [name],

Your vehicle check-in for the *[make model]* ([plate]) is here:
[link]

It shows the photos, the videos and everything agreed when the car came in.

OFJ Automotive'::text), 'WhatsApp message: check-in link resent after approval (read-only copy)')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
