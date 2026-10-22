-- Evening batch of 21 October 2026, section 11: the tint specification per window.
-- Kept on the quotation (it travels with versions and with the approval); the approved-quote lock does
-- not list it, so the advisor or the owner can still change it until the tint stage starts - every such
-- change is logged old → new by the server action. When a window is darker than the owner's legal limit
-- the customer ticks "customer's request" on the quotation link (who and when kept, like the film removal).
-- No new table: no RLS or grant changes needed.

alter table public.quotations add column if not exists tint_spec jsonb;
alter table public.quotations add column if not exists tint_ack_at timestamptz;
alter table public.quotations add column if not exists tint_ack_name text;

insert into public.settings (key, label, value) values
  ('tint_legal_max_darkness', 'Tint: legal limit (darkness %, darker needs the customer''s request)', to_jsonb(50)),
  ('tint_double_layer_hours', 'Tint: extra installer hours per double-layer window', to_jsonb(1)),
  ('tint_presets', 'Tint: one-tap presets', '[{"name":"Standard","spec":{"rows":{"windshield":{"on":true,"coverage":"clear","shade":"clear","double":false},"front_sides":{"on":true,"shade":50,"double":false},"rear_sides":{"on":true,"shade":50,"double":false},"rear_window":{"on":true,"shade":50,"double":false},"roof":{"on":true,"shade":50,"double":false}},"roofFitted":true}}]'::jsonb),
  ('whatsapp_tint_update_template', 'WhatsApp: updated tint choice', to_jsonb('Hello [name], here is the updated tint choice for your [make model] ([plate]): [tint]. If anything should be different, just reply to this message. OFJ Automotive'::text))
on conflict (key) do nothing;

notify pgrst, 'reload schema';
