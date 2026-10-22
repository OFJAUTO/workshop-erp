-- Overnight batch 22 to 23 October 2026, section 5: the workshop dictionary for the pre-send spelling check
-- (Settings > Workshop dictionary). Car words, makes and models and the known words are accepted already.
insert into public.settings (key, label, value) values ('spell_words', 'Workshop dictionary (spell check)', '[]'::jsonb)
on conflict (key) do nothing;
