# GO-LIVE-FINAL · Brief 3 — Staging & Production build bring-up (step-by-step, run WITH Brad)

_Authored 2026-07-16, `main` HEAD `b9ca1b9`. This is a **live runbook for a future
session to walk through with Brad step by step** — not an agent-autonomous task.
Most steps are Brad's (dashboards, credentials, GitHub environment secrets, release
publishing); the agent's job is to drive the order, verify each gate, and read back
CI/EAS output. **Do not dispatch any build or deploy without Brad's explicit go per
step.**_

## Audit result (2026-07-16) — the pipeline is already written

All four workflows exist on `main` and were audited end-to-end:

| Workflow | Trigger | Verdict |
| --- | --- | --- |
| `deploy-staging.yml` | push `main` + manual | ✅ Production-grade. Full gate suite → dry-run migrate → migrate → SST secrets (fail-fast) → `sst deploy --stage staging`. Live today (12.13 auto-applied on the #251 merge). |
| `production-deploy.yml` | release published + manual | ✅ Mirrors staging for `--stage production`. |
| `mobile-build-staging.yml` | manual (auto-trigger commented) | ✅ after fix — build+submit race fixed 2026-07-16 (`--no-wait`→`--wait`). |
| `mobile-build-production.yml` | manual (auto-trigger commented) | ✅ after fix — same fix applied. |

**Fix landed this session:** both mobile workflows did `eas build --no-wait` then
`eas submit --latest`, which submits the *previous* build (or errors on the first-ever
build). Changed to `--wait` so `--latest` resolves to the just-finished build. No other
code changes were needed to the pipeline.

**Nothing else in the pipeline needs code.** What remains is operational: populate
GitHub environment secrets, finish the prod Supabase cutover, then dispatch in order.

---

## Prerequisites the agent should verify first (read-only)

- GitHub **Environments** exist: `staging` and `Production` (note the capital P —
  matches `environment: Production` in the prod workflows).
- Confirm which env secrets are already set with `gh secret list --env <name>`
  (Brad runs it, or agent if permitted). Compare against the required set below.
- `packages/mobile/eas.json` is correct: staging Supabase `nxkhlrvjxotyjulodxzk`,
  prod `opcvjypsoivaxerahbal`; staging `ascAppId 6790912063`, prod `6755091280`;
  `appleTeamId U9S9BFTM4V`. (Values in eas.json are anon/publishable/SDK keys —
  client-safe, correctly committed.)

### Required GitHub **environment** secrets (names only — never commit values)

Backend deploy (both `staging` and `Production`):
`DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REVENUECATAPIKEY`,
`REVENUECATPROJECTID`, `REVENUECATWEBHOOKSECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`,
`AWS_ROLE_ARN_STAGING` / `AWS_ROLE_ARN_PRODUCTION`.
Optional (safe empty): `EXPO_ACCESS_TOKEN`, `SENTRY_DSN`.

Mobile build (both envs): `EXPO_TOKEN`.

> ⚠ **The critical prod-cutover secret:** `production-deploy.yml`'s comment still says
> the Production `DATABASE_URL` equals staging's "while on a single shared Supabase
> project." That's now stale — the prod project (`opcvjypsoivaxerahbal`) exists. The
> Production `DATABASE_URL` **must** point at the prod transaction-mode pooler
> (`…pooler.supabase.com:6543`), and `SUPABASE_PROJECT_REF` = `opcvjypsoivaxerahbal`.
> This is the single most important value to get right in the whole bring-up.

---

## Track A — Backend production bring-up

1. **Finish the prod Supabase cutover** per [`../SUPABASE-PROD-SETUP/RUNBOOK.md`](../SUPABASE-PROD-SETUP/RUNBOOK.md)
   (staging is already cut over + migrated + smoke-tested; prod is the remaining half).
2. **Set the `Production` environment secrets** (list above), especially `DATABASE_URL`
   → prod pooler and `SUPABASE_PROJECT_REF` → `opcvjypsoivaxerahbal`. Production Stripe =
   `sk_live_…`; RevenueCat = the live REST key/project/webhook secret.
3. **Run `production-deploy`** — either publish a GitHub release (release-please PR #241
   is the standing "chore(main): release" gate) **or** manual `workflow_dispatch` with a
   ref. The workflow gates (typecheck/lint/prettier/build/test) → **dry-run migrate**
   (inspect output with Brad before the real push) → migrate → SST secrets → deploy.
4. **12.13 pre-flight on prod** (spec-12.13 gate): before trusting the new unique index,
   run the dedup query from the migration header against **prod**; must return zero rows.
   The migration auto-runs in step 3's `supabase db push`; the dedup check is the guard.
5. **Seed prod** — Actions → **Seed Database** → Production (and the OFF dump refresh if
   the 147k food rows are wanted on prod). See tracker `inf3`.

## Track B — Mobile staging build → TestFlight

1. **One-time EAS credential setup (Brad, local):** `eas credentials` to register the
   App Store Connect API key globally (the workflows rely on this — no per-run submit
   secret). Set `EXPO_TOKEN` on the `staging` GitHub environment.
2. **Dispatch `mobile-build-staging`** (`workflow_dispatch`, platform `ios`, submit
   `true`). Agent watches the run: EAS build → `eas submit --latest` → TestFlight.
3. **Device-verify the staging variant** (tracker `inf2`, never done): install the
   staging build alongside prod (separate bundle id / scheme), confirm it points at the
   staging API + Supabase, OAuth/QR work per variant, and the backend-fingerprint cache
   wipe fires when switching backends (PR #226).

## Track C — Mobile production build → App Store

1. **App Store Connect + RevenueCat dashboard** (Brad, tracker `12.9`/`12.10`): register
   IAP product IDs, wire the RC dashboard/offerings, prepare screenshots, app icon,
   age-rating, demo account + reviewer notes.
2. **Set `EXPO_TOKEN` on the `Production` environment.**
3. **Dispatch `mobile-build-production`** once staging is verified and Track A prod is
   live. EAS build → `eas submit --latest` → App Store.
4. **IAP sandbox verification on the prod build (SIGN-OFF GATE, tracker `inf4`):** staging
   IAP was deliberately deferred (RC webhook is per-project). Buy each tier via Apple
   **sandbox** → entitlement syncs via the RC webhook → prod backend → unlocks. **This is
   where 12.13 pays off** — it must already be on prod (Track A) so concurrent first-time
   sandbox purchases can't double-insert. Required before final go-live.

## Optional / decisions to raise with Brad

- **Re-enable auto-triggers?** `mobile-build-staging` (push to `main` on `packages/mobile/**`)
  and `mobile-build-production` (release published) have their auto-triggers commented out
  to conserve EAS build minutes. Flip on once the build budget is confirmed.
- **Repo privatization** (GO-LIVE-FINAL Brief 2): decide before public launch.
- **Part A a11y device walkthrough** (Brief 1) is an independent manual gate still owed.

## Sequencing summary

Track A (prod backend + 12.13 on prod + seed) → Track B (staging build verified on
device) → Track C (prod build + IAP sandbox sign-off). 12.13 on prod is a hard
predecessor of the Track C sign-off gate.
