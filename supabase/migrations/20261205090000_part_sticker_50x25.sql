-- Part stickers 50 x 25 mm (the owner, 4 November 2026): "our labels are 50 x 25 mm (width x height,
-- landscape). Set Printer 1 to 50 x 25 mm as the default." The stored part-sticker size moves to the
-- real label size; the sticker's new layout (QR left ~21 mm, logo, job number big, position, name bar)
-- is in the code and already follows whatever size is stored here.
update public.settings set value = to_jsonb('50'::text) where key = 'sticker_part_width_mm';
update public.settings set value = to_jsonb('25'::text) where key = 'sticker_part_height_mm';
