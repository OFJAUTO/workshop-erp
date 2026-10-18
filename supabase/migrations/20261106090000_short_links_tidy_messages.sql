-- 18 October 2026, 2: short links (erp.ofjauto.com/m/xxxx) and the tidy WhatsApp messages.

-- One row per address we shorten; /m/<code> (and /d/<code> for the driver's page) redirect to it.
create table if not exists public.short_links (
  code text primary key,
  url text not null unique,
  kind text not null default 'page' check (kind in ('map', 'page', 'drive')),
  hits integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.short_links enable row level security;
-- No policies: only the server (service role) reads and writes these.

-- Every message template rewritten in the tidy style: short sections, line breaks, WhatsApp bold (*text*),
-- no staff names, signed OFJ Automotive. The owner can still edit each one in Settings.
insert into public.settings (key, value, label, description) values
  ('whatsapp_quote_template', to_jsonb($t$Dear [name],

Your quotation for the *[make model]* ([plate]) is ready:
[link]

Any questions, just reply here.

OFJ Automotive$t$::text), 'WhatsApp quotation message', 'Sent with the quotation link.'),
  ('whatsapp_quote_revised_template', to_jsonb($t$Dear [name],

Your quotation for the *[make model]* ([plate]) has been updated:
[link]

Any questions, just reply here.

OFJ Automotive$t$::text), 'WhatsApp revised quotation message', 'Sent with the updated quotation link.'),
  ('whatsapp_estimate_template', to_jsonb($t$Dear [name],

Our estimate for the *[make model]* ([plate]) is here:
[link]

The final price is confirmed once the car is with us.

OFJ Automotive$t$::text), 'WhatsApp estimate message', 'Sent with the estimate link.'),
  ('whatsapp_report_template', to_jsonb($t$Dear [name],

The inspection of your *[make model]* ([plate]) is complete.

The report is here:
[link]

OFJ Automotive$t$::text), 'WhatsApp inspection report message', 'Sent with the report link.'),
  ('whatsapp_approval_template', to_jsonb($t$Dear [name],

Your *[make model]* ([plate]) has been received at OFJ Automotive.

Please review the check-in and approve the inspection:
[link]

OFJ Automotive$t$::text), 'WhatsApp approval message', 'Sent with the check-in approval link.'),
  ('whatsapp_ready_template', to_jsonb($t$Dear [name],

Your *[make model]* ([plate]) is ready.

The proforma and the amount due are here:
[link]

Once payment is received, your car is ready to collect.

OFJ Automotive$t$::text), 'WhatsApp car ready message (proforma)', 'Sent with the proforma link; the bank details are added underneath.'),
  ('whatsapp_invoice_template', to_jsonb($t$Dear [name],

Thank you for your payment.

The tax invoice for your *[make model]* ([plate]) is here:
[link]

OFJ Automotive$t$::text), 'WhatsApp tax invoice message', 'Sent with the tax invoice link once the proforma is paid.'),
  ('whatsapp_deposit_receipt_template', to_jsonb($t$Dear [name],

Thank you for your deposit of *AED [amount]* for the *[make model]* ([plate]).

Your receipt is here:
[link]

OFJ Automotive$t$::text), 'WhatsApp deposit receipt message', 'Sent with the deposit receipt link.'),
  ('whatsapp_followup_template', to_jsonb($t$Dear [name],

Thank you for choosing OFJ Automotive for your *[make model]* ([plate]). We hope everything is running well.

If anything needs our attention, please let us know.

OFJ Automotive$t$::text), 'WhatsApp follow-up message', 'The follow-up call message a few days after gate-out.'),
  ('whatsapp_reminder_template', to_jsonb($t$Dear [name],

A reminder of your appointment at OFJ Automotive tomorrow:
*[date] at [time]*
For: [reason]

Please reply to confirm.

OFJ Automotive$t$::text), 'WhatsApp appointment reminder', 'The evening-before reminder for a customer visit.'),
  ('whatsapp_reminder_car_drop', to_jsonb($t$Dear [name],

A reminder that your *[car]* is booked to be dropped at OFJ Automotive tomorrow:
*[date] at [time]*
For: [reason]

Please reply to confirm.

OFJ Automotive$t$::text), 'WhatsApp reminder: car drop', 'The evening-before reminder when the customer drops the car.'),
  ('whatsapp_reminder_we_collect', to_jsonb($t$Dear [name],

A reminder that OFJ Automotive will collect your *[car]* tomorrow:
*[date] at [time]*
From: [address]
For: [reason]

Please have the keys ready.

OFJ Automotive$t$::text), 'WhatsApp reminder: we collect', 'The evening-before reminder when we collect the car.'),
  ('whatsapp_reminder_customer_collects', to_jsonb($t$Dear [name],

Your *[car]* is ready for collection at OFJ Automotive tomorrow:
*[date] at [time]*

OFJ Automotive$t$::text), 'WhatsApp reminder: customer collects', 'The evening-before reminder when the customer collects the car.'),
  ('whatsapp_final_check_template', to_jsonb($t$Dear [name],

A reminder of the final check of your *[make model]* ([plate]) at OFJ Automotive tomorrow:
*[date] at [time]*

OFJ Automotive$t$::text), 'WhatsApp final check reminder', 'The reminder for the bodyshop final check visit.'),
  ('whatsapp_bodyshop_arrived_template', to_jsonb($t$Dear [name],

Your *[make model]* ([plate]) has arrived at OFJ Automotive and is in good hands.

Follow the progress here:
[link]

OFJ Automotive$t$::text), 'WhatsApp: your car has arrived', 'The bodyshop arrival message with the progress link.'),
  ('whatsapp_bodyshop_film_template', to_jsonb($t$Dear [name],

Film is going on your *[make model]* ([plate]).

See the progress here:
[link]

OFJ Automotive$t$::text), 'WhatsApp: film is going on', 'The bodyshop film message with the progress link.'),
  ('whatsapp_bodyshop_ready_template', to_jsonb($t$Dear [name],

Your *[make model]* ([plate]) is ready for collection.

Your handover page, warranty and care instructions:
[link]

OFJ Automotive$t$::text), 'WhatsApp: ready for collection', 'The bodyshop handover message with the handover link.'),
  ('whatsapp_on_the_way_template', to_jsonb($t$Dear [name],

Your *[car]* is on its way to you.

*Recovery truck:* [truck plate]
*Driver:* [driver name], [driver mobile]

For anything else, call OFJ Automotive on +971 4 330 3113.$t$::text), 'WhatsApp "on its way" (delivery by recovery)', 'Sent to the customer when the car is loaded on the recovery truck.')
on conflict (key) do update set value = excluded.value, label = excluded.label, description = excluded.description;
