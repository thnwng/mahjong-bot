-- 0003: display names are no longer globally unique. The 'username' concept is
-- now just a display-name label (relabeled in the UI; the DB column stays
-- `username`). Drop the case-insensitive unique index so two people can share a
-- name. Run in the SQL editor BEFORE deploying the matching track function.
drop index if exists profiles_username_lc_key;
