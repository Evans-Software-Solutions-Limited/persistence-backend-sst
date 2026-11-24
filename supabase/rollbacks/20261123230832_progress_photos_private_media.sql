-- Rollback for 20261123230832_progress_photos_private_media.sql (PER-121).
--
-- ⚠ Roll back the core deploy FIRST: the progress-photo and media routes, the
-- form photo answers and the account purge read these tables. Dropping them
-- loses every progress photo set and private upload record. The objects stay
-- in the CoachPrivateMedia bucket; empty it by hand (or remove the bucket)
-- if the rollback is permanent.
DROP TABLE IF EXISTS private_media_purges;
DROP TABLE IF EXISTS private_media;
DROP TABLE IF EXISTS progress_photos;
DROP TABLE IF EXISTS progress_photo_sets;
