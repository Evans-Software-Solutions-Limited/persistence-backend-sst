# Supabase Staging + Production — Setup & Promotion Runbook

_Canonical, repeatable procedure for standing up and operating the two isolated
Supabase projects. **No secrets in this file** — refs and the project URL are
public-by-design; passwords, service-role keys, and pooler connection strings live
ONLY in GitHub Environment secrets + SST Secret bindings (repo is PUBLIC)._

See [`PHASE0-FINDINGS.md`](./PHASE0-FINDINGS.md) for the audit this is built on and
[`DECISIONS.md`](./DECISIONS.md) for the locked choices.

## Target end-state

| | Staging | Production |
|---|---|---|
| Project | `persistence-staging` (new) | `persistence-prod` (new) |
| Org | **existing free org** `yeasty-apricot-zahshtf` | **new org, upgraded to Pro** |
| Plan | Free | Pro (daily backups; **PITR dropped — cost**) |
| Compute | (free default) | **Micro** (Pro default) |
| Region | `eu-west-2` | `eu-west-2` (match the Lambda) |
| SST stage | `staging` | `production` |
| GitHub Environment | `staging` | `Production` |
| Old free project `dfeyebgdktfteqlacmru` | — | **retire only after prod cutover is proven** |

Because Supabase bills **per org** (one plan per org), Free-staging + Pro-prod
**must** be in separate orgs — that's why prod gets a new org.

---

## Phase 1 — Create the projects (Brad drives; billing/dashboard actions)

> Everything in this phase costs money or is an account action → **Brad does it in
> the dashboard.** Claude does not create projects/orgs via MCP.

### 1a. Staging project (Free, existing org)
1. Dashboard → org **`BradleyEvans96's Org`** → **New project**.
2. Name `persistence-staging`, region **West EU (London) `eu-west-2`**, generate a
   strong DB password (save it to your password manager — it's needed for the
   pooler string + `SUPABASE_DB_PASSWORD`).
3. Wait for provisioning.

### 1b. Production org + project (Pro + Small + PITR)
1. Dashboard → **New organization** (e.g. `persistence-prod-org`).
2. Upgrade that org to **Pro** ($25/mo).
3. **New project** in it: name `persistence-prod`, region **`eu-west-2`**, strong DB
   password (save it).
4. Project → **Settings → Compute and Disk** → set compute **Small** (required for PITR).
5. Project → **Settings → Add-ons → Point-in-Time Recovery** → enable, **7-day**.

### 1c. Capture per-project values (do NOT paste secrets into the repo)
For **each** project, from **Settings → Database** and **Settings → API**:
- **Project ref** (the `xxxx` in `xxxx.supabase.co`) — *non-secret*.
- **Project URL** `https://<ref>.supabase.co` — *non-secret* (goes in code, see Phase 4).
- **Transaction pooler** connection string (**port 6543**), shape:
  `postgresql://postgres.<ref>:<password>@aws-1-eu-west-2.pooler.supabase.com:6543/postgres`
  — this is the `DATABASE_URL` secret. **Secret.**
- **DB password** → `SUPABASE_DB_PASSWORD` secret. **Secret.**
- **service_role key** (Settings → API) → `SUPABASE_SERVICE_ROLE_KEY` secret. **Secret.**
- **anon / publishable key** (Settings → API) — *non-secret*; needed for the mobile
  build profiles (Phase 4).
- A **Supabase access token** (Account → Access Tokens) → `SUPABASE_ACCESS_TOKEN`
  secret (one token works for both if the account owns both orgs). **Secret.**

> **Use the transaction pooler (6543), not the session pooler (5432) and not the
> direct connection** — the Lambda client is `max:1, prepare:false`, which is exactly
> the transaction-pooler contract.

**Hand Claude the two non-secret refs** (`persistence-staging` ref +
`persistence-prod` ref) and the anon keys so it can do Phases 2-4 code + MCP work.
Put every **Secret** straight into GitHub (Phase 4) — never into chat or the repo.

---

## Phase 2 — Data-exposure hardening (P0, before real data)

Do this on **both** new projects. Clients use Supabase **only for Auth** and never
call PostgREST, so the Data API can be closed entirely.

1. **Disable the Data API** — Dashboard → **Settings → API → Data API** → set
   **Exposed schemas** to empty (remove `public`, `graphql_public`) **or** toggle the
   Data API off. This closes the anon/authenticated PostgREST surface regardless of
   RLS-policy correctness (see findings: `revenuecat_webhook_events` has RLS off, and
   some `{public}` policies rely on `auth.uid()` clauses).
   - ⚠️ The dashboard warns "client libraries need the Data API / supabase-js can't
     query". **Expected and fine here** — clients use Supabase **only for Auth**
     (`/auth/v1/*`, a SEPARATE endpoint the Data API toggle does not affect). Sign-in
     still works; all data goes through the SST API on the pooled connection.
   - RLS-off is not load-bearing here — **the closed Data API is what secures the
     data.** Don't treat "enable RLS" as the fix for a `get_advisors` complaint.
2. **Enable automatic RLS** (the dashboard's offered event trigger) — **yes, turn it
   on.** Safe defense-in-depth: the Lambda connects as the `postgres` role, which
   **owns** the tables and therefore **bypasses RLS**, so enabling RLS on tables never
   affects the backend (this is why the app already runs with RLS on 59/60 tables).
   With the Data API off it's just insurance against future accidental re-exposure,
   and it auto-closes the `revenuecat_webhook_events` RLS-off gap on fresh projects.
3. **Enforce SSL** — Settings → Database → **Enforce SSL on incoming connections** → on.
   (postgres.js + the pooler already use TLS; this makes it mandatory.) This + the
   closed Data API are the two settings that actually secure the data.
4. **Auth hardening** (Settings → Authentication — Auth is the ONLY public surface now):
   leaked-password protection ON, email confirmations required, OTP/magic-link expiry
   ≤ 1h, secure email change ON, keep/tighten auth rate limits, optional CAPTCHA
   (hCaptcha/Turnstile) if bot signups become a problem. (Redirect allow-list is Phase 5.)
5. **Network restrictions** (optional, prod) — ideally restrict Postgres ingress to the
   Lambda egress, but the Lambda has dynamic egress IPs without a VPC+NAT (it has
   neither today) → **document as deferred**; SSL-enforced + closed Data API + pooler is
   a solid posture without it.
6. **Rotate** any password/keys that were ever used on the shared free project — the
   new projects have fresh credentials, so this is automatically satisfied for
   staging/prod. Rotate the OLD project's keys too if it lingers before retirement.

_These are dashboard toggles (the MCP has no project-config lever); Claude can't set
them. RLS/grants could be scripted via a committed migration if ever needed, but the
dashboard Data API toggle is the recommended path._

---

## Phase 3 — Migrations + seed (staging first, then prod)

Migrations promote via the existing CI (`db push --linked`); seeds are manual
operational runs against the pooled `DATABASE_URL`.

### 3a. Migrations
- **Staging**: once the `staging` GitHub Environment secrets point at the new project
  (Phase 4), a push to `main` runs `db push` (dry-run then real) automatically. Or run
  locally: `SUPABASE_ACCESS_TOKEN=… supabase link --project-ref <staging-ref>
  --password <pw>` then `supabase db push --linked --dry-run` → `supabase db push
  --linked`. Confirm all **63** migrations apply in order.
- **Prod**: gated `production-deploy.yml` (release/manual) does the same dry-run→real
  `db push`. Keep it gated + manual — do not auto-migrate prod.

### 3b. Seeds (run once per project, after migrations)
**Preferred — CI dispatch** (uses the env's `DATABASE_URL` secret, no local pooled
string needed): GitHub → Actions → **Seed Database** → Run workflow → pick
`environment` (`staging` / `Production`) + `dataset` (`exercises` / `foods` / `both`).
Idempotent, so safe to re-run.

Or locally with the project's **transaction-pooler** `DATABASE_URL`:
```bash
# Exercise library + muscle_groups/equipment_types/accessibility_tags (idempotent)
DATABASE_URL='<pooled-conn-string>' bun run seed:exercises

# OFF UK foods (~146k). ⚠ See serving_quantity note below BEFORE running.
DATABASE_URL='<pooled-conn-string>' bun run seed:foods
```
Catalog data seeded **by migrations** (no script needed): `subscription_tiers`,
`goal_types`, `muscle_categories`, `achievements`, `subscription_price_history`.

**⚠ `serving_quantity` on the foods seed.** The committed
`packages/seed/data/off-uk.jsonl.gz` (Jun 28) predates the `serving_quantity`
feature and does **not** carry the field — seeding from it lands `serving_quantity`
NULL (exactly why the old project is 100% NULL). This runbook ships a fix to
`refreshOffDump.sh` + the seed header so a **regenerated** dump carries it. To seed
prod with it populated from day 1:
**CI:** GitHub → Actions → **Refresh OFF Foods Dump** → Run workflow. It regenerates
the gz and pushes a `chore/refresh-off-dump-*` branch for you to PR + merge. Then run
the foods seed. (Best-effort — see the workflow header caveats.)

**Local (reliable):**
```bash
brew install duckdb           # ~10 GB free disk for the ~7.6 GB dump
bun run --filter @persistence/seed refresh:foods   # regenerates off-uk.jsonl.gz WITH serving_quantity
# commit the regenerated packages/seed/data/off-uk.jsonl.gz, then:
DATABASE_URL='<prod-pooled>' bun run seed:foods
```
> ⚠ Claude could not run DuckDB in-sandbox — when you first run the refresh,
> confirm the OFF parquet exposes a top-level `serving_quantity` column (the query
> `TRY_CAST`s it, so a rename/absence yields NULL rather than an error, but verify a
> sample of the output rows actually has non-null `serving_quantity`).

---

## Phase 4 — Secrets & per-stage wiring

### 4a. GitHub Environment secrets (Brad; Settings → Environments)
Populate **both** environments with that project's values. Names must match the
workflows exactly (note RevenueCat names have **no underscores**):

| Secret | staging value | Production value |
|---|---|---|
| `SUPABASE_PROJECT_REF` | staging ref | prod ref |
| `SUPABASE_ACCESS_TOKEN` | account token | account token |
| `SUPABASE_DB_PASSWORD` | staging DB pw | prod DB pw |
| `DATABASE_URL` | staging pooler (6543) | prod pooler (6543) |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service_role | prod service_role |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | test (`sk_test_…`) | live (`sk_live_…`) |
| `REVENUECATAPIKEY` / `REVENUECATPROJECTID` / `REVENUECATWEBHOOKSECRET` | sandbox | live |
| `EXPO_ACCESS_TOKEN` | (optional) | (optional) |
| `AWS_ROLE_ARN_STAGING` / `AWS_ROLE_ARN_PRODUCTION` | (unchanged) | (unchanged) |

### 4b. Code edits (Claude; committable — public URL only)
`SUPABASE_URL` is **not** a GitHub secret — it's hardcoded per stage. Update:
- `packages/api-utils/src/domains/domain-config.ts` `SUPABASE_URLS`:
  `production` → `https://<prod-ref>.supabase.co`, `staging` →
  `https://<staging-ref>.supabase.co`.
- `packages/api-utils/src/domains/domain-config.test.ts` (`:84,94`) — update the
  asserted URLs.
- `packages/mobile/eas.json` — **prod build profile** `EXPO_PUBLIC_SUPABASE_URL` +
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` → prod project; preview/dev profile → staging.
- `packages/mobile/.env.example` — refresh to the staging URL/anon key.

Then a `main` merge redeploys staging with the new URL; the gated prod deploy picks
up the prod URL. **JWKS depends on this** — prod Lambda must resolve
`https://<prod-ref>.supabase.co/auth/v1/.well-known/jwks.json` or auth 500s.

---

## Phase 5 — Auth config incl. sign-in providers (Brad; dashboard — do on BOTH projects)

The app uses three sign-in methods (verified in `packages/mobile/src/adapters/auth/
supabase.adapter.ts`): **email/password**, **Google** (web-OAuth flow), **Apple**
(native id-token flow). `facebook` is in the `OAuthProvider` type but has **no UI
button** → do NOT configure it. App facts: scheme `persistencemobile`, iOS bundle id
`com.bradleyevans96.persistence`, `usesAppleSignIn: true`; OAuth redirect is
`persistencemobile://auth/callback` (Expo Go uses an `exp://…/--/auth/callback` URL).
Because each Supabase project has its own callback host, **providers are configured
per project** (staging + prod separately).

### 5.0 Email + core auth (both projects → Authentication)
- **Custom SMTP** — built-in email is rate-limited / not for production (SES/Resend/Postmark).
- **Email provider** enabled, **confirmations required**, OTP/magic-link expiry ≤ 1h.
- **JWT/JWKS** — asymmetric signing keys (the backend validates via JWKS); confirm
  `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` returns keys.

### 5.1 URL configuration (both projects → Authentication → URL Configuration)
- **Redirect URLs** allow-list (needed for the Google web flow):
  - `persistencemobile://auth/callback`
  - `persistencemobile://**` (covers deep links like accept-invite)
  - Expo Go dev only: an `exp://…/--/auth/callback` entry (or a wildcard) — dev-only,
    not needed for store builds.
- **Site URL** — the app scheme or the web origin.

### 5.2 Google (both projects) — web OAuth client
1. Google Cloud Console → APIs & Services → Credentials → create an **OAuth 2.0
   Client ID (type: Web application)**. One client can serve both stages — add BOTH
   authorized redirect URIs:
   - `https://nxkhlrvjxotyjulodxzk.supabase.co/auth/v1/callback` (staging)
   - `https://opcvjypsoivaxerahbal.supabase.co/auth/v1/callback` (prod)
2. Configure the **OAuth consent screen** (External; app name, logo, support email;
   publish for prod so it's not stuck in "testing").
3. In **each** Supabase project → Authentication → Providers → **Google** → enable,
   paste the **Client ID + Client Secret**. (No native Google iOS client / reversed
   client id needed — the app uses the Supabase-hosted web flow, not the native SDK.)

### 5.3 Apple (both projects) — native Sign in with Apple
1. Apple Developer → the App ID `com.bradleyevans96.persistence` → ensure **Sign in
   with Apple** capability is enabled (matches `usesAppleSignIn: true`).
2. In **each** Supabase project → Authentication → Providers → **Apple** → enable, and
   under **Client IDs** add:
   - `com.bradleyevans96.persistence` (the app bundle id)
   - `host.exp.Exponent` (Expo Go dev)
   Native id-token verification checks the token audience against these Client IDs —
   **no Services ID / secret key required** (those are only for a web Apple-OAuth flow,
   which this app does not use).

Providers are Auth-dashboard settings — **not MCP-addressable**, and prod is outside
the MCP's org, so all of Phase 5 is manual dashboard work.

---

## Phase 6 — Backups / DR / monitoring (prod)

1. Confirm **daily backups** are active (Settings → Database → Backups — included with
   Pro). ⚠ **PITR is DROPPED** (cost — see DECISIONS.md); recovery granularity is
   therefore **1 day, not to-the-minute**. To add PITR later: upgrade compute to ≥ Small,
   then enable the PITR add-on (7-day min).
2. **Restore procedure** (document + rehearse on staging):
   - Daily: Dashboard → Database → Backups → restore from the latest daily snapshot
     (causes downtime on the target while it restores).
   - (PITR restore N/A until the add-on is enabled.)
   - Rehearse on staging so the steps are known before a real incident.
3. **Alerting** — enable project health alerts (DB CPU/RAM, disk, connection
   saturation). At minimum email; wire to Slack/PagerDuty if desired.
4. **Pooler headroom** — verify the transaction-pooler `max_client_conn` vs expected
   Lambda concurrency. With `max:1` per warm Lambda, peak pooler clients ≈ peak
   concurrent Lambdas; keep default pool size unless load testing shows pressure.

---

## Phase 7 — Verify + cutover

### Per-environment smoke test (through the SST API, not PostgREST)
1. Sign in via Supabase Auth (mobile/web against that env) → get a JWT.
2. A couple of authed reads + one write through the deployed API base URL.
3. Confirm a **bad/expired JWT is rejected** (401) — proves JWKS is wired to the
   right project.
4. Confirm the anon key **cannot** read tables over PostgREST (Data API closed).

### Cutover order (safe)
1. Point **staging** GitHub secrets + `domain-config.ts` staging URL at the new
   staging project; merge → staging deploys + migrates + (manually) seed. Smoke-test.
2. Only once staging is green: point **Production** secrets + `domain-config.ts` prod
   URL + `eas.json` prod profile at `persistence-prod`; run the gated
   `production-deploy.yml`; seed prod; smoke-test.
3. **Retire the old free project** `dfeyebgdktfteqlacmru` only after prod is proven —
   pause first, delete later.

## Promotion (steady state)
- **Code + migrations**: merge to `main` → auto staging deploy (`db push` + `sst
  deploy --stage staging`). Verify on staging.
- **Prod**: publish a GitHub release (or manual `workflow_dispatch`) → gated
  `production-deploy.yml` runs dry-run `db push` → real `db push` → `sst secret set`
  → `sst deploy --stage production`. Prod migrations are **manual + gated by design —
  keep it that way.**

## Secret rotation
Rotate a DB password / service-role key in the Supabase dashboard → update the
matching GitHub Environment secret → re-run the deploy workflow for that stage
(`sst secret set` re-pushes to SSM before deploy). Never commit rotated values.
