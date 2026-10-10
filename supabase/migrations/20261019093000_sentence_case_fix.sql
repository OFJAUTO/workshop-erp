-- Sentence case: the letter after a full stop is capitalised too (the first version only did the first letter).
create or replace function public.erp_sentence_case(t text) returns text language plpgsql stable as $$
declare
  letters text;
  out text;
  piece text;
  pieces text[] := '{}';
begin
  if t is null then return null; end if;
  out := btrim(t);
  if out = '' then return out; end if;
  letters := regexp_replace(out, '[^[:alpha:]]', '', 'g');
  if letters <> '' and (letters = upper(letters) or letters = lower(letters)) then
    -- Lower everything except words with digits or symbols inside (part numbers, sizes).
    out := (select string_agg(case when x ~ '[0-9/\-]' then x else lower(x) end, ' ') from regexp_split_to_table(out, ' ') x);
  end if;
  -- Capitalise the first letter of every sentence.
  for piece in select x from regexp_split_to_table(out, '(?<=[.!?])\s+') x loop
    pieces := pieces || (upper(substr(piece, 1, 1)) || substr(piece, 2));
  end loop;
  out := array_to_string(pieces, ' ');
  return public.erp_apply_known(out);
end $$;
