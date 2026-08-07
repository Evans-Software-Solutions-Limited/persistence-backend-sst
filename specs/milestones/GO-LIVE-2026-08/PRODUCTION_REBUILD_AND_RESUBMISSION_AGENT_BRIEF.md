# Production rebuild and store resubmission — agent brief

Use this brief only after PR #375 has merged to `main` and Brad has granted the
Supabase connector access required for a read-only production audit.

## Mission

Prepare and evidence a safe production data update, fresh iOS and Android
production builds, and the App Store Connect resubmission response. Do not treat
a successful EAS build as proof that either store is ready: backend state, store
products, RevenueCat, reviewer access, declarations and device purchases are
separate release gates.

Take time at the start to understand the current repository and live state. Do
not execute an old command merely because it appears in a historical brief.
Reconcile the current `main` branch, current store dashboards and current
production data before proposing any mutation.

## Read first

1. `STATE.md`
2. This brief
3. `specs/milestones/GO-LIVE-2026-08/TEST_AND_LAUNCH_RUNBOOK.md`
4. `specs/milestones/ANDROID-LAUNCH/REVENUECAT-PLAY-SETUP.md`
5. `specs/milestones/ANDROID-LAUNCH/HEALTH-CONNECT-DECLARATION.md`
6. `specs/milestones/GO-LIVE-FINAL/BRIEF-2-launch-and-lockdown.md`
7. `specs/milestones/GO-LIVE-FINAL/BRIEF-3-build-bringup-runbook.md`
8. `.github/workflows/mobile-build-staging.yml`,
   `.github/workflows/mobile-build-production.yml`, `packages/mobile/eas.json`,
   and the applicable Supabase migrations

Where older documents disagree with the current workflows or this brief, stop
and resolve the discrepancy from code and live evidence. In particular, use
the exact build ID produced by the workflow; do not submit an ambiguous
`--latest` build.

## Guardrails

- Production Supabase project: `opcvjypsoivaxerahbal`.
- Staging Supabase project: `nxkhlrvjxotyjulodxzk`.
- Begin read-only. Produce an audit and proposed mutation set before requesting
  Brad's approval.
- Never delete an auth user, profile, workout, session, nutrition record or
  reviewer data as part of subscription cleanup.
- Never run a blanket subscription reset based on the historical statement that
  production contained only test users. Prove the current population first.
- Do not expose emails, reviewer credentials, tokens or full user UUIDs in the
  repository, logs, PR, Slack or the final report.
- Do not deploy, mutate production, create store releases, submit a build or send
  a reviewer message without explicit approval for that phase.
- Treat RevenueCat as part of the same state transition. Database-only cleanup
  can be undone by the next webhook or customer sync.

## Phase 1 — read-only baseline

Report evidence for all of the following before proposing writes:

- merged `main` SHA and the exact migrations/workflows present at that SHA;
- production migration status and the six active subscription catalog rows,
  including monthly/annual prices and inactive retired-tier tombstones;
- a privacy-preserving inventory of production profiles and auth identities,
  roles, `profiles.subscription_id`, subscription rows, status, tier, store,
  product/external identifiers and RevenueCat app-user identifiers;
- any account on a retired tier, old price, unexpected role or duplicate active
  subscription;
- counts of account-owned workouts, sessions and nutrition data so preservation
  can be proved after the operation;
- Open Food Facts seed/quarantine checks from the launch runbook, including the
  referenced-invalid-food query;
- current App Store Connect, Google Play Console and RevenueCat configuration,
  distinguishing verified facts from items Brad must check manually.

Classify every production identity with Brad as one of: reviewer/demo, Brad's
personal account, approved disposable test account, or unknown. Unknown accounts
are an immediate stop condition; do not mutate them.

## Phase 2 — propose and execute the approved data transition

The seed and subscription operations are separate:

- Apply production migrations through the repository's approved production
  workflow, then run the idempotent seed path and repeat the catalog and OFF
  audits. Do not manually recreate reference rows already owned by migrations or
  seed code.
- Snapshot the exact profile and subscription rows proposed for mutation, with a
  recoverable record stored in an approved secure location, before changing them.
- For each explicitly approved account, reconcile or revoke the corresponding
  RevenueCat sandbox/promotional/customer state as part of the same change.
- Prefer a valid subscription status transition over raw deletion. The current
  `profiles.subscription_id` foreign key can block deleting an active row, and
  `update_subscription_limits_trigger` runs on subscription insert/update but not
  delete. Inspect the deployed functions and constraints before execution.
- Perform the database change transactionally, invoke/verify subscription-limit
  recalculation, and confirm the profile is on the intended role and limits.
- Preserve the append-only subscription transition ledger. Do not erase history
  merely to make a test account look clean.

Afterward, prove that account identity and owned-data counts are unchanged, no
unapproved subscription was touched, no profile has a dangling subscription,
and RevenueCat sync/webhooks do not restore stale entitlement state.

Create the production reviewer/demo state through the real supported entitlement
path (sandbox purchase or an explicitly approved RevenueCat promotional
entitlement), not an unexplained database-only row. Keep reviewer credentials and
the coach invite/demo code only in the store review fields or another approved
secret channel.

## Phase 3 — external release gates

### iOS

Verify all 12 App Store products (six tiers × monthly/annual), prices, cleared
agreements/tax/banking status, review metadata and availability. In RevenueCat,
verify entitlement IDs equal `tier_name`, all iOS products are attached to the
current `default` offering, the production public SDK key is configured, and
retired products are not offered. Confirm the coach reviewer path and code.

### Android

Follow the Android RevenueCat/Play checklist completely. At minimum verify the
Play Console app and package, signing/upload credentials, payments profile,
subscription products and base plans, RevenueCat Android app/public SDK key,
service account/Play API access, RTDN/webhook flow, EAS submit credentials, Data
Safety and account-deletion URL, notification assets, and approved Health Connect
declaration. Base-plan IDs must contain `monthly` or `annual`; do not use opaque
IDs such as `p1y` because billing-cycle classification depends on those names.

An Android AAB can be built before every Console declaration is approved, but it
is not submission-ready until these external gates and a Play test purchase pass.

## Phase 4 — build and device sign-off

Build iOS and Android from the same approved `main` SHA using the production EAS
profile. Record each platform's exact EAS build ID, artifact, commit SHA and
runtime configuration. Submit by exact build ID only after its platform gates
are green.

On physical devices, test at least:

- clean install, email/password sign-in, password reset/deep link and account
  deletion path;
- free account limits and preserved existing account data;
- paywall contents, monthly and annual product mapping, purchase, restore,
  cancellation/expiry sync and duplicate-webhook idempotency;
- RevenueCat entitlement -> webhook -> `user_subscriptions` -> role/limit state;
- reviewer coach invite/demo path;
- iOS HealthKit and Android Health Connect permission, read/write and unavailable/
  denied states;
- Android back navigation, keyboard/edge-to-edge screens and notifications;
- Mealprint and the launch-runbook regression paths.

Use store sandbox/licence-test accounts. Verify both one monthly and one annual
product per platform plus entitlement mapping across all six tiers; do not spend
real money merely to prove the rail.

## Phase 5 — submissions and Apple response

Only after the evidence above is green:

1. submit the exact iOS build and attach the six IAP groups/products required for
   review;
2. place the Android build in the appropriate Play testing/release track once
   Play verification and declarations permit it;
3. prepare the App Store Connect response below for Brad to approve and send.

Draft, adapting only to facts actually proved:

> Hello App Review,
>
> We have submitted a new build that resolves both review items. For Guideline
> 2.1(a), the review notes now include the working coach demo/invite path and
> code: `[ENTER SECURELY IN APP STORE CONNECT — DO NOT COMMIT]`. For Guideline
> 2.1(b), all in-app subscription products shown in the app are now configured,
> available for review, and mapped to the app's current RevenueCat offering. We
> verified purchase and restore in the App Store sandbox on this submitted build.
> Please let us know if any further access or detail is required.

Do not claim Android work in the Apple response unless it directly explains a
change visible to Apple review.

## Required handoff evidence

Return a compact gate table containing: gate, environment/platform, evidence,
result, and remaining owner/action. Include the approved account mutation plan
and post-change checks without personal identifiers; migration/seed results;
RevenueCat/store product mapping; exact EAS build IDs and SHA; device test
results; submission IDs/status; and the final unsent Apple response.

Stop and ask Brad if live state differs from this brief, an unknown production
account exists, a destructive operation becomes necessary, store agreements or
declarations are blocked, product mappings differ, or any purchase/webhook test
fails.
