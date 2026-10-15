-- Labour estimates typed as the hourly rate (or otherwise not hours) go back to the quoted hours. Found on Q-00004 on
-- 15 October 2026: the "est." box held 350, the rate, so labour at cost read 1,400 hours. Safe to run again.
update public.quotation_lines
set hours_estimate = hours
where line_type = 'labour' and is_active and hours_estimate is not null
  and (hours_estimate = labour_rate or hours_estimate > 50 or (hours is not null and hours > 0 and hours_estimate > 3 * hours));
