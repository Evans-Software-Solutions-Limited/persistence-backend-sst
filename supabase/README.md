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

## Single-Supabase reality (current — free tier)

This project runs on **one** Supabase project, shared between staging and production. Both GitHub environments (`staging`, `Production`) carry identical `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` values — the per-environment scoping is for permission / approval gating, not for routing.

**What this means in practice:**

- **Migrations land at staging-deploy time.** Push to `main` → `deploy-staging.yml` runs → `supabase db push --linked` applies the new migration to the shared DB. The next release publish triggers `production-deploy.yml` → `supabase db push --linked` is a **no-op** because the migration is already recorded in the shared DB's `supabase_migrations.schema_migrations` table.
- **Production code deploys against an already-migrated DB.** Ordering is correct, just not the way "two-environment" usually implies.
- **A bad migration affects both stages immediately.** No DB isolation. The dry-run + idempotent + additive-only authoring rules are the only safety net. Treat every migration like a production change.

### Upgrade path (two-project topology)

When the project moves off the free tier:

1. Provision a second Supabase project (`persistence-prod` or similar).
2. Apply the legacy seeds + run all current migrations against it once (`supabase db push --linked` against the new project).
3. Update the `Production` GitHub environment's `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, and `DATABASE_URL` to point at the new project.

The next `production-deploy.yml` run picks the new values up automatically — its `Set SST secrets` step writes the production-stage `PersistenceDatabaseUrl` slot from `secrets.DATABASE_URL` before deploy. After that, migrations land first on staging (via `deploy-staging.yml`), are validated, then re-apply to production on the next release publish (independent DB, independent tracking table). The workflow code doesn't change — only the per-environment GH secret values diverge.

## Required GitHub secrets

Per environment (`staging`, `Production`):

| Secret name            | Where to find it                                                                                                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_PROJECT_REF` | Supabase Dashboard → Project Settings → General → Reference ID                                                                 | Same value in both envs while on a single project. Diverges per env once each has its own project.                                                                                                                                                                                                                                                                                                                                             |
| `SUPABASE_DB_PASSWORD` | Supabase Dashboard → Project Settings → Database → Connection string password                                                  | Same value in both envs while on a single project.                                                                                                                                                                                                                                                                                                                                                                                             |
| `DATABASE_URL`         | Supabase Dashboard → Project Settings → Database → **Connection pooling** tab → Transaction mode (port 6543) connection string | The runtime URL the Lambda uses. **Must be the transaction-mode pooler** (`aws-1-<region>.pooler.supabase.com:6543`), NOT the direct connection (`db.<ref>.supabase.co:5432`) — Lambda needs the pooler for connection multiplexing across cold starts. CI runs `sst secret set PersistenceDatabaseUrl "$DATABASE_URL" --stage <stage>` before each deploy, so this GH secret is the source of truth for the deployed Lambda's `DATABASE_URL`. |

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
gh secret set DATABASE_URL          --env staging
gh secret set SUPABASE_PROJECT_REF  --env Production
gh secret set SUPABASE_DB_PASSWORD  --env Production
gh secret set DATABASE_URL          --env Production
```

### Why CI sets the SST secret (not just `sst secret set` from a dev machine)

`sst secret set Foo <value>` writes to AWS SSM Parameter Store under a stage-scoped key. Running it locally only updates the stage your local CLI is pointed at — typically the developer's personal stage (e.g. `dev`). The deployed `staging` and `production` Lambdas read from their own stage-scoped slots, which a developer's `sst secret set` never touches. That gap caused the 2026-05-04 staging dashboard outage: the developer's `PersistenceDatabaseUrl` was correct, but the staging-stage slot was either empty or stale, so the Lambda couldn't reach the DB.

The deploy workflows now run `sst secret set PersistenceDatabaseUrl "$DATABASE_URL" --stage <stage>` before `sst deploy`. Effects:

- **CI is the source of truth.** Every deploy re-applies the value, so manual `sst secret set` from any machine is overwritten on the next CI run. Drift between developer machines and the deployed Lambda becomes impossible.
- **Fail-fast on missing secret.** If the GH environment secret is unset, the deploy step exits with a clear error before `sst deploy` runs — no more silent `DATABASE_URL=""` injection.
- **One source of truth per env.** Rotating the password is "update the GH secret + re-run the workflow" — no `sst secret set` from any developer machine needed.

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
