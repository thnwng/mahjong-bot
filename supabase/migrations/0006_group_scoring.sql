-- 0006: per-group tai scoring.
--
-- A group's winning-hand tai values (what each scoring hand is worth for THIS
-- table) move from client-side localStorage onto the group itself, so every
-- member shares one config. Stored as a jsonb map { handId: value } on the
-- tracker; NULL means the group uses the app's built-in defaults. Written only
-- by the track function's member-gated "set-tai" op. No backfill needed — every
-- existing group simply starts NULL (defaults) until someone edits its scoring.

alter table trackers add column if not exists tai_scores jsonb;
