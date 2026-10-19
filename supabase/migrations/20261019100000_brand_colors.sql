-- Brand refresh: replace the green default label colour with the brand deep blue,
-- and move existing labels off the old green/teal swatches.

alter table public.labels alter column color set default '#262f82';
update public.labels set color = '#262f82' where lower(color) = '#4d7c5a';
update public.labels set color = '#cc66ff' where lower(color) = '#0f766e';
