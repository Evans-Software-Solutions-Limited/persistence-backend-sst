# GO-LIVE-FINAL · Brief 2 — Launch & lockdown (the final 4)

_Authored 2026-07-16. This is the go-live runbook: the last four to-dos that line up into
one production push. Most of this is **operational** (App Store Connect, RevenueCat, GitHub
settings) — Brad executes it; an agent can only help with the code-adjacent bits (eas config,
CI checks) and must not touch store/account/repo settings without an explicit go-ahead._

**Hard dependency:** the **IAP DB uniqueness index (Brief 1, Part B / spec-12.13) must be
merged and on prod before step 2's IAP sandbox sign-off.** Do Brief 1 Part B first.

Order: **12.13 (Brief 1) → 12.10 assets → 12.11 pre-launch verification → 12.12 submission →
repo lockdown.** Lockdown can happen any time after submission is filed (or before — see the
Actions-minutes caveat).

---

## 1 · 12.10 — App Store / Play Store assets & metadata

Currently `todo`. All of this lives in App Store Connect (iOS) and Play Console (Android) —
none of it is in the repo.

- **Screenshots** — iPhone 6.7", 6.5", 5.5"; iPad 12.9" (only if the iPad build is submitted —
  note tablet layout is deferred, M15, so decide whether iPad is in the v1 submission at all).
  Capture from an EAS build on device/simulator against **prod** data.
- **App icon** — all required sizes (Expo generates most from `app.config.ts` / the icon
  asset; confirm the 1024² marketing icon is present).
- **Marketing copy** — name, subtitle, description, keywords, promotional text, support URL,
  marketing URL. (Privacy policy URL + App Privacy labels are already DONE — the Sentry/privacy
  sprint filed them; the tracker's blockers card is empty.)
- **Age rating** questionnaire (both stores).
- **Demo / reviewer account** — a real account seeded on **prod** with representative data
  (a workout or two, a logged session, a nutrition entry) so Apple/Google reviewers can
  exercise the app without signing up. Record its credentials for the reviewer notes (step 2).
  ⚠ Do NOT commit these credentials anywhere — they go in ASC/Play reviewer-notes fields only.

_Agent help available:_ generating marketing copy drafts, or a screenshot-capture checklist
per device size. The uploads themselves are Brad's.

---

## 2 · 12.11 — Pre-launch verification

Currently `todo`. The final checklist pass before filing.

- [ ] **All CI green on the release commit** — typecheck, lint, prettier, build, unit
      (coverage ≥90%). (An agent can confirm this on demand.)
- [ ] **IAP DB uniqueness index (12.13) merged + on prod** — prerequisite for the next line.
- [ ] **IAP sandbox sign-off (the launch gate from the 2026-07-14 decision):** on a **prod**
      build with Apple sandbox testers, buy **each** purchasable tier (premium + individual
      trainer), and confirm the entitlement syncs: RevenueCat webhook → prod backend →
      `user_subscriptions` upsert → app unlocks the tier. Staging IAP was deliberately deferred
      (staging keeps the prod RC key; purchases aren't exercised there) — sandbox testing is
      done against the **production** build/RC project. Confirm no duplicate `user_subscriptions`
      rows appear (this is exactly what 12.13 guards).
- [ ] **RevenueCat + ASC product wiring finished** — the 12.9 residual: register the product
      IDs in App Store Connect and complete the RC dashboard product/offering setup. RC webhook
      URLs are already known: prod `https://api.persistence.evans-software-solutions.com/revenuecat/webhook`.
- [ ] **2FA on the App Store Connect account** (Apple requirement).
- [ ] **Reviewer notes prepared** — demo account creds (from 12.10), a note that the app is
      subscription-gated and how the reviewer reaches gated features, and any sign-in-with-Apple
      note (native Apple auth is used).
- [ ] **Demo-account E2E on device** — walk the core athlete flow end-to-end on the prod build
      (sign in → log a session → nutrition → subscription) once more.

---

## 3 · 12.12 — Submission

Currently `todo`. `eas submit` for iOS + the Play submission pipeline; coordinate both reviews.

- **iOS:** `eas submit -p ios --profile production`. The staging ASC app id is
  **6790912063** (bundle `com.bradleyevans96.persistence.staging`); the **prod** ASC app id +
  bundle need to be confirmed and wired into `eas.json` `submit.production.ascAppId` (the
  staging one is already set under `submit.staging`).
- **Android:** Play Console submission (internal testing → closed → production track as you
  prefer). Confirm the service-account json for `eas submit -p android` is configured.
- Submit, then respond to any reviewer feedback. Keep both platform reviews moving in parallel.

_Agent help available:_ verifying/filling the `eas.json` submit block, confirming the build
profile, and pre-flighting `eas build`/`eas submit` command syntax. The actual submit + review
correspondence is Brad's.

---

## 4 · Repo lockdown — make it private & hidden

**Only one Persistence repo is public: `Evans-Software-Solutions-Limited/persistence-backend-sst`**
(0 forks). The siblings `persistence-mobile` and `persistence-backend` (legacy) are **already
private**. So "make the repos private and hide them" = privatize this one repo. (If you also
want the unrelated public org repos — `divvy-up`, `spriggle`, `axel-saas`, `lettingsops-api`,
`ai-data-room` — private, that's a separate call; they're not Persistence.)

**Command (Brad runs — this is a settings change I won't make without an explicit go-ahead):**

```bash
gh repo edit Evans-Software-Solutions-Limited/persistence-backend-sst --visibility private --accept-visibility-change-consequences
```

To also reduce discoverability further, optionally archive it AFTER launch/last commit
(`gh repo archive …` makes it read-only — only do this once you've stopped shipping):
don't archive pre-launch, you're still merging.

### ⚠ Caveats before flipping to private — read these

1. **GitHub Actions minutes stop being free.** Public repos get **unlimited** Actions minutes;
   private repos are **metered** against the org plan's monthly allowance. This repo runs CI on
   every PR + a `supabase db push` + SST deploy on every merge to `main`, plus scheduled crons —
   that's a lot of minutes. Check the org's plan/allowance first, or CI/deploys may start
   failing on quota mid-launch. This is the single biggest reason to time the flip carefully
   (consider doing it **after** submission, when merge velocity drops).
2. **Secrets are already safe** — the project uses GitHub Actions secrets + SST Secret bindings,
   nothing is file-committed (verified pattern). Private changes nothing here.
3. **Inspector-Brad CI action** — still fine on private (Brad fires it manually).
4. **Stars/watchers are lost** and the public URL 404s for anyone not a collaborator. With
   0 forks there's nothing to strand.
5. **Reversible but noisy** — you can flip back to public later; you just lose the social
   counters. Not a data-loss operation.

### Recommended timing

Flip to private **after** submission is filed (step 3), so the launch-week CI/deploy burst
runs on free public minutes, then lock down. If you'd rather lock down _now_ for secrecy,
confirm the org Actions allowance covers the remaining launch CI first.

---

## Dependency graph (the "line-up")

```
Brief 1 Part B (12.13 IAP index)  ─┐
                                   ├─► 12.11 IAP sandbox sign-off ─► 12.12 submission ─► repo lockdown
12.10 assets ──────────────────────┘
Brief 1 Part A (a11y walkthrough) ── independent, do any time before 12.11 sign-off
```

Everything except the a11y walkthrough (Brad, on device) and the two agent-implementable code
bits (12.13 index; `eas.json` submit wiring) is App Store Connect / RevenueCat / Play Console /
GitHub-settings operational work that Brad drives. Hand me any code-adjacent slice and I'll
take it; tell me explicitly when you want the repo flipped private and I'll run the `gh` command.
