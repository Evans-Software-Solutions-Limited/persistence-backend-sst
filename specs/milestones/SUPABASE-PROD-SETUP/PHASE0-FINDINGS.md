# Supabase Prod Setup — Phase 0 Audit (findings)

_Produced 2026-07-14. Read-only audit; nothing was changed. Contains **no secrets** —
project refs and the Supabase project URL are public-by-design (see
`domain-config.ts` comments). Do not add passwords, service-role keys, or pooler
connection strings to this file — those live only in GitHub Environment secrets +
SST Secret bindings._

## TL;DR

The whole app runs on **one free-tier Supabase project** (`persistence` /
`dfeyebgdktfteqlacmru`, org `yeasty-apricot-zahshtf`, region `eu-west-2`, PG 17).
Both the `staging` and `production` SST stages resolve to it. The goal is to stand
up two isolated projects and cut each stage over to its own.

The good news from the audit: **the split is almost entirely a matter of
populating different per-environment secret values + one hardcoded-URL code edit.**
No workflow logic, `sst.config.ts`, or `infra/secrets.ts` change is needed.

## Facts verified against repo + live project

### Live project state (`dfeyebgdktfteqlacmru`)
- Region `eu-west-2` (London), Postgres 17, `ACTIVE_HEALTHY`.
- **63 migrations already applied** (`001_initial_schema` → `20260714120000_foods_serving_quantity`).
- Data present:
  - `auth.users`: **4** (test accounts only — effectively **no real user data**).
  - `foods`: **142,972** — `serving_quantity` populated on **0** of them (the pending re-seed follow-up is real).
  - `exercises`: 2,281 · `equipment_types`: 28 · `subscription_tiers`: 5.
- ⇒ Because there is no real production data, **two fresh projects + retire the free
  one** is clean: reference data reseeds from scripts/migrations; the 4 test users
  are disposable.

### Data-exposure posture (Phase 2 relevance) — **brief was wrong here**
- The brief says "RLS is OFF." It is **not**: **59 of 60** public tables have RLS
  **enabled** (the repo migrated *toward* RLS — `20260626104105_enable_rls_missing_tables`, etc.).
- **But** `anon` and `authenticated` still hold **full CRUD grants** on all 63 tables,
  and **`revenuecat_webhook_events` has RLS fully disabled** → directly
  readable/writable via the public anon key **iff the Data API (PostgREST) is on**.
- A few `{public}`-role policies exist (`program_assignments`, `program_workouts`)
  whose safety rests entirely on their `auth.uid()` USING-clauses — i.e. on RLS-policy
  correctness.
- **Clients never call PostgREST** (they use Supabase only for Auth; all data flows
  through the SST API on the pooled connection string). ⇒ The clean, low-risk P0
  hardening is to **disable the Data API / remove `public` from the exposed schemas**,
  which closes the exposure regardless of RLS-policy correctness. RLS-off stays
  intentional; do not reflexively "enable RLS" because `get_advisors` complains.

### Cutover wiring (Phase 4 relevance)
- **DB client** `packages/db/src/client.ts`: postgres.js, `prepare:false`, `max:1`;
  reads SST Secret `PersistenceDatabaseUrl` → Lambda env `DATABASE_URL`
  (`infra/api.ts:67`), falling back to `process.env.DATABASE_URL`. Already
  Lambda-correct; prod just needs its **own** transaction-pooler string (port 6543).
- **Auth/JWKS** `packages/api-utils/src/auth/supabaseAuth.ts`: builds
  `createRemoteJWKSet(${SUPABASE_URL}/auth/v1/.well-known/jwks.json)` from
  `process.env.SUPABASE_URL`. **Prod must point at the prod project URL or auth
  breaks (wrong JWKS).**
- ⚠️ **`SUPABASE_URL` is NOT a GitHub secret.** It is **hardcoded per stage** in
  `packages/api-utils/src/domains/domain-config.ts:68-71`:
  ```ts
  const SUPABASE_URLS = {
    production: "https://dfeyebgdktfteqlacmru.supabase.co",   // ← must change to prod project
    staging:    "https://dfeyebgdktfteqlacmru.supabase.co",   // ← change if staging becomes a new project
  };
  ```
  baked into the Lambda at build time via `infra/domains/index.ts` → `infra/api.ts:68`.
  There is a test asserting it: `domain-config.test.ts:84,94`. **Phase 4's "update
  `infra/domains`" is really a code edit to `domain-config.ts` + that test** (public
  URL, safe to commit).
- ⚠️ **Mobile hardcodes the URL + anon key too** — not in the brief:
  `packages/mobile/eas.json` (both build profiles, ~L15 dev/preview + ~L35 prod) and
  `packages/mobile/.env.example:14` set `EXPO_PUBLIC_SUPABASE_URL` (and the anon key).
  The **prod build profile must point at the prod project** or the shipped app
  authenticates against staging.

### SST Secrets (all in `infra/secrets.ts`, consumed via `.value` in `infra/api.ts`)
`PersistenceDatabaseUrl`, `StripeSecretKey`, `StripeWebhookSecret`,
`RevenueCatWebhookSecret`, `RevenueCatApiKey`, `RevenueCatProjectId`,
`ExpoAccessToken`, `SupabaseServiceRoleKey`. `SUPABASE_URL` + the `AI_*` values are
plain env, not secrets. `sst.config.ts` gives **production** `removal:"retain"` +
`protect:true`.

### CI/CD (already exists — we harden/populate, not create)
- `deploy-staging.yml`: push→`main`, `environment: staging`. `supabase link
  --project-ref ${{secrets.SUPABASE_PROJECT_REF}}` → dry-run `db push` → real
  `db push` → `sst secret set … --stage staging` → `sst deploy --stage staging`.
  **Auto-applies migrations to staging on every merge to main.**
- `production-deploy.yml`: GitHub release published / manual `workflow_dispatch`,
  `environment: Production`. Same shape, gated. Comment L104-106 confirms prod
  `DATABASE_URL` **currently equals staging's** — divergence is the point of this task.
- GitHub Environment secrets read by both (per-environment, so they can already
  diverge): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`,
  `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `REVENUECATAPIKEY`, `REVENUECATPROJECTID`,
  `REVENUECATWEBHOOKSECRET`, `EXPO_ACCESS_TOKEN`; vars `AWS_REGION`; secret
  `AWS_ROLE_ARN_STAGING` / `AWS_ROLE_ARN_PRODUCTION`.
  ⚠️ RevenueCat GitHub secret names have **no underscores**
  (`REVENUECATAPIKEY`) though the SST names do (`RevenueCatApiKey`).

### Seeds / reference data (Phase 3 relevance)
- **Via migrations** (auto-applied by `db push`): `subscription_tiers`
  (`004`, re-seeded `20260526120000`), `goal_types` + `muscle_categories` +
  `muscle_group_categories` (`005`), `achievements` (`20260607120200`),
  `subscription_price_history` (`008`).
- **Via `packages/seed/src/seedExercises.ts`** (`DATABASE_URL='<pooled>' bun run
  seed:exercises`): `muscle_groups`, `equipment_types`, `accessibility_tags`
  (from `data/reference.json`), then the **exercise catalogue** (`data/exercises.json`,
  ~2.3k). Idempotent (`ON CONFLICT DO NOTHING` / name→UUID resolution).
- **OFF foods (~146k UK)** via `packages/seed/src/seedFoods.sh` →
  `microservices/core/src/scripts/seedOpenFoodFacts.ts` (`DATABASE_URL=…`). Runs off
  the **committed** `packages/seed/data/off-uk.jsonl.gz` — **no HuggingFace/DuckDB
  download needed** unless refreshing (`refreshOffDump.sh` regenerates that gz from a
  ~7.6 GB Parquet dump; it does NOT touch the DB).
  - `seedOpenFoodFacts.ts` **does map `serving_quantity`** (`offMapper.ts:90,102` →
    `foodRepository` upsert → `schema.ts` `serving_quantity` column). **OPEN QUESTION
    for Phase 3:** verify the committed `off-uk.jsonl.gz` actually carries the
    `serving_quantity` field, or a fresh seed will land NULL again (matches why the
    live DB is 100% NULL — the current data predates the column or the dump lacks it).
    If the committed gz lacks it, run `refreshOffDump.sh` first so prod seeds with
    `serving_quantity` populated from the start.

### Hardcoded project-ref/URL literals to change at cutover
Only load-bearing spots: `domain-config.ts:69-70` (+ test `:84,94`),
`packages/mobile/eas.json` (prod profile), `packages/mobile/.env.example`. Everything
else (`client.ts`, workflow error messages, `config.toml`) is doc/format hints or
test fixtures.

## What can be automated vs. Brad-gated
- **Brad-gated (billing / dashboard / irreversible):** create/upgrade projects, plan
  + PITR add-on, compute size, custom SMTP, provider (Apple/Google) config, network
  restrictions, key rotation. These cost money or touch account settings.
- **Claude-automatable once projects exist:** disable Data API via SQL/config,
  `db push` migrations, run seeds, the `domain-config.ts`/`eas.json` code edits, the
  runbook, STATE.md.
