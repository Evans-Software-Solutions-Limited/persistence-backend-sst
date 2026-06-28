# @persistence/seed

Reproducible seed data for the gym app, so the DB can be rebuilt from the repo
instead of relying on what happens to be in prod. Two independent seeds:

| Seed          | Source of truth                          | Rows   | Command                  |
| ------------- | ---------------------------------------- | ------ | ------------------------ |
| **Exercises** | `data/exercises.json` + `reference.json` | ~2,281 | `bun run seed:exercises` |
| **Foods**     | `data/off-uk.jsonl.gz` (Open Food Facts) | ~146k  | `bun run seed:foods`     |

Run both: `bun run seed`. (All commands also work from the repo root via the
`seed` / `seed:exercises` / `seed:foods` scripts.)

## Prerequisites

- `bun install` at the repo root.
- `DATABASE_URL` = the Supabase **pooled** prod URI (port 6543). Never commit it.
  ```bash
  export DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres'
  ```

Both seeds are **idempotent**: re-running inserts only what's missing (exercises
are matched by name for the system user; foods upsert on barcode). Safe to re-run;
intended to be run against a fresh / reset DB.

## Exercises (`seed:exercises`)

Ported from the legacy Supabase repo's `supabase/seed.sql` + `seed_exercises.sql`.
`data/*.json` stores muscle/equipment/accessibility links as **names**, not UUIDs,
so it is DB-agnostic; `src/seedExercises.ts` resolves them to per-DB ids at seed
time. Names with no matching reference row are dropped (the legacy SQL did the same
— those were no-ops in prod too).

FK order handled by the runner: `exercises.created_by → profiles.id → auth.users.id`.
It first ensures a **system user** exists (`auth.users` + `profiles`, id
`00000000-0000-0000-0000-000000000000` — the load-bearing `SYSTEM_USER_ID` the
backend uses to mark the stock catalogue), then upserts reference data, then the
catalogue.

> Note: on a brand-new local Supabase stack, writing the `auth.users` system row
> may be restricted. The runner attempts it best-effort and continues; if the
> system profile still can't be created, the exercise insert will fail with a clear
> FK error — create the auth user first (e.g. via Supabase Studio).

## Foods (`seed:foods`)

Curated UK subset of [Open Food Facts](https://world.openfoodfacts.org/), filtered
to products with complete macros and deduped by barcode. Committed gzipped at
`data/off-uk.jsonl.gz`. `src/seedFoods.sh` decompresses it and runs the tested
`microservices/core/src/scripts/seedOpenFoodFacts.ts` loader.

**ODbL:** this dataset is licensed under the Open Database License — see
`data/ATTRIBUTION-openfoodfacts.md`. Keep attribution on any redistribution.

### Refreshing the foods dataset

`bun run refresh:foods` (`src/refreshOffDump.sh`) downloads the current OFF parquet
(~7.6 GB; needs `duckdb` + ~10 GB free disk), re-filters, and rewrites
`data/off-uk.jsonl.gz`. Commit the updated file, then `bun run seed:foods`.
