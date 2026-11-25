-- Rollback for 20261125101829_coach_resources.sql (PER-122).
--
-- ⚠ Roll back the core deploy FIRST: the resource routes, the `resource`
-- set-up section and coaching offboarding read these tables. Dropping them
-- loses every coach's resource library and every assignment. The uploaded
-- files stay in the CoachPrivateMedia bucket (and their private_media rows).
DROP TABLE IF EXISTS coach_resource_assignments;
DROP TABLE IF EXISTS coach_resources;
