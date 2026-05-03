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

### Per-environment (`staging`, `Production` — same values for both unless tracking different App Store apps)

| Secret name             | Where to get it                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `APPLE_TEAM_ID`         | App Store Connect → Membership → Team ID                                                               |
| `ASC_APP_ID`            | App Store Connect → My Apps → \[app] → App Information → Apple ID (the numeric one)                    |
| `ASC_API_KEY_ID`        | App Store Connect → Users and Access → Integrations → Keys → Key ID column                             |
| `ASC_API_KEY_ISSUER_ID` | Same page as above → "Issuer ID" at the top of the Keys tab                                            |
| `ASC_API_KEY`           | Contents of the `.p8` file you downloaded when generating the API key (multi-line string, store as-is) |

```bash
# Repo-level (set once, used by both envs)
gh secret set EXPO_TOKEN

# Per environment — staging
gh secret set APPLE_TEAM_ID         --env staging
gh secret set ASC_APP_ID            --env staging
gh secret set ASC_API_KEY_ID        --env staging
gh secret set ASC_API_KEY_ISSUER_ID --env staging
gh secret set ASC_API_KEY           --env staging < ./asc-api-key.p8

# Per environment — Production
gh secret set APPLE_TEAM_ID         --env Production
gh secret set ASC_APP_ID            --env Production
gh secret set ASC_API_KEY_ID        --env Production
gh secret set ASC_API_KEY_ISSUER_ID --env Production
gh secret set ASC_API_KEY           --env Production < ./asc-api-key.p8
```

## App Store Connect API key (one-time)

`eas submit` needs an App Store Connect API key to upload IPAs non-interactively. Setup once:

1. App Store Connect → **Users and Access** → **Integrations** → **Keys** → **Generate API Key**.
2. Role: **Developer** (sufficient for `eas submit`; reduce to least privilege).
3. Download the `.p8` file when the modal pops — **one-time download**, store it offline (e.g. 1Password). If lost, generate a new key.
4. Note the **Key ID** from the row and the **Issuer ID** from the top of the page.
5. Save those three values into the secrets above.

## Code signing (one-time)

EAS manages iOS distribution certificates and provisioning profiles in its credentials vault. To bring across what's already issued for `com.bradleyevans96.persistence`:

```bash
cd packages/mobile
eas login
eas credentials
# Choose: iOS → production (or whichever is queried) → Use existing
# Walk through the .p12 / mobileprovision import wizard
```

After this, every `eas build` pulls signing material from EAS automatically. No CI-side cert management.

## EAS environment variables (one-time, per env)

App-side env vars (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) live in **EAS-managed env**, not in GitHub or in `eas.json`. The `environment` field on each build profile maps to an EAS env scope (`development`, `preview`, `production`).

```bash
cd packages/mobile

# Staging values (preview env)
eas env:create --environment preview --name EXPO_PUBLIC_API_URL          --value 'https://<staging-api-gateway>'
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL     --value 'https://<staging-ref>.supabase.co'
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value '<staging anon key>'

# Production values
eas env:create --environment production --name EXPO_PUBLIC_API_URL          --value 'https://<prod-api-gateway>'
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL     --value 'https://<prod-ref>.supabase.co'
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value '<prod anon key>'
```

Anon keys are designed to be embedded in client bundles, so they can also be hardcoded in `eas.json`'s `env` block if you'd rather. EAS env keeps them out of source.

The API URL fields will need real values once SST has deployed. The current `infra/api.ts` uses the auto-generated API Gateway URL per stage (no custom domain yet) — pull from `bunx sst outputs --stage <staging|production>` after a deploy and feed it back into EAS env.

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
4. **Materialise the `.p8`** API key onto disk under `packages/mobile/asc-api-key.p8` with `umask 077` (only the runner user can read it).
5. **`eas submit --latest --non-interactive --wait`** picks the most recent build for the profile and uploads it to App Store Connect. `--wait` blocks until Apple confirms receipt — typically another 5–10 min for staging (TestFlight processing) or 20+ min for production (App Store ingest).
6. **Cleanup** removes the `.p8` regardless of success/failure (`if: always()`).

## Caveats

- **EAS build credits.** Free plan = 30 iOS builds/month. Defaulting to manual dispatch on staging keeps the burn predictable. Track usage on the EAS dashboard.
- **Apple review timing.** TestFlight needs ~5–30 min of post-upload processing before the build is available to internal testers. App Store submission needs Apple review (24–72 hr typical). CI can't accelerate either.
- **Build-number conflicts.** `appVersionSource: "remote"` (set in [`packages/mobile/eas.json`](../packages/mobile/eas.json)) means EAS auto-increments the build number per profile. Don't manually bump `ios.buildNumber` in `app.json` — EAS owns it.
- **OTA updates aren't wired yet.** When they are (probably M11), set `runtimeVersion: { policy: "appVersion" }` in `app.json` so OTA updates only ship to compatible builds. Until then, every fix means a new store submission.
- **Android build is wired but unsigned.** The workflows accept `platform: android` but you'll need to set up Android signing via `eas credentials` first. Skip until iOS is shipping cleanly.
- **EAS env vs `eas.json` env.** I picked EAS-managed env (referenced via the `environment` field on each build profile) over hardcoded values in `eas.json`'s `env` block. You can mix the two if helpful — `eas.json` env wins over EAS env when both define the same key.

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
