# Supabase

This directory holds the **DB schema as code** for the Persistence backend. It mirrors the standard Supabase CLI layout so the same migrations work locally (`supabase start` against a Dockerised Postgres) and remotely (CI applies them via `supabase db push`).

The application's runtime view of the schema is `packages/db/src/schema.ts` (Drizzle). The two must stay in lockstep — `schema.ts` is the application's typed surface; `supabase/migrations/` is the operator-applied DDL that produces the actual tables.

## What's here

```
supabase/
├── config.toml             # Local-dev defaults for `supabase start` (project_id = "persistence")
├── migrations/             # Sequential SQL migrations applied by CI to staging + production
└── .gitignore              # `.branches`, `.temp`, dotenvx env files
```

Everything else from the legacy [persistence-backend](../../persistence-backend/) repo (Edge Functions, pgTAP tests, `seed.sql`, `seed_exercises.sql`) is **not** mirrored here — those concerns are being rewritten as Elysia handlers in `microservices/core/` (functions) or are ops-time bootstrap (seeds). If the cutover later needs them, lift them across in a dedicated PR.

## Migration filename convention

`YYYYMMDDHHMMSS_short_snake_case_name.sql` — UTC timestamp, lexicographically sortable, strictly increasing. Earlier legacy migrations use the shorter `001_…` / `002_…` prefix; both forms are honored by the Supabase CLI's tracking, but **all new migrations must use the timestamp form**.

Generate a timestamp:

```bash
date -u "+%Y%m%d%H%M%S"
```

## Authoring rules

1. Every migration is **idempotent**: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `DROP … IF EXISTS`. A re-run must be a no-op.
2. Wrap multi-statement migrations in a single transaction unless the operation is non-transactional (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE … ADD VALUE`, etc).
3. Backfill any new `NOT NULL` columns with sensible defaults so legacy rows don't break.
4. Update `packages/db/src/schema.ts` in the **same commit** as the migration. The PR title should mention both surfaces.
5. Reference the spec section the change implements in the file's leading comment block.

## Local development

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). Then from the repo root:

```bash
# Start a local Supabase stack (Postgres on :54322, Studio on :54323).
supabase start

# Apply pending migrations to the local DB.
supabase migration up

# Reset local DB and re-run all migrations from scratch.
supabase db reset
```

The local stack picks up `supabase/config.toml` automatically — no extra flags needed.

## Authoring a new migration locally

```bash
# 1. Create a new migration file with the right timestamp.
supabase migration new short_snake_case_name

# 2. Edit the generated file under supabase/migrations/.

# 3. Apply it locally to verify.
supabase db reset

# 4. Update packages/db/src/schema.ts to mirror the change.
bun run typecheck

# 5. Commit both files together.
```

## CI/CD: how migrations get applied to remote environments

Migrations are applied as the **first step** of the corresponding SST deploy workflow:

| Trigger                                          | Workflow                                                              | Target environment |
| ------------------------------------------------ | --------------------------------------------------------------------- | ------------------ |
| Push to `main`                                   | [`deploy-staging.yml`](../.github/workflows/deploy-staging.yml)       | `staging`          |
| Manual dispatch on `deploy-staging.yml`          | same                                                                  | `staging`          |
| Release publish or manual on `production-deploy` | [`production-deploy.yml`](../.github/workflows/production-deploy.yml) | `Production`       |

Each workflow:

1. Installs the Supabase CLI (`supabase/setup-cli@v1`).
2. Runs `supabase db push --linked --dry-run` — fails the build if the dry-run errors (catches DDL syntax issues before any write hits the DB).
3. Runs `supabase db push --linked` — applies pending migrations to the linked project. Migrations already recorded in `supabase_migrations.schema_migrations` on the remote are skipped automatically.
4. Continues to the SST deploy step. **Migrations land before the Lambda code that reads/writes them**, eliminating the column-doesn't-exist race.

A failure in step 2 or 3 aborts the workflow — the SST deploy never runs.

## Two-environment topology (one Supabase project per env)

The intended steady state is **two Supabase projects** — one per GitHub environment, one per stage:

| GitHub environment | Supabase project      | Purpose                                                                          |
| ------------------ | --------------------- | -------------------------------------------------------------------------------- |
| `staging`          | `persistence-staging` | DB for the staging-stage SST deployment. Schema changes land here first.         |
| `Production`       | `persistence-prod`    | DB for the production-stage SST deployment. Migrated when the release publishes. |

Each environment carries its own `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` GitHub secrets — the workflow's `environment:` directive routes them automatically. The runtime `DATABASE_URL` (held in SST's `PersistenceDatabaseUrl` secret per stage) likewise points to the matching project.

**Migration ordering, with isolation:**

1. PR lands on `main` → `deploy-staging.yml` runs → `supabase db push --linked` applies the new migration to **staging** → SST deploys staging code that reads/writes the new schema.
2. Validate on staging.
3. Cut a release → `production-deploy.yml` runs → `supabase db push --linked` applies the same migration to **production** (independent DB; the file is unchanged but the remote tracking table doesn't have it yet) → SST deploys production code.

The same migration file is applied to both projects in turn. Idempotent + additive-only authoring still matters — it's what keeps the production apply boring once staging has validated it.

### Transitional (free-tier) note

Until both projects exist, the same `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` are set in both GitHub environments. The workflow runs are then a no-op on the production side because the migration's already in the shared DB's `supabase_migrations.schema_migrations` table. When the second project is provisioned, point the `Production` environment's secrets at it — no workflow code changes.

## Required GitHub secrets

Per environment (`staging`, `Production`):

| Secret name            | Where to find it                                                              | Notes                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SUPABASE_PROJECT_REF` | Supabase Dashboard → Project Settings → General → Reference ID                | Per environment — staging and Production point at distinct Supabase projects. |
| `SUPABASE_DB_PASSWORD` | Supabase Dashboard → Project Settings → Database → Connection string password | Per environment, paired with the project ref above.                           |

Repo-level (account-scoped, shared across environments):

| Secret name             | Where to find it                                                                       | Notes                                                 |
| ----------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) | Personal access token; scope: full account (CLI auth) |

To set them:

```bash
# Repo-level (one secret, shared)
gh secret set SUPABASE_ACCESS_TOKEN

# Per-environment — distinct values per env in the two-project topology;
# same values temporarily while only one project exists (see § "Transitional (free-tier) note" above).
gh secret set SUPABASE_PROJECT_REF  --env staging
gh secret set SUPABASE_DB_PASSWORD  --env staging
gh secret set SUPABASE_PROJECT_REF  --env Production
gh secret set SUPABASE_DB_PASSWORD  --env Production
```

## Manual application (escape hatch)

If you need to apply migrations from a developer machine — for example, to a freshly-rotated environment or during a hotfix — link the project once:

```bash
export SUPABASE_ACCESS_TOKEN=...
supabase link --project-ref <ref> --password <db-password>
supabase db push --linked --dry-run   # always dry-run first
supabase db push --linked
```

Output of `db push` lists every migration it applied. Sanity-check it against your expectation before clearing the terminal.

## Rollback

Rollbacks happen by writing **forward** migrations that revert the change — never by editing or deleting an applied migration file. If `20260503000000_m3_session_lifecycle.sql` introduced a column that has to come back out, write `20260504120000_revert_m3_session_lifecycle.sql` with `DROP COLUMN IF EXISTS …`. Mutating an applied file would diverge the local schema-migrations table from production's and break the next `db push`.
