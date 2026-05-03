# Mobile release pipeline

End-to-end automation for shipping the mobile app to **TestFlight** (staging) and the **App Store** (production). Builds run on EAS's cloud builders; submission runs in GitHub Actions using EAS-managed credentials and an App Store Connect API key.

This doc replaces the manual TestFlight workflow that the legacy `persistence-mobile` repo used (its CI was lint/test only — every TestFlight push was operator-driven from a local machine).

## Topology

```
push to main          ─→  mobile-build-staging.yml      ─→ EAS build ─→ TestFlight
                          (or manual dispatch)             (preview env)

release-please           ┌─→ release-please.yml opens "chore: release" PR
push to main  ──────────→┤
                          └─→ on PR merge → GitHub release published
                              ─→ mobile-build-production.yml             ─→ EAS build ─→ App Store
                                  (or manual dispatch)                      (production env)
```

The mobile flow mirrors the backend deploy flow exactly: every push to `main` ships TestFlight; every release-please release ships the App Store. No separate mobile cadence to keep in sync — both platforms (server + iOS) move together.

Two build profiles in [`packages/mobile/eas.json`](../packages/mobile/eas.json):

| Profile    | Distribution | EAS env      | Channel      | Bumps build #      |
| ---------- | ------------ | ------------ | ------------ | ------------------ |
| staging    | store        | `preview`    | `staging`    | per-build (remote) |
| production | store        | `production` | `production` | auto-incremented   |

No `development` profile — local dev points at staging via `expo run:ios` / `expo start` against `EXPO_PUBLIC_API_URL=<staging-api>` and the staging Supabase project. EAS builds are reserved for store distribution.

Two submit profiles share the same App Store Connect API key but submit to distinct release tracks (TestFlight vs App Store). Apple itself separates internal testing (TestFlight) from external review (App Store) on the receiving end — we don't need separate apps.

## Required GitHub secrets

### Repo-level

| Secret name  | Where to get it                                                  |
| ------------ | ---------------------------------------------------------------- |
| `EXPO_TOKEN` | https://expo.dev/settings/access-tokens · scope: account / build |

### Per-environment

No App Store Connect secrets needed in GitHub. EAS handles ASC auth via the API key registered globally to the EAS project (one-time `eas credentials → App Store Connect: Manage your API Key` flow). EAS auto-detects `appleTeamId` and `ascAppId` from the bundle ID's existing App Store Connect record.

`SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` are still required for the **backend** deploy workflows (per [`supabase/README.md`](../supabase/README.md)), but those are unrelated to mobile builds.

```bash
# Repo-level (set once, used by both envs)
gh secret set EXPO_TOKEN
```

That's the only mobile-side GitHub secret. Everything else lives in EAS.

## One-time local setup

All credentials live inside EAS's vault. CI just kicks off `eas build` / `eas submit` — no per-run secret juggling.

```bash
cd packages/mobile

# 1. Authenticate the CLI
eas login

# 2. Register the App Store Connect API key globally with EAS.
#    EAS uses this for both eas submit (uploads) AND eas credentials
#    (creating distribution certs / provisioning profiles via Apple's API).
eas credentials
# Walk through: App Store Connect: Manage your API Key
#   → Set up your project to use an API Key for EAS Submit
#   → Provide the .p8 file path, Key ID, Issuer ID

# 3. Set up iOS distribution credentials (cert + provisioning profile).
eas credentials
# Walk through: Build Credentials → iOS → production →
#   Distribution Certificate → "Set up a new Distribution Certificate" →
#   Let Expo handle it (uses the API key you just registered).
# Repeat for the staging build profile (reuse the production cert when prompted).
```

After step 2, EAS no longer needs Apple credentials passed via CI. `eas submit` reads the registered API key from your EAS project state. After step 3, `eas build` pulls signing material from EAS's vault on every build.

## App-side environment variables

The `EXPO_PUBLIC_*` values that get baked into each build live directly in [`packages/mobile/eas.json`](../packages/mobile/eas.json) under each profile's `env` block. Three values per profile:

| Key                             | Staging                                                        | Production                                             |
| ------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `EXPO_PUBLIC_API_URL`           | `https://api.staging.persistence.evans-software-solutions.com` | `https://api.persistence.evans-software-solutions.com` |
| `EXPO_PUBLIC_SUPABASE_URL`      | the Supabase project URL                                       | same (single project for now)                          |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the Supabase anon key                                          | same                                                   |

These three values are **public by design**:

- Anon keys are part of Supabase's security model assuming they're shipped in every client bundle. RLS does the actual access control.
- API URLs are visible in any network inspector during normal app use.
- Custom-domain hostnames are stable across stack rebuilds (driven by [`packages/api-utils/src/domains/domain-config.ts`](../packages/api-utils/src/domains/domain-config.ts)) — set once, forget.

So embedding them in source is the right trade-off: zero out-of-band CLI dance, full diff visibility on rotation.

The `"environment": "preview"` / `"environment": "production"` fields on each build profile remain — that's where you'd add **truly sensitive** values via `eas env:create` later (e.g. a Stripe secret key for in-app checkout). EAS-managed env vars override the `eas.json` `env` block when both define the same key.

When the project moves to two Supabase projects, the staging-side URL + anon key in `eas.json` flip to the new project's values; production stays put. Two-line edit, no infra change.

## Triggering a build

### Staging → TestFlight

Every push to `main` that touches `packages/mobile/**` automatically fires a TestFlight build via [`.github/workflows/mobile-build-staging.yml`](../.github/workflows/mobile-build-staging.yml). No manual step.

To rebuild without a code change (e.g. after rotating an env var) or to skip the TestFlight submit step, manual dispatch is also wired:

```bash
gh workflow run mobile-build-staging.yml \
  --field platform=ios \
  --field submit=true
```

Or via the GitHub UI: Actions → "Mobile Build (Staging → TestFlight)" → Run workflow.

> **EAS build credits.** Free plan = 30 iOS builds/month. The push-to-main trigger is `paths`-filtered to `packages/mobile/**` to keep credit burn aligned with mobile churn — backend-only PRs don't trigger a build. If you blow the quota, comment out the `push:` block in the workflow and fall back to manual dispatch only.

### Production → App Store

Two paths, both gated on a GitHub release:

1. **Release-please (recommended).** Conventional-commit-driven. Push to `main` updates a "chore: release" PR via [`release-please.yml`](../.github/workflows/release-please.yml); merging that PR publishes a GitHub release; [`mobile-build-production.yml`](../.github/workflows/mobile-build-production.yml) fires on `release: published`. The release tag is checked out for the build, so the App Store binary matches the tagged commit. Same flow [`production-deploy.yml`](../.github/workflows/production-deploy.yml) follows for the SST backend — server + app version bump together.
2. **Manual dispatch.** Useful for rebuilds without cutting a new release (e.g. resubmit after Apple rejects the binary). Same `gh workflow run` shape as staging:

   ```bash
   gh workflow run mobile-build-production.yml \
     --field platform=ios \
     --field submit=true
   ```

## What happens during a run

1. **Checkout + setup** — same Bun/cache setup as the SST workflows.
2. **Install Expo + EAS CLI** via [`expo/expo-github-action@v8`](https://github.com/expo/expo-github-action), authed by `EXPO_TOKEN`.
3. **`eas build --non-interactive --no-wait`** kicks off the build on EAS's cloud builders. The CI step returns immediately once the build is queued (typical wall-clock: 15–30 min on EAS's `m-medium` resource class, but invisible to the runner).
4. **`eas submit --latest --non-interactive --wait`** picks the most recent build for the profile and uploads it to App Store Connect. EAS authenticates using the API key you registered globally via `eas credentials → App Store Connect: Manage your API Key`; `appleTeamId` and `ascAppId` are auto-detected from the bundle ID's record. `--wait` blocks until Apple confirms receipt — typically another 5–10 min for staging (TestFlight processing) or 20+ min for production (App Store ingest).

## Caveats

- **EAS build credits.** Free plan = 30 iOS builds/month. Defaulting to manual dispatch on staging keeps the burn predictable. Track usage on the EAS dashboard.
- **Apple review timing.** TestFlight needs ~5–30 min of post-upload processing before the build is available to internal testers. App Store submission needs Apple review (24–72 hr typical). CI can't accelerate either.
- **Build-number conflicts.** `appVersionSource: "remote"` (set in [`packages/mobile/eas.json`](../packages/mobile/eas.json)) means EAS auto-increments the build number per profile. Don't manually bump `ios.buildNumber` in `app.json` — EAS owns it.
- **OTA updates aren't wired yet.** When they are (probably M11), set `runtimeVersion: { policy: "appVersion" }` in `app.json` so OTA updates only ship to compatible builds. Until then, every fix means a new store submission.
- **Android build is wired but unsigned.** The workflows accept `platform: android` but you'll need to set up Android signing via `eas credentials` first. Skip until iOS is shipping cleanly.
- **EAS env vs `eas.json` env.** Public values (anon keys, API URLs) live in `eas.json`'s `env` block — simplest, fully self-contained. EAS-managed env (`eas env:create` + the `"environment"` field on each profile) is reserved for genuinely sensitive values (Stripe secrets, etc) that shouldn't be in source. EAS env wins over `eas.json` env when both define the same key — useful if you want to override one value without re-deploying code.

## First-time validation checklist

Before relying on the workflow for an actual TestFlight push:

- [ ] All required secrets set in `staging` env (`gh secret list --env staging`).
- [ ] `eas credentials` run locally and the iOS distribution cert imported.
- [ ] `eas env:list --environment preview` shows the three `EXPO_PUBLIC_*` keys.
- [ ] Manual local build succeeds: `cd packages/mobile && eas build --profile staging --platform ios --non-interactive`.
- [ ] Manual local submit succeeds: `eas submit --profile staging --latest --platform ios`.
- [ ] **Then** trigger the workflow — the runner does the same thing the local validation just did.

For production: same checklist against `production` env / `production` EAS env.

## Rolling back a release

Once an IPA is on the App Store, "rollback" means submitting the previous build's binary again under the next build number — Apple won't let you re-promote an older build. Practically:

1. Cut a fresh release tag pointing at the prior commit.
2. Trigger `mobile-build-production.yml` against it.
3. The new build (higher build number, older code) goes through review.

For TestFlight, you can manually expire the bad build in App Store Connect → TestFlight → Builds → \[build] → Expire to keep testers off it while you fix forward.
