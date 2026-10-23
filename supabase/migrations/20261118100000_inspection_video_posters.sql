-- 23 October 2026: inspection videos reach the customer. A frame of each video is taken on the phone or tablet at
-- upload and stored next to it (same private bucket), so the report PDF can show the video's picture with a play
-- sign and a "Watch video" link to the customer's page. Older videos have none and show a dark card instead.
alter table public.inspection_media add column if not exists poster_path text;
