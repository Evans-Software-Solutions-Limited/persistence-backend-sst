# Deploy pipeline audit — 2026-05-03

Audit triggered mid-M3 backend PR ([#42](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/42)) after the migration-tooling commit landed and three follow-on concerns surfaced:

1. **Single-Supabase reality** — only one project on the free tier; staging + production share a DB.
2. **Mobile build pipeline** — TestFlight (staging) and App Store (production) submission was being done manually; should be automated.
3. **Exercise seeding** — legacy app shipped a 40k-line `seed_exercises.sql` applied manually; not yet mirrored into this repo.

This doc captures the audit findings and recommended scope for each. Scope decisions per concern are flagged ⏯ for "ship in this PR", 🆕 for "new follow-up PR", or 🅿️ for "park until later milestone".

---

## 1. Single-Supabase reality

### Current state

- One Supabase project on the free tier hosts both staging and production data.
- The CI/CD migration step added in commit [`aab4280`](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/42/commits/aab4280) runs `supabase db push --linked` ahead of the SST deploy in both `deploy-staging.yml` and `production-deploy.yml`.
- The two GitHub environments (`staging`, `Production`) are designed to take per-env secrets (`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`) — but with one Supabase project, those values are identical across both envs.

### Implications

- **No DB isolation.** A bad migration applied via the staging-deploy workflow corrupts production simultaneously. The dry-run + idempotent + additive-only rules are the only safety net.
- **Migrations land at staging-deploy time** (push to main runs first). When `production-deploy.yml` later runs on a release publish, `db push` is a no-op because the schema's already there. So in practice production code deploys against an already-migrated DB — the ordering is correct, just not the way "two-environment" implies.
- **Future-proofing is cheap.** When the project moves off the free tier, the workflow files don't change — only the secret values per environment.

### Recommendation

⏯ **Ship in this PR.** Already done in [`aab4280`](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/42/commits/aab4280) — the workflow design works as-is for single-DB; just needed a doc note in `supabase/README.md` § "Single-Supabase reality (free tier)" so the next reader doesn't assume isolation. (Note added in the same commit as this audit doc.)

The user sets the same `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` in both `staging` and `Production` environments. When the project upgrades, the values diverge per env without any code change.

---

## 2. Mobile build pipeline (TestFlight + App Store)

### Current state

- **`packages/mobile/app.json`**: app identity preserved from legacy (bundle ID `com.bradleyevans96.persistence`, Expo project ID `255d542d-8dae-43c9-8d98-d9a3a325a470`, version `1.1.1`, URL scheme `persistencemobile`). HealthKit + Apple Pay entitlements declared. No EAS-specific config.
- **No `eas.json`** in `packages/mobile/` — `CONFIG_REQUIREMENTS.md` flags it as "not yet added"; legacy `eas.json` is minimal (3 build profiles, one submit profile).
- **Env routing exists.** `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` are read by `sst-api.adapter.ts` and `supabase.adapter.ts` from process.env at build time (and `Constants.expoConfig?.extra?.apiUrl` as a fallback). EAS profiles can inject these per-build.
- **No CI/CD for mobile builds.** Legacy `persistence-mobile/.github/workflows/ci.yml` only runs typecheck/lint/tests. Build + TestFlight/App Store submission was manual.

### What's needed

#### `packages/mobile/eas.json`

Two store-distribution profiles + a development profile (for internal QA). Each store profile sets the env vars its build needs.

```json
{
  "cli": { "version": ">= 7.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "distribution": "internal",
      "developmentClient": true,
      "ios": { "resourceClass": "m-medium", "simulator": true }
    },
    "staging": {
      "distribution": "store",
      "channel": "staging",
      "ios": { "resourceClass": "m-medium" },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://staging-api.persistence.app",
        "EXPO_PUBLIC_SUPABASE_URL": "https://<ref>.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<staging anon key>"
      }
    },
    "production": {
      "distribution": "store",
      "channel": "production",
      "ios": { "resourceClass": "m-medium" },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.persistence.app",
        "EXPO_PUBLIC_SUPABASE_URL": "https://<ref>.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<prod anon key>"
      }
    }
  },
  "submit": {
    "staging": {
      "ios": {
        "ascAppId": "<App Store Connect app ID>",
        "appleTeamId": "<Apple developer team ID>",
        "ascApiKeyId": "$ASC_API_KEY_ID",
        "ascApiKeyIssuerId": "$ASC_API_KEY_ISSUER_ID",
        "ascApiKeyPath": "./asc-api-key.p8"
      }
    },
    "production": {
      "ios": {
        /* same keys, different release track */
      }
    }
  }
}
```

`appVersionSource: "remote"` means EAS auto-increments the build number (good for CI). The version comes from `app.json`.

Anon keys / Supabase URLs are **public** (the anon key is designed to be in client bundles), so embedding them in `eas.json` env is fine. The API URL is also non-sensitive.

#### Code-signing strategy

`eas credentials` manages certificates and profiles in EAS's vault. The legacy app already has an Apple Distribution certificate + provisioning profile — pull them in once via `eas credentials → iOS → Use existing` (the wizard walks through the `.p12` import). After that, every CI build pulls signing material from EAS automatically.

#### App Store Connect API key (for `eas submit`)

`eas submit` needs to authenticate with App Store Connect. Two options:

| Method                                                    | Setup cost | Trade-off                                                                        |
| --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| **App-specific password** (`APPLE_APP_SPECIFIC_PASSWORD`) | 5 min      | Tied to a personal Apple ID; rotates if the user's main password rotates         |
| **App Store Connect API key** (preferred)                 | 15 min     | Decoupled from any user; revocable per-key; the documented "production" approach |

API key route:

1. App Store Connect → Users and Access → Integrations → Keys → "Generate API Key" with role `Developer`.
2. Download the `.p8` file (one-time download; store securely).
3. Note the Key ID and Issuer ID from the page.
4. Three GH secrets per env: `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID`, `ASC_API_KEY` (the `.p8` content as a string).

#### `.github/workflows/mobile-build-staging.yml`

```yaml
name: Mobile Build (Staging → TestFlight)

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - "packages/mobile/**"
      - ".github/workflows/mobile-build-staging.yml"

concurrency:
  group: mobile-build-staging
  cancel-in-progress: true

jobs:
  build:
    name: Build + Submit to TestFlight
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - name: Materialise ASC API key
        working-directory: packages/mobile
        run: |
          mkdir -p .eas
          echo "${{ secrets.ASC_API_KEY }}" > .eas/asc-api-key.p8
      - name: Build (iOS staging)
        working-directory: packages/mobile
        run: eas build --platform ios --profile staging --non-interactive --no-wait
      - name: Submit to TestFlight
        working-directory: packages/mobile
        env:
          ASC_API_KEY_ID: ${{ secrets.ASC_API_KEY_ID }}
          ASC_API_KEY_ISSUER_ID: ${{ secrets.ASC_API_KEY_ISSUER_ID }}
        run: eas submit --platform ios --profile staging --latest --non-interactive
```

`production-deploy.yml` mirror: replace `staging` → `production`, trigger on `release: published`.

#### Required secrets summary

Repo-level (one set, used by both envs):

- `EXPO_TOKEN` — from [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens). Personal access token, scope: build + submit.

Per environment (`staging`, `Production`):

- `ASC_API_KEY_ID` — App Store Connect API key ID
- `ASC_API_KEY_ISSUER_ID` — App Store Connect issuer ID
- `ASC_API_KEY` — the `.p8` contents (multi-line; `gh secret set ASC_API_KEY < ./asc-api-key.p8`)

If using app-specific password instead of ASC key:

- `APPLE_ID` — Apple ID email
- `APPLE_APP_SPECIFIC_PASSWORD` — generated at appleid.apple.com

#### Caveats

- **EAS build runs on Expo's cloud builders, not GH runners.** The CI step kicks off the build and either waits (`--wait`, ~15-30 min) or fires and forgets (`--no-wait`). For TestFlight automation, kicking off then submitting via `--latest` is the usual pattern — the recipe above does this.
- **Apple processing latency.** TestFlight needs ~5-30 min after upload before the build is available to testers. App Store submission needs Apple review (24-72 hr typical). CI can't speed these up.
- **Build credit cost.** Free EAS tier = 30 builds/month. iOS builds use ~1 credit each. Worth checking the user's plan before automating builds-on-every-push (recommend: workflow_dispatch only for production; push-to-main can be sufficient for staging if iteration is daily, otherwise also workflow_dispatch).
- **`runtimeVersion` policy** isn't set in `app.json`. Once OTA updates are wired (probably M11), set `"runtimeVersion": { "policy": "appVersion" }` so over-the-air updates only ship to compatible builds.
- **Health Connect on Android.** App.json declares Health Connect permissions but the Android module is `expo-health-connect`. EAS production builds need this dependency present and the `expo-health-connect` plugin entry — not yet wired (per `CONFIG_REQUIREMENTS.md`). M1 partially covered HealthKit; Android side is open.

### Recommendation

🆕 **Ship as a separate PR.** Distinct review surface, distinct secrets, distinct blast radius from M3 backend. Estimated ~4-6 hr of work plus iteration as Apple's API quirks bite. Suggested title: `feat(mobile): EAS build profiles + automated TestFlight / App Store submission`.

Concrete sequence for that PR:

1. `feat(mobile): eas.json with development / staging / production profiles`
2. `feat(mobile): wire EXPO_PUBLIC_API_URL fallbacks via eas.json env`
3. `feat(ci): mobile-build-staging.yml — build + submit to TestFlight`
4. `feat(ci): mobile-build-production.yml — build + submit to App Store on release`
5. `docs(mobile): EAS_RELEASE.md — first-time signing-cert import + secrets setup`

Ordering: this PR can land independently of M3 — it doesn't touch session code. Doing it next would unblock the M3 frontend agent's smoke test (they currently need a manually-built dev client to run §A in `SMOKE_TEST.md`).

---

## 3. Exercise seeding

### Current state

- Legacy [`persistence-backend/supabase/seed_exercises.sql`](../../persistence-backend/supabase/seed_exercises.sql) is **40,693 lines** of `INSERT INTO exercises` statements. Generated from a CSV/spreadsheet, applied manually to the live Supabase DB once.
- Legacy [`seed.sql`](../../persistence-backend/supabase/seed.sql) is **570 lines** of supporting reference data: muscle groups, equipment types, accessibility tags, default goals — applied before `seed_exercises.sql`.
- This repo's [`supabase/README.md`](../supabase/README.md) explicitly says "everything else from the legacy persistence-backend repo (Edge Functions, pgTAP tests, `seed.sql`, `seed_exercises.sql`) is **not** mirrored here."
- Production data already exists. Live Supabase has all exercises seeded. CI doesn't need to run seeds.

### Where the gap shows up

- **Local dev parity.** Anyone running `supabase start` locally gets an empty DB. Without seeds, mobile/web can't render exercise pickers, workout templates, or anything that depends on the library. Running M3's smoke test locally needs at least the muscle-group / equipment / a handful of exercises seeded.
- **Fresh environment bootstrap.** When the project moves to its own staging Supabase, that DB starts empty. Whoever cuts over needs to re-run seeds. Without them in this repo, they'd have to dig back into the legacy backend.
- **Test fixtures.** Integration tests that need real exercise rows (M3 quick-fill, M5 exercise detail) currently mock — but if any test needs a realistic dataset in a local Supabase, seeds become required.

### Options

| Option                                                                                                         | Description                                                                                                                                                                                                               | Pros                                                                                                           | Cons                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **A. Don't mirror; document the manual step**                                                                  | Add a `supabase/seeds/README.md` pointing to the legacy file. Local devs copy it across once.                                                                                                                             | Zero churn now; legacy file stays the canonical source.                                                        | Requires someone to remember the manual step; legacy repo could deprecate.                          |
| **B. Mirror as `supabase/seed.sql` + `supabase/seeds/exercises.sql`**                                          | Copy both files under a `supabase/seeds/` directory. Standard Supabase CLI: `supabase db reset` runs `seed.sql` automatically. Exercises file referenced from seed.sql via `\i seeds/exercises.sql` or imported manually. | Repo is self-contained; `supabase start && supabase db reset` gives a fully-loaded local DB.                   | +40k-line file in git history. Review noise on the diff. PR reviewers see "huge new SQL file" once. |
| **C. Convert exercises to a JSON/CSV under `supabase/seeds/exercises.csv` + a small idempotent upsert script** | Same content, more flexible format. Can be regenerated from a Google Sheet if the user manages the catalog there.                                                                                                         | Easier to diff (one row per exercise on its own line); future-proof for spreadsheet-driven catalog management. | More moving parts (script that parses CSV → SQL); needs upfront design of the upsert key.           |

### Recommendation

🆕 **Ship as a separate PR — option B.** Mirroring as-is is the least-effort path and is the right call because:

- The 40k-line file is already authored. Re-deriving it from a spreadsheet adds risk for no immediate gain.
- `supabase db reset` runs `seed.sql` automatically once `supabase/seed.sql` exists — no scripting required.
- The CSV/spreadsheet approach (C) is a nice-to-have when the user wants to start managing the catalog as data, not code. That's a M11-era refinement, not a now-decision.
- One PR, two commits: `chore(supabase): mirror legacy seed.sql + exercises seed`, then `docs(supabase): seeds workflow + when seeds run`.

The PR can land before, in parallel with, or after the mobile-pipeline PR — they don't overlap. Opening this one shortly after M3 backend merges would close the local-dev parity gap before the M3 frontend agent starts.

---

## Decision summary

| Concern              | Status / Recommendation                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Single Supabase      | ⏯ Already addressed in `aab4280`; doc note added to `supabase/README.md`. Set the same secrets in both GH envs.       |
| Mobile build / store | 🆕 New PR after M3 backend merges. ~4-6 hr scope. Unblocks M3 frontend smoke. Exact secrets list above.                |
| Exercise seeding     | 🆕 New PR, option B (mirror legacy seeds verbatim under `supabase/seeds/`). Small effort. Closes local-dev parity gap. |

## Open questions for the user

1. **Should I open the mobile-pipeline PR next** (before M3 commits 4–8), or queue it as a follow-up after M3 backend merges? Doing it next would unblock the M3 frontend agent's smoke test, but stretches M3's timeline.
2. **EAS plan check.** Free EAS tier = 30 iOS builds/month. Push-to-main on staging could chew through this if mobile churn is high. Are you happy with workflow_dispatch only for staging, or do you want push-to-main automation?
3. **Apple Developer account access for the audit.** I can't fully validate the ASC API key path without poking the App Store Connect dashboard — happy to write the workflows blind against the documented API, but you'd validate end-to-end by running the first build manually.
4. **Seed format for exercises.** Going with option B (verbatim mirror) unless you'd rather invest in option C now (CSV-driven, regeneratable from a Google Sheet). C is more work but unlocks "edit the spreadsheet → PR diff is human-readable" later.
