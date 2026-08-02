# Project memory · persistence-backend-sst

**Canonical state ledger. Read at session start; update before ending a session.**

Older sessions live in [`STATE-ARCHIVE.md`](./STATE-ARCHIVE.md) (2026-07-24 and
back). This file keeps the durable facts, the gotchas that still bite, the open
items, and the four most recent sessions. Trimmed 2026-07-27 from 1554 lines.

If anything here contradicts `git log --oneline -30`, the git history wins —
say so and fix this file.

## Current state (2026-07-31)

- **⚠ APP STORE: build 1.0 (39) REJECTED under Guideline 4 (Design)** — the Sign
  in with Apple button used app-drawn logo artwork. Fixed on **PR
  [#340](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/340)**
  (`claude/signin-apple-design-fix-78rvv9`, see § Last session). Needs a new
  build + resubmission once merged.
- **⚠ PR #337 is MERGED but UNRELEASED — production still has the SQLSTATE 23514
  session-rating bug.** `c8a0b6d` sits above the latest tag
  `persistence-v1.10.0` (`1ad9caa`). Shipping it needs a release PR + prod
  deploy. An Apple reviewer tripped a production Sentry error on 2026-07-30
  22:26 UTC while prod was unpatched; whether it is this error is UNVERIFIED
  (Sentry connector was down — see § Last session).
- **Sentry production hotfix — MERGED to `main` 2026-07-30 as `c8a0b6d`
  (PR #337), NOT yet in any release tag.** The shipped
  mobile app asks only for a 1–10 difficulty rating but serializes it into both
  `sessionRating` and `difficultyRanking`; production's legacy
  `session_rating` column has a 1–5 check, causing SQLSTATE 23514 for answers
  6–10. All backend session record paths now persist only
  `difficulty_ranking`; `sessionRating` remains a deprecated 1–10 wire alias
  for installed clients. The PATCH path normalizes the alias too. No migration
  or mobile rebuild is required. Verified with a sensitive repository
  regression test, 71 focused tests, prettier, forced typecheck, lint, build,
  and forced full unit suite (19/19 tasks).
- **Loadout Phase 2's SCREENS + Phase 3's scan — MERGED via PR
  [#339](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/339)**
  (2026-08-02, off `main` @ `c7ad458`). Supersedes **#328**, which should be
  closed; the mirror branch `claude/pr-339-review-ci-7f7ydu` is stale too.
  Inspector Brad **clean @ `61698f8`** after 6 sweeps / 22 findings, all 5 CI
  checks green, 1 × 🟢 chipped (replace-path parent-404 gets the saved-setup
  copy — the mirror of a create-path nuance already fixed; the clean fix is a
  distinct `PARENT_NOT_FOUND` backend code, which also deletes the `isReplace`
  param).
  - **⚠ NEXT ACTION: the post-merge staging deploy is the first time the mobile
    client and the API agree — re-run the device pass once it lands.** Until
    #339, `PUT /workouts/:parentId/variations/:variationId` did not exist on
    staging at all, so every device run to date tested a mismatched pair. See
    § Loadout (spec-21) for the full feature status.
  - **⚠ The first cut of #339 was rebased from a STALE snapshot of #328 and
    silently dropped `edeb93f`'s fixes** — five files' changes were missing
    entirely (`exercisesSubstitutesHandler` + its test, `exerciseRepository` +
    `exerciseRepositoryLoadout.test.ts`, `.env.example`) along with three
    in-file guards in `LoadoutFlowContainer` (`saveRunRef`, `gymCreateKey`, the
    undecided-`intensity_mismatch` drop filter). **The CI failure was NOT the
    only problem, and the green-after-one-fix state was misleading**: the
    typecheck error was real but shallow, and fixing it alone would have merged
    a PR missing eight Inspector-Brad fixes. The branch was rebuilt from
    `edeb93f`'s content onto `c8a0b6d` instead. **LESSON: when a PR is "a
    rebase of another PR", diff the two branches' CONTENT — a green pipeline
    says nothing about whether the rebase captured the source branch's head.**
  - **The load-bearing loss was `EMPTY_EQUIPMENT_CONTEXT`** on the create AND
    replace variation handlers. Without it an empty kit left
    `containmentContext.length > 0` false, so **equipment containment was
    SKIPPED entirely and `EQUIPMENT_NOT_AVAILABLE` could never fire** — any
    exercise saveable against any kit, i.e. the guard the whole review step
    exists to enforce, silently absent. It would have merged looking green.
  - The 2026-07-30 CI failure itself was a real merge-state type error: current
    `main` removed the Stripe `Adapters.payments` rail, while five Loadout-only
    test fixtures still supplied it. Those stale fixture properties are removed.
  - **Gates after merging current `main`:** forced typecheck 8/8, build 13/13,
    forced full-workspace unit tests, full mobile test 466 suites / 5,528 tests,
    focused affected mobile suites 5/5 (150 tests), focused backend 90 tests,
    tracked-file Prettier/diff checks clean, and mobile/core ESLint zero errors.
    Whole-tree Prettier/lint remain blocked only by unrelated untracked
    `.agents/skills/sst-resource-change/SKILL.md` and
    `microservices/core/probe-steps.ts` (four `no-explicit-any` errors).
  - **Local Inspector Brad follow-up:** the first sweep found and this branch now
    fixes eight edge cases: Loadout is available on every readable parent
    (AC-1.2), undecided intensity mismatches are actually dropped, swap search
    covers the visibility-scoped pool and reports slicing, explicit empty kit
    snapshots 400 on create/replace, stale gym-create/save completions cannot
    mutate a newer flow, workout-A variations never paint under workout B, and
    failed saved-gym deletes show an actionable error. The locked-card tests now
    wait for their async entitlement verdict before pressing, removing the one
    full-suite timing failure exposed under parallel load. A second sweep found
    and this branch now fixes three more boundary cases: saved-gym creation is
    keyed by name as well as kit, substitute name search runs server-side before
    the 400-row cap, and create/replace reject every empty equipment context
    (including omitted snapshots and empty saved gyms). The final closed sweep
    also aligned punctuation tokenisation across the picker and repository
    (`bench-press` remains visible after the debounced response) and returned
    `INSPECTOR_VERDICT: CLEAN`.
  - The local Claude agent (`~/.claude/agents/inspector-brad.md`), Codex agent
    (`~/.codex/agents/inspector-brad.toml`) and manual GitHub workflow
    (`.github/workflows/claude-review.yml`) use the same impact-graph review
    contract. The CI action remains human-triggered only; Codex did not fire it.
  **NOT device-verified** — that is the review Brad asked for and it needs an EAS
  dev build against staging. The PR body carries a ~40-item checklist. This is the
  first user-reachable Loadout surface.
  - ⚠ An entitled test account needs a RevenueCat **promotional entitlement** —
    `premium_plus` is still `is_active = false`, so there is no purchasable card.
- **2026-07-30 follow-ups (originally `b9bdeba7` on #328) are carried in #339's
  squashed commit.** Saved setup
  detail now offers **Re-adapt** against the
  ROOT workout; `PUT /workouts/:parentId/variations/:variationId` atomically
  replaces the owned variation's metadata + exercise rows while preserving its
  id, `created_at` and session history. Every save freezes the server-resolved
  equipment snapshot. Variation summaries include the linked gym's current kit,
  so exact set comparison can flag equipment additions/removals (order and
  duplicates ignored). Review exercise names push the normal exercise-detail
  page without losing flow state. Workout detail itself is now a normal pushed
  page; temporary filters, create/edit and active-session steps remain
  intentionally modal.
  - **Gates:** typecheck 8/8, build 13/13, full test 19/19 (mobile 467 suites /
    5,561 tests), focused backend 128 tests and focused mobile 256 tests. New
    replacement handler: 100% lines/statements/functions, 97.77% branches.
    Changed-file Prettier + ESLint are clean. Whole-tree Prettier/lint are
    blocked only by unrelated untracked `.agents/skills/sst-resource-change/SKILL.md`
    and `microservices/core/probe-steps.ts` (four `no-explicit-any` errors).
  - **Visual pass:** current staging simulator workout detail remains correctly
    laid out as a pushed page. Re-adapt, gym-change and review drill-in states
    are covered by presenter/container render tests; the OS custom-scheme
    confirmation prevented non-interactive navigation into the saved variation
    for an additional device screenshot.
- **Last CODE change on `origin/main` = `f0e8929`** (PR #326, Loadout **Phase 3
  equipment scan + Phase 2 foundation**, merged 2026-07-27, branch deleted). Released
  to production: **v1.8.0**.
  - Stated as the last code change rather than the literal `HEAD`, because a
    ledger update is itself a commit — quoting the head sha here guarantees this
    line is one commit stale the moment it lands. `git log --oneline -20` is the
    authority for the head; this line tells you what the last SUBSTANTIVE change
    was, which is the thing worth knowing.
- **⚠ Production is one release behind `main`, and the gap is now much bigger
  than migrations.** Open release PR
  **[#319](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/319)
  (v1.9.0)** is the only thing that ships it. Merging it publishes the release;
  the prod deploy then migrates and deploys.
  - **Migrations pending on prod: exactly Loadout Phase 0's four.**
    `20260720230030_data_sharing_consents.sql` also shows in the diff but is
    ALREADY applied (present at tag `persistence-v1.8.0`); only its comment header
    changed in #317, and `supabase db push` keys on version, not content, so it
    will not re-run. **Phase 1 added NO migration.**
  - **⚠ #319 now also carries Loadout Phase 1's engine and its two new
    endpoints** (`POST /workouts/:id/loadout/preview`,
    `GET /exercises/substitutes`), plus Phase E's eval scripts. It stopped being
    "the Phase 0 migration carrier" the moment #322 merged. Nothing on it is
    user-reachable — no mobile surface calls either endpoint yet, and `loadout`
    is gated on `premium_plus`, which is seeded `is_active = false` — but the
    Lambda will be serving them.
  - ~~**⚠ Phase 1's model path needs Haiku 4.5 in the PRODUCTION Bedrock
    account.**~~ **RESOLVED — Brad confirmed both model ids granted and complete in
    prod, 2026-07-27** (§ Ops / launch).
- `premium_plus` / `loadout_access` **are** already on prod (verified present at
  tag `persistence-v1.8.0`). The tier row is deliberately `is_active = false`.
- Feature state: coach mode complete; spec-19 Programs shipped; nutrition (incl.
  Snap AI) shipped; consent (spec-28) + read-audit shipped; coach↔client
  offboarding shipped; **Loadout Phase 0 (data model), Phase E (eval) and
  Phase 1 (adaptation engine) are ALL MERGED to `main`. Phase 2 (mobile athlete
  flow, with the Phase 3 scan inside it) is next** — it needs the design handoff
  at `~/Downloads/Any Gym/project/`.
- **Loadout's athlete flow is now COMPLETE end to end on the branch above** —
  entry card, collect, scan, manual picker, adapting, review with per-row swap,
  save / save-and-start, success, and saved-gym management in Profile. What
  remains before it is real: merge, and a device pass.
- **On `main`, Loadout is BACKEND-COMPLETE for the single-workout athlete flow,
  INCLUDING the equipment scan, and still has ZERO user-facing surface.** Phase 2's foundation
  (ports/adapters, the pure review-copy + save-path logic, the step machine) is
  **MERGED to `main`** (#326), but **no screen exists**, so nothing in
  `packages/mobile` yet calls the preview, the substitutes feed or the scan. The
  screens (T-2.2…T-2.9, T-3.4) are what make the feature exist for a user, and they
  are the NEXT slice — to be reviewed in a local dev build against the staging
  backend (Brad, 2026-07-27).

## Verified facts

- SST 3.19.3 (Ion). Workspaces: `packages/` (api-utils, db, mobile, seed, web) +
  `microservices/core`.
- **Database is Supabase Postgres reached with `postgres.js` over TCP** — NOT
  Neon, NOT `neon-http` (that driver speaks Neon's proprietary HTTP protocol and
  produced opaque 500s here; never reintroduce it). Transaction-mode pooler on
  **:6543**, `prepare: false` mandatory for pgbouncer.
- Supabase projects: staging `nxkhlrvjxotyjulodxzk`, prod `opcvjypsoivaxerahbal`.
  (The old `dfeyebgdktfteqlacmru` is dead and 401s.)
- **Production migrations are AUTOMATIC**: `production-deploy.yml` runs
  `supabase db push --linked` (after a `--dry-run`) on `release: published`, and
  migrates **before** `sst deploy`. Do not hand-apply. Staging auto-applies on
  merge. ⚠ Migrate-then-deploy is only safe for **additive** migrations — a
  drop/rename leaves the old Lambda on the new schema for the deploy window and
  needs expand/contract across two releases.
- AWS profiles: `ess-dev` (dev/staging), `ess-prod` (production), both via the
  `ess-dev` SSO session. Dev account `111315405717`, prod `465891279888`.
- **Bedrock model access is PER-ACCOUNT and PER-MODEL.** Haiku 4.5 and Opus 4.6
  are granted in both; **Opus 5 is UNGRANTED in prod**. Staging green says nothing
  about prod. `eu.anthropic.claude-opus-4-6-v1` looks malformed (no `:0`) but is
  valid. **Never use a `global.` inference profile** — it routes outside the EU
  and breaks the DPIA's data-residency commitment.
- Mobile env source of truth = `packages/mobile/eas.json` `build.*.env`.
- Legacy mobile app (the port reference) at sibling path `../persistence-mobile/`.
- Slack progress channel `#brad-claude-agents` = `C0ATYL6T11V`.
- `specs/milestones/ROADMAP.md` § Phase status lags. This file + `git log` win.

## Active gotchas — these will bite

- **Turbo caches `typecheck` AND `test:unit`.** `supabase/migrations/**` is not an
  input to `@persistence/core#test:unit`, so editing a migration leaves a stale
  green. Run `TURBO_FORCE=true` on both before pushing. Cost two red CI runs.
- **The staging deploy runs `prettier --check .` over the whole tree**; the PR
  prettier job is change-scoped only. A green PR does not mean a green deploy.
- **`bun run test:unit` is NOT a typecheck.** Run `tsc` separately, always.
- **Never interpolate a JS array before a `::uuid[]` cast in a Drizzle `sql`
  template.** ``sql`${ids}::uuid[]` `` renders `($1, $2)` — a Postgres ROW
  constructor — and dies at execution: `cannot cast type record to uuid[]` with
  2+ ids, `malformed array literal` with one. Use the `uuidArray()` helper in
  `exerciseRepository.ts` (`ARRAY[$1, $2]::uuid[]`, still one placeholder per
  id). This 500'd Loadout's preview on device 2026-07-28, and two of the four
  call sites had carried the bug since 2026-04-20 without anyone noticing —
  the mobile exercise library filters locally from its SQLite cache and never
  sends `targeted_muscles_any`/`equipment_any`, so nothing had executed them.
  **A green render test is not proof:** `exerciseRepositoryLoadout.test.ts` had
  rendered the SQL via `PgDialect` and asserted the *broken* shape, pinning it.
  `exerciseRepositoryArrayPredicates.test.ts` now bans the paren form
  mechanically and exercises both arities.
- **`equipment_types.description` is in `schema.ts` but NOT in the live DB.** A
  bare `select()` 500s. Project columns explicitly. Same class of drift:
  `listActive()` on `subscription_tiers` must omit young columns.
- **`assertEntitlement`'s catch-all** — `if (feature !== "create_workout") return
  { allowed: true }` — means any new feature name added without an explicit
  routing line **silently allows everyone**, with no type error.
- **A Bedrock failure is logged nowhere**, and both AI surfaces collapse every
  non-429 error into "Couldn't estimate that — try rephrasing"
  (`QuickAddSheetContainer.tsx:267`, `SnapAISheetContainer.tsx:100`). If AI
  "mysteriously stops working", that is why. The fix exists on the **closed**
  branch `claude/ai-model-preflight` (HEAD `844fd01`, deliberately unmerged per
  Brad) — cherry-pick it, don't rebuild it.
- **`@persistence/core#test:unit` flakes under parallel load** — `returns 401 when
  unauthenticated` tests in `application/nutrition/ai/*` time out at vitest's
  5000 ms. Passes in isolation (99/99). Re-run a single-suite failure alone before
  chasing it.
- **`packages/web`'s Eden `treaty<CoreApi>` sits at TS's instantiation ceiling** —
  backend route changes can flip TS2589/TS2578 in web with no web file touched.
  Run a full-workspace typecheck.
- **Reusing a parameterised `sql` expression in SELECT + GROUP BY** gives
  different bind slots → Postgres 42803. Group by ordinal.
- **The mocked-`getDb` blind spot**: unit tests mock the DB, so SQL bugs ship
  green. Render the real `WHERE`/projection via `PgDialect` in a test.
- **⚠ A literal U+0000 in a `.tsx` file passes EVERY gate and breaks git.**
  Prettier, ESLint, Babel and `tsc` all accept it; git's binary heuristic then
  reports the file as `Bin 0 -> N bytes`, GitHub renders it as "Binary file not
  shown", and it cannot be 3-way merged or rebased. One reached a commit on the
  Phase 2 branch (an array-separator string) and only Inspector Brad caught it.
  Check with `file <path>` — "data" instead of "text" is the tell.
- **⚠ A NEW heavy container test suite needs `jest.setTimeout(15_000)`/`(20_000)`,
  and CI is where you find out.** Nine existing suites already set it
  (`ProfileContainer`, `ExerciseListContainer`, `SubscriptionSelectionContainer`…)
  because a case that mounts the real Tamagui provider + a React Query client +
  gorhom sheets costs ~200 ms locally and ~7× that on a runner sharing itself with
  459 other suites — past jest's 5 s DEFAULT. **The tell is the SUITE's duration,
  not "it passes in isolation"**: Loadout Phase 2's flow suite was 7.6 s locally
  and 50.76 s on CI. Two red runs were spent chasing individual tests before
  reading that number.
- **⚠ Testing Library's `fireEvent.press` honours `accessibilityState.disabled`,
  the device honours the `disabled` prop.** So a component carrying both — which
  it should — will always report one of them as a SURVIVING mutant, because each
  covers for the other in exactly one environment. Annotate rather than chase, and
  do not "simplify" by deleting one.
- **A store action named `use*` trips `react-hooks/rules-of-hooks` at every call
  site** ("cannot be called inside a callback"). `loadout-flow`'s were renamed
  `selectGym` / `selectEquipmentIds` for this. Don't name zustand actions `useX`.
- **Worktree cwd drifts mid-session** and edits land on the wrong branch. Prefix
  every tool path with the worktree path; re-check `pwd`. Never `git checkout --`
  a file with uncommitted work.

## Lessons learned

- **Commit with explicit pathspecs and inspect `git diff --cached --name-only`.**
  `git commit` takes the whole index — pre-staged WIP rides along (caused #159;
  nearly swept Brad's untracked `docs/app-store/` + `marketing/` twice since).
- **Mutation-test every new guard — it is the only thing that catches a test that
  cannot fail.** Repeat offenders: asserting a property of your own mock;
  asserting the mock's return instead of the SQL projection; using an error shape
  the driver never produces; an assertion both branches satisfy.
- **A default standing in for "not applicable" is a value that cannot fail.** An
  eval metric returned `1` for plans with nothing to measure and was averaged in,
  misstating three published figures. Use `null`.
- **When catching a Postgres error by SQLSTATE, walk `.cause`** — Drizzle puts the
  code there, not on the thrown error. A duplicate-name 500'd instead of 409'ing.
- **If a doc quotes a measurement, ship the command that regenerates it.**
  Hand-derived figures drift from the data (a cost table used the wrong
  denominator).
- **Deciding a spec question means sweeping every doc that assumed the old
  answer** — flipping D7 left five surviving contradictions, the worst in the
  section another spec mirrors. Grep for the old premise; don't just add the new
  section.
- **When de-claiming a feature, trace every channel it reaches the user through**
  — the same string lived in an unreachable code branch, hardcoded JSX, and a
  seeded DB `description` column that TypeScript cannot reach.
- **Don't take a single Inspector Brad sweep at face value on a "this doesn't
  exist" claim** — grep for the endpoint. One sweep wrongly flagged a shipped
  feature as unbuilt.
- **Cap Inspector Brad at two sweeps + one CLOSED verification pass** ("confirm
  these N items, findings only"). Five open-ended sweeps on one PR burned a large
  share of a context window.
- **"Passes in isolation" diagnoses nothing on its own.** It is true of a
  load-sensitive assertion, a suite over its time budget, AND a genuine race —
  so it cannot distinguish them, and treating it as an all-clear cost two red CI
  runs on the Phase 2 PR. Both real causes were only visible in numbers next to
  it: a two-round-trip chain racing `waitFor`'s 1 s default (which was hiding a
  real UX wart — a deleted row reappearing until the server answered), and a
  suite at 50 s on CI versus 7.6 s locally.
- **A mutation surviving has three possible causes, and only one is a test gap.**
  Either the test is missing (write it), or the branch is genuinely dead (delete
  it), or two layers legitimately guard different channels (annotate it). The
  Phase 2 sweep hit all three; guessing wrong in either direction costs real
  quality — a test that cannot fail, or a deleted safety net.
- **Ask recon agents for conclusions with `file:line` pointers**, not quoted code.

## Open items

### DECIDED by Brad 2026-07-27 — Loadout Phase 1. Do not re-raise.

Swept through code, `infra/api.ts`, `requirements.md` AC-10.2 and `tasks.md`
T-1.9 — no doc still describes these as open.

- **Re-map daily ceiling = 30/day.** `AI_LOADOUT_REMAP_DAILY_LIMIT` is no longer a
  placeholder. At $0.0057/adaptation that is ~$0.51/user/month at realistic use and
  ~$5.13 if an abuser consumes the lot, against £29.99 — abuse control, not unit
  economics, and deliberately generous because the bad failure is a real athlete
  hitting it mid-session.
- **Re-map retry = keep `createWithRetry`** (12 s × 2). The retry path is only
  reached after an actual first failure, where a ~24 s worst case beats failing
  outright. ⚠ **NOT abandoned:** the single ~20 s attempt still has to be built for
  the scan (T-E1.6), and this decision can be revisited once that harness exists
  and is measured.
- **A Bedrock failure stays a 503** — no silent fallback to the § 6.2 ranker.
  Ranker-only output is what the bake-off rejected 4-50 (`Barbell Deadlift → Atlas
  Stones` in a bands-only context), so a visible outage beats a quietly worse plan
  under a Premium+ badge.
- **Equipment-scan ceiling = 6/day** (Claude recommended, Brad accepted
  2026-07-27 — "go with your recommendation, calculated against all costs from one
  user vs their subscription"). NOT design § 8.1's proposed 10, and the 10's
  reasoning was the flaw: it was analogised from Mealprint's daily-use surfaces,
  but **a scan is a once-per-GYM action** because `saved_gyms` persists it. At
  $0.0272/scan, 6/day is ~$4.90/user/mo worst case — parity with the re-map's
  $5.13, so both Premium+ AI surfaces together are ~$10/mo against ~$32 net.
  10/day would have been $8.16 for one endpoint. The asymmetry with the re-map's
  30 is deliberate: hitting this cap blocks no workout (AC-2.1/AC-2.2 are the
  floor, not fallbacks), whereas the re-map has no alternative path. Revisit if
  § 8.1's 640 px downscale is ever measured.

### ⚠ The Lambda timeout was 20s, not 30s — FIXED, and it had bitten Snap AI already

**`coreAPI.route("$default", …)` set no `timeout`, and SST defaults a function to 20
seconds** (`.sst/platform/src/components/aws/function.ts` — `timeout ?? "20 seconds"`).
Every AI adapter comment in the repo was budgeting against the **30 s API Gateway
integration ceiling**, which was never the binding constraint. Found by Inspector
Brad on the Loadout Phase 2/3 sweep; `infra/api.ts` now sets
`timeout: "29 seconds"` explicitly.

Two consequences, and the second is the one that costs money:

- **`createWithRetry` is 2 × 12 s = 24 s, so on the Snap AI photo path the RETRY
  could never finish** — the function was killed ~8 s into the second attempt. That
  is a **pre-existing latent bug on `main`**, not something Loadout introduced.
- **A Lambda hard-kill does not run the handlers' `finally` blocks**, so **no
  `ai_usage_log` row was written for an inference Bedrock had already performed and
  billed.** The request escaped the per-user daily ceiling entirely. At $0.0272 a
  scan that is the most expensive failure mode in the feature.

⚠ **Do not lower that route timeout without re-deriving `CLIENT_TIMEOUT_MS` and
`EQUIPMENT_SCAN_TIMEOUT_MS`** — both docstrings now say so.

### ⚠ Daily AI ceilings are not concurrency-safe — recorded, deliberately unfixed

`countForUserToday` reads BEFORE the inference and the usage row is written after,
so N requests inside that window all see the same count and all proceed: ~100
parallel POSTs at count 0 yield ~100 inferences. On the scan that is ≈$2.72 in one
burst against a ceiling meant to bound $4.90/month.

**Left as-is on purpose.** This is the #156 pattern that **all seven** AI endpoints
share, and making one transactional would leave it enforcing a different contract
from its six siblings. The real fix belongs in `AiUsageLogRepository` for all of them
at once — a reserve-then-reconcile row, or a conditional insert. Exposure needs a
deliberate parallel burst from an authenticated, entitled, paying account.

### ⚠ Pricing vs AI cost — three tiers are theoretically underwater (2026-07-27)

**Run `bun run scripts/ai-cost-model.ts` for the live table. Do not quote figures
from here — quote the command.** The last time this was answered in prose
(2026-07-05, "~£7.30/mo worst case vs £12.99") it went stale twice without anyone
noticing, which is why it is now a tested script (`scripts/ai-cost-model.ts`, 34
tests) with the assumptions declared at the top.

At every reachable ceiling, every day, for 30 days — against net revenue (Apple
15 % Small Business + RevenueCat 1 %, £1 = $1.27):

- **`individual_trainer` (£14.99) is the MOST exposed tier at ~212 % of net.** Cause:
  `20260725194527_premium_plus_tier` granted `loadout_access` to all three trainer
  tiers, so a coach gets Loadout at £14.99 while an athlete pays £29.99 for it.
  **DECIDED by Brad 2026-07-27: LIVE WITH IT for now.** Loadout is a **Premium+**
  feature by intent; the trainer-tier grant is an accepted constraint, not the
  design. Coaches will eventually need *some* route to it (Phase 4 adapts a client's
  programme, which cannot work without one) but that is its own slice, and coaches
  are not expected to use the athlete flow normally. **Do not "fix" the migration**,
  and do not re-raise this as a cost finding — it is a known, accepted gap.
- **`premium` (£12.99) is ~167 %**, and **Loadout is not why** — it cannot reach
  either Loadout endpoint. **~55 % of its exposure is ONE endpoint: Recipes AI photo
  extraction** at 12/day × ~$0.0355, the most expensive call in the app. Nobody
  extracts 12 recipes from photos a day; that ceiling is the loosest thing we ship
  relative to its unit cost. Cutting it to ~4/day would halve the tier's worst case
  and cost no real user anything.
- **`premium_plus` (£29.99) is ~104 %** — i.e. the tier that adds the most AI is the
  *least* over-exposed of the three, because the price rises 2.3× while the added
  cost is ~$10. **The two Loadout surfaces total ~$10.03 and are the only MEASURED
  figures in the table.**
- `small_business` (50 %) and `medium_enterprise` (13 %) are comfortable.
- **TYPICAL use is 5–11 % of net on every paid tier (~$1.40–1.83/mo).** So none of
  this is a live margin problem — it needs a determined abuser hitting six or seven
  endpoints daily for a month while paying. It is a tail-risk and pricing-coherence
  finding, not an incident.
- **Infrastructure is negligible**: ~$185/mo fixed (Supabase/AWS/Expo/Sentry) plus
  ~$0.02/user marginal → **$1.87/user at 100 subscribers, $0.20 at 1,000, $0.04 at
  10,000.** Serving requests is not what this platform costs; AI inference is.

**⚠ SIX OF THE EIGHT UNIT COSTS ARE ESTIMATES.** Only the re-map ($0.0057) and the
scan ($0.0272) were measured against real Bedrock calls (Phase E). The nutrition and
Recipes AI figures are derived from declared token profiles, and **those surfaces are
the larger half of every exposed tier's total** — so the two headline percentages
above rest mostly on guesses. Also: the prices used are **Anthropic list, not
Bedrock partner prices**, which the eval itself flagged as unchecked.

Actions, in order of value:

1. **Measure the nutrition + Recipes AI unit costs** — from `ai_usage_log` (it
   already records per-inference byte sizes and duration; token counts would need
   adding) or off the AWS bill. Until then no tier's number is quotable.
2. **Decide the `individual_trainer` × `loadout_access` question** (Brad).
3. **Consider `AI_RECIPE_DAILY_LIMIT` 12 → ~4.**
4. **Register `AI_RECIPE_ESTIMATE_DAILY_LIMIT` in `infra/api.ts`** — it is currently
   unset and silently uses its code default of 30, so it is invisible to a cost
   audit of the env block where every other ceiling lives.
5. **Check Bedrock's actual prices** against the Anthropic list prices assumed.

### Brad's decisions — Loadout (spec-21), still open

- **Programme cap** — 120 workouts stands, but its rationale changed (it is now
  120 model calls, ~5 min, ~$0.69, not "nearly free").
- **Target transform** (`4×4-6 → 3×12-15` when the kit cannot load a strength
  row) — spec it as its own slice, or accept flag-only for v1 (AC-3.5b ships the
  flag either way).
- **Does the equipment scan still ship inside Phase 2**, or split so the re-map
  lands on measured ground first? (`requirements.md` § Open sequencing decision.)
- **~30 real gym photos** — to turn E1's provisional go into a real one; ideally
  with Brad-confirmed ground-truth labels rather than Claude's.
- ~~**A "Gym" tab inside Train**~~ — **RESOLVED 2026-08-02. It REPLACES the
  Profile · Account list; it does not complement it.** Brad: "i don't want it
  there." Built as a `Gyms` segment in the Train hub on branch
  `feat/loadout-gyms-train-segment` (PR raised 2026-08-02, NOT merged), with
  AC-7.2 rewritten and AC-7.2a/7.2b added plus design § 10.1. The Profile row, its handler, the `Stack.Screen` and
  the route file are deleted, so there is exactly one way in.

### Loadout — the Gyms segment slice (2026-08-02)

Saved-gym management moved from Profile · Account into a fourth **`Gyms` segment
in the Train hub**. Three things, not one:

1. **The segment**, alongside Training / Workouts / Exercises. `TrainSegment`
   gains `"Gyms"`, which widens `isTrainSegment` — the validator for the
   **device-global** key `persistence.train.segment`.
2. **⚠ Gym CREATION, which did not exist at all.** On `main`, `createSavedGym`
   had exactly two call sites and both were inside `LoadoutFlowContainer`
   (commit-time create + the save-time fallback). `SavedGymsContainer` was
   manage-only and its empty state told the user to go adapt a workout and tick
   "Save" — coherent for a footnote under Profile, a dead end for a hub tab on a
   new account. `useSavedGyms.create` already existed with no consumer.
   `editing.gymId === null` is the new-gym draft and shares the editor card, so
   the empty-kit block and the 409 name-taken field error hold on both paths.
3. **Shown-but-locked when unentitled.** ⚠ Locked is **not** a taster (design
   § 5.2): `GymsSegmentContainer` does not MOUNT `SavedGymsContainer` when the
   gate denies, and that non-mounting IS the enforcement, because `useSavedGyms`
   fetches on mount. There is a **third** body state — pending — because a TAB
   has no tap to swallow the way `WorkoutDetailContainer` does, so rendering the
   pitch during the cold-start `/subscriptions/me` round trip would show the
   paywall to a subscriber on every launch. And a **fourth**, stalled: that
   request has no client-side timeout, so a half-open socket never rejects and
   `isResolved` never flips.

**⚠ Two traps this slice hit, both worth carrying forward.**

- **`refetch()` does not reissue a hung FIRST fetch.** TanStack gates
  `cancelRefetch` on `state.data !== undefined`; with data undefined it returns
  the same pending promise and issues nothing — and undefined data is the only
  state a "Try again" is reachable from. `useLoadoutGate.refetch` has to
  `queryClient.cancelQueries(...)` first, for BOTH queries. A retry button that
  merely calls `refetch()` is decorative.
- **`Segmented`'s scroll gates were guesses about text metrics, twice.** First
  `width < 360`, then `options.length >= 4`; both left real devices clipping the
  trailing segment with no scroll path. It now always wraps
  (`flexGrow: 0` keeps a fitting track pixel-identical) — which put RN's
  **keyboard tap-capture on every consumer in the app**, so
  `keyboardShouldPersistTaps="handled"` is now load-bearing there. Note
  `MealPickerPresenter` was already a 4-option consumer inside three sheets.

Device-verified against staging: segment renders inset correctly, creating a gym
persists and appears in the collect step (the first `POST /saved-gyms` from
outside the adapt flow), the 3-option and 4-option tracks are unchanged. NOT
verified: the locked/pending/stalled states (the test account is entitled) and
the keyboard tap-through (the simulator has a hardware keyboard attached).

### Loadout (spec-21) — where the whole feature stands, 2026-08-02

**Merged: P0 (tier code), Phase 0, Phase E, Phase 1, Phase 2, Phase 3.** #339
was the last of those and closed the athlete flow. Nothing in Loadout is on an
unmerged branch any more.

**NOT built:** Phase 4 (coach programme adaptation, T-4.1…T-4.5) — not started,
zero code. Phase 5 (second engine) — judged unlikely on E2's evidence.

**NOT verified:** the athlete flow has never had a clean device pass. Every run
so far was a mobile build against a staging backend missing this PR's routes.
**#339's merge is what fixes that** — `deploy-staging.yml` fires on push to
`main`, so the deploy that follows the merge is the first time the client and
the API agree. Re-run the device pass after it lands, not before.

⚠ **`tasks.md` checkboxes lie in BOTH directions here.** T-P0.1…T-P0.11 and
T-E1.5…T-E1.7 are unticked but the code is present and merged
(`revenuecat/entitlements.ts`, `subscriptionsCreateHandler`,
`AI_EQUIPMENT_SCAN_MODEL_ID` in `infra/api.ts`, the `premium_plus` +
`loadout_access` migration). Verify against the tree, not the ticks.

**The one thing genuinely blocking consumer launch is ops, not code:**
`subscription_tiers.premium_plus` exists on staging at £29.99 with
`loadout_access = true` but **`is_active = false`**, so no athlete can buy it.
That is T-P0.10 — the ASC + RevenueCat product config, Brad's runbook, chat-only.

💡 **You do NOT need a RevenueCat promotional entitlement to device-test.**
`individual_trainer` (£14.99, active, purchasable) carries `loadout_access` and
is in `TIER_GRANTS_LOADOUT`, so a trainer account reaches the flow today. The
PR body's note about needing a promo entitlement applies only to testing the
consumer *paywall*.

T-2.2…T-2.9, T-3.4 and T-3.5's mobile half are all ticked, and `tasks.md`
§ "Landed in Phase 2's screens beyond the checklist" holds the architecture
decisions. Do not re-derive them; the short version:

- The flow is the **`/(app)/loadout` route** (`fullScreenModal`); the store is
  the STEP machine, not the navigation. The swap/scan sheets are siblings of the
  step inside that route so they layer above it. ⚠ Two earlier shapes were tried
  ON DEVICE and both broke — an absolute View sibling of the Stack rendered
  *behind* the workout detail (which is itself `presentation: "modal"`), and
  wrapping it in an RN `<Modal>` was worse: it froze the screen with an
  invisible presented modal eating touches. Do not "simplify" it back.
- `adapting` is bound to the request; the prototype's 1700 ms timer is absent.
- `others` is the incompatible list **only when a kit context was supplied**.
- The swap sheet's containment context is **`preview.equipmentTypeIds`** (the
  server-resolved kit), not the client's saved-gym row.
- **No taster meter** and **no price literal** — the upsell reads the catalog and
  renders correctly with no price, which is the state until `premium_plus` goes
  active.

**⚠ The one recorded follow-up: `/subscriptions/me` does not project
`loadout_access`,** so `useLoadoutGate` mirrors the migration's tier set
client-side (the 402 remains the real gate). Adding the column to
`subscriptionRepository.findForUser` + `MySubscription` + the mobile mirror is a
~4-line change and retires `TIER_GRANTS_LOADOUT`. Left out only because that
slice was mobile-only.

**⚠ BLOCKED ON PR #332, which is a separate branch.** Brad's device run hit a
500 behind "Couldn't adapt this workout": the `${array}::uuid[]` bug above, in
`ExerciseRepository.listAdaptationCandidates`. The fix was split out to
`claude/fix-uuid-array-predicates` (PR #332) at Brad's request so it can land
without waiting on this review — **this branch stays mobile-only.** Loadout
cannot work on device until #332 is merged AND staging is redeployed
(`deploy-staging.yml` accepts a `workflow_dispatch`).

**Also changed off the back of that run:** the "Save this gym for next time"
toggle now creates the gym when the user COMMITS the kit, not when the variation
saves. It used to be contingent on the adaptation succeeding, so a 503 / 429 /
dropped connection lost the named kit and every ticked chip. `save()` awaits the
in-flight create rather than racing it into a 409.

**Still to do on this branch:** device-verify on an EAS dev build against
staging using the PR checklist, then merge. Gates green
(prettier / typecheck 8/8 / lint 0-err / build 13/13 / test:unit 19/19),
2 IB passes clean — but the IB sweeps predate the backend fix and the
route conversion, so **one more sweep is owed before the PR**.

**⚠ The safe-area bug and the trap inside it — FIXED, and worth reading before
touching any inset in this app.** Brad's second screenshot showed the collect
step's header flush against the status bar, its title overlapping the clock — on
the same `LoadoutScaffold` that had rendered correctly inset one run earlier.

**`SafeAreaView` from `react-native-safe-area-context` is a purely NATIVE view
and never reads `SafeAreaInsetsContext`.** It measures its own window. That is
why every other screen in this app works despite there being **no
`SafeAreaProvider` mounted anywhere** — and why this route did not: it is a
`fullScreenModal`, which react-native-screens presents as its own view
controller, and the native measurement there came back zero. Intermittently,
which is the signature of a measurement race.

So adding a provider alone would have fixed NOTHING. The fix is both halves:
a `SafeAreaProvider initialMetrics={initialWindowMetrics}` on the route, and
`LoadoutScaffold` / `LoadoutSavedStep` switched to `useSafeAreaInsets()`, which
is the API that actually reads it. ~~`SavedGymsPresenter` deliberately keeps
`SafeAreaView` — it is an ordinary Stack screen, outside that provider, where the
native path works.~~ **No longer true from 2026-08-02:** the saved-gyms surface
moved into the Train hub as the `Gyms` segment, so `SavedGymsPresenter` is hub
BODY content and renders no `SafeAreaView` at all — `TrainHubContainer` owns the
chrome and has already applied `insets.top`.

**Still open, app-wide:** with no root provider, every `SafeAreaInsetsContext`
consumer OUTSIDE the Loadout route still reads zero — including `BottomSheet`
(`BottomSheet.tsx:96` documents the `?? 0` fallback), so sheet CTAs get no
home-indicator padding anywhere else in the app. One `SafeAreaProvider` at the
app root fixes it and changes the bottom inset of every sheet — a real
improvement, and not one to make inside a feature branch without a device pass.

### Data bugs — open, not blocking Phase 2's critical path

- **T-E.10: `Leg Press` and `Leg Curl` carry `equipment_required = '{}'`** because
  their seeded equipment names have no `equipment_types` row (`Leg Press Machine` /
  `Leg Curl Machine`) and `seedExercises.ts`'s `resolve()` drops unmapped names
  **silently**. Since `x @> '{}'` is always true, **a bands-only athlete keeps the
  leg press** — in the seeded "Lower Body" and "Full Body Starter" workouts, i.e.
  the first two a new account owns. Needs a data migration **and** a seeder guard
  that fails loudly. It is not an engine bug, and it makes Loadout look broken on
  the default workouts, so it wants doing before Phase 2 is device-demoed.
- **T-E.11: `movement_type` is NULL for all 2281 seeded rows.** Only worth a
  backfill if a deterministic-only engine is ever revisited (Phase 5); recorded so
  the absence is not rediscovered.

### Ops / launch

- **⚠ Triage the ~7 open Dependabot alerts (3 CRITICAL).** Needs Brad's browser
  session or a `gh` re-auth with `security_events` — the CLI cannot enumerate them
  (see § Dependabot above). Before the App Store submission; the repo is PUBLIC.
- ~~**Verify Haiku 4.5 + the Opus-class scan model in the PRODUCTION Bedrock
  account.**~~ **DONE — Brad confirmed 2026-07-27: both model ids are granted and
  complete in production.** That covers `AI_LOADOUT_REMAP_MODEL_ID`
  (`eu.anthropic.claude-haiku-4-5-20251001-v1:0`) and `AI_EQUIPMENT_SCAN_MODEL_ID`
  (`eu.anthropic.claude-opus-4-6-v1`), so Loadout has **no prod Bedrock grant
  blocker**. ⚠ The per-account lesson still stands for any FUTURE model id —
  `eu.anthropic.claude-opus-5` remains UNGRANTED in prod, and assuming otherwise is
  what caused the 30-day silent outage.
- **Merge release PR #319** — see Current state. It now ships Loadout Phase 0's
  four migrations **AND** Phase 1's engine + two endpoints, not just the
  migrations. Verify the prod Haiku 4.5 grant first (item above): after this
  release the Lambda serves a model-backed route.
- ~~**PR #321** (`claude/loadout-phase-e`)~~ — **MERGED** as `e2bc595`.
- ~~**PR #322** (`claude/loadout-phase-1`)~~ — **MERGED** as `1a7b956`.
- **Carried forward from the archived log, still open** (they lived in session
  entries rather than the head sections, so the trim would otherwise have buried
  them — all three also persist in `memory/MEMORY.md`): `POST /sessions/record` is
  **not idempotent** (duplicate sessions on retry) and stuck-`failed` sync mutations
  are silent (`project_sync_architecture_audit`); **`supportsTablet: true` with no
  tablet layout** plus a fixed 170 px carousel that clips
  (`project_responsive_layout_audit`); and invite-QR / expo-clipboard were never
  device-verified — they need a **fresh EAS dev build**.
- **`premium_plus` launch flip** — `UPDATE subscription_tiers SET is_active = true
  WHERE tier_name='premium_plus';` in its own migration, **plus** attaching and
  submitting the two ASC products, **only** at the Loadout launch build. The
  products exist but are deliberately unsubmitted (an IAP product shipped with a
  build that offers no way to buy it is its own rejection).
- **Confirm the Supabase Data API is explicitly off** — the staging check returned
  `PGRST002` (schema-cache) rather than a clean 404, consistent with disabled but
  not proof. Verify in the dashboard.
- **Marketing site branch was never PR'd or deployed** —
  `claude/persistence-marketing-landing-3987c2`. Gates + IB were clean at the
  time; the waitlist/founding-discount section is deliberately excluded.
- **PR #21** (14 April, AI PT spec pack) — open 3½ months. Close or merge.
- **spec-26 Mealprint** has its own 6 open checkpoints (see `specs/26-.../BRIEF`
  § 9): AnyMeal branding/trademark, suggestion-tier + taster, ceiling numbers,
  marketing-site Premium+ copy, allergen vocabulary + disclaimer sign-off, P3
  timing.

### Dependabot — ⚠ ~7 alerts OPEN incl. 3 CRITICAL, and the CLI cannot see them

**⚠ DO NOT trust `gh api .../dependabot/alerts` in this repo — it silently returns
an INCOMPLETE list.** The push banner (server-side, full visibility) reported
**8 vulnerabilities: 3 critical, 5 high**, while both the REST alerts endpoint and
the GraphQL `vulnerabilityAlerts` query returned exactly **one** alert of any
state, and an explicit `?severity=critical` filter returned **zero**.

**Cause: the `gh` token lacks the `security_events` scope**
(`X-Oauth-Scopes: admin:org, admin:public_key, gist, repo, workflow`), which is
what GitHub requires for Dependabot alert visibility. The banner is the reliable
number — proven live, not cached: dismissing the one visible HIGH moved it from
"3 critical, 5 high" to **"3 critical, 4 high"** on the very next push.

**So ~7 alerts remain open, 3 of them CRITICAL, and their identity is UNKNOWN
from the CLI.** Brad must open
`https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/security/dependabot`
— or re-auth `gh` with `security_events` — before any agent can triage them.
**Worth doing before the App Store submission**, and note the repo is PUBLIC.

The one alert that WAS visible: **`react-router` 7.13.0 in `packages/web`** (high
— "RSC Mode CSRF Bypass"), patched only in **8.3.0, a major bump**. **Dismissed as
`not_used`** on Brad's call, and that analysis is independent of the count
problem: the advisory needs React Router's RSC mode with server actions, and
`packages/web` imports react-router purely for client-side routing
(`BrowserRouter` / `Routes` / `Route` / `Link` / `useLocation` — no
`react-router/rsc`, `routeRSCServerRequest` or `createCallServer` anywhere) and
ships as an SST `StaticSite`, so there is no server to execute an action on. The
vulnerable path is unreachable. **Revisit if `packages/web` ever adopts RSC mode
or a server runtime.**

### Closed by Brad 2026-07-27 — do not re-raise

BRIEF-7 device-QA batch (all ~20 bugs, signed off) · the one-time
`UPDATE profiles SET is_profile_public = false` · ASC support email + web custom
domain · App Store 3.1.2 Terms-of-Use link in ASC metadata · legal sign-off on
consent copy, privacy section and governing law · the OFF re-seed backfilling
`serving_quantity` across the ~143k seeded rows.

## Last session

**2026-08-02 — PR [#339](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/339)
REBASED onto `main` @ `c7ad458`, given the Inspector Brad sweep it had never had,
Brad's two device-QA reports root-caused, and MERGED. IB clean @ `61698f8`, all
5 CI checks green. The device pass is deliberately AFTER the merge: the deploy
it triggers is what first puts this branch's API behind the mobile client.**

- **⚠ BOTH device-QA reports were the SAME thing, and neither was a defect in the
  branch: staging is running `main`, and this PR's backend is not deployed.**
  `workoutVariationsReplaceHandler` is the only backend file the PR ADDS, and
  `deploy-staging.yml` fires on `push: branches: [main]` only. So
  `PUT /workouts/:parentId/variations/:variationId` has never existed on the
  staging API, while the device build carried this branch's client.
  - *"Couldn't save this setup — Not found"* was **Elysia's ROUTER**, not either
    handler. The handlers' own 404 always carries `loadoutCode: "not_found"`; the
    bare string `"Not found"` is `coreErrorHandler`'s `codeToLabel("NOT_FOUND")`.
    That distinction is the whole diagnosis — worth remembering next time a
    Loadout call 404s.
  - The false *"your gym equipment has changed"* traces to the same gap.
    Verified in staging SQL, not inferred: `saved_gyms` `Mock Gym` (904cfa01)
    holds 3 ids with `updated_at == created_at` — **never modified** — while
    `Upper · Mock Gym` (f5bd83e2) has `source_equipment_type_ids = '{}'`.
    `main`'s create handler has ZERO occurrences of `EMPTY_EQUIPMENT_CONTEXT`,
    so the deployed backend still persists `[]` where this branch 400s and falls
    back to the resolved gym kit.
  - **LESSON: when device QA fails on a feature branch, check what the API
    actually has before reading client code.** Mobile ships through EAS
    independently of the backend; a client ahead of the deployed API is a real
    and recurring shape, not just a test artefact. Two reports, hours of client
    reasoning, one `git cat-file -e origin/main:<handler>` would have said it.
  - **⚠ That stale row is unrepairable** — the kit that produced the adaptation
    was never recorded. The banner no longer fires on it (fix below), but delete
    it if it gets confusing.
- **Three fixes came out of it that stand on their own.** `hasGymEquipmentChanged`
  treats an EMPTY frozen snapshot as *unrecorded* rather than *changed* (nothing
  the user can do makes 0 and 3 agree). Every save-failure code gets copy naming
  what to do — only 2 of 9 did, so seven codes plus 404/402/500 all read "Check
  your connection", which is why the report was undiagnosable from the screen —
  with a `never` assertion so a tenth code is a compile error, and tests derived
  from `LOADOUT_ERROR_CODES` rather than a hand-copied list. And a 404 carrying
  no `loadoutCode` reads "not available right now" instead of "your setup is
  gone".
- **⚠ `ess-dev` / `ess-prod` AWS SSO are EXPIRED** — no CloudWatch access this
  session, which is why the 404 was diagnosed from `git` and staging SQL instead
  of from logs. `aws sso login --profile ess-dev`. Prod Supabase via MCP also
  returns "no permission"; staging (nxkhlrvjxotyjulodxzk) works.

- **The rebase conflicted on exactly two files, and the conflict was the
  interesting part.** `SwapExercisePopover.tsx` + its test, against **#340** —
  the App Store hotfix that also fixed a bug Brad hit live (active workout →
  swap → Create exercise → back → not in the list) by re-running the picker's
  cache read on the exercise change bus. **This branch deletes that picker**:
  T-2.7 makes it a thin adapter over `<EquipmentAwareSwapSheet>`, whose list is
  `GET /exercises/substitutes`. Neither side was resolvable alone — keeping
  #340's three regression tests tests a component that no longer exists;
  dropping them reopens the bug, because `createExerciseCommand` is offline-first
  (`local-<uuid>` into `cached_exercises`, enqueue `POST /exercises`, no inline
  flush) so a server-backed list cannot return a just-created exercise, and the
  sheet's own header CTA is the route to creating one.
  - Restored where the list now lives: `localOnlyCandidates` feeds pending-sync
    rows into the sheet under "CREATED ON THIS DEVICE", invalidated by the same
    two signals #340 used. Keyed on the `local-` id prefix, NOT `isCustom` — a
    synced custom exercise has a server id and the endpoint ranks it, so
    `isCustom` would list every one of them twice.
  - `STATE.md` was the third conflict; both sides' session entries kept.
- **⚠ LESSON, and it generalises past this PR: a textual conflict is a signal,
  not the finding.** Two files conflicted; a third file (`EquipmentAwareSwapSheet`)
  auto-merged clean and was where the actual regression lived. Git also
  auto-merged #340's three appended tests into the branch's rewritten test file,
  where they would have failed — the only reason the loss was visible at all.
  When a rebase crosses a behavioural rewrite, diff the INTENT of both sides.
- **Inspector Brad: 5 sweeps, 19 findings, clean @ `f2879d5`.** No sweep had ever
  been recorded on this PR. The two that would have shipped real bugs:
  - 🟠 the in-session swap **422'd on an unsynced source** — `forExerciseId` is
    UUID-validated and a session row legitimately holds a `local-…` id after you
    swap in an exercise you just created, so the sheet blamed the network for a
    row the server had never heard of;
  - 🟡 **review decisions survived a re-collect** — `droppedRows`/`acceptedRows`/
    `pickedNames` are keyed by parent `sortOrder`, and `acceptedRows` now decides
    whether a row is SAVED, so an accepted `intensity_mismatch` could be written
    with no UI ever showing it. Fixed with a `collectRev` counter on the store:
    the same-gym re-collect needs the collect EVENT, not the context value,
    because stage 2 of the adaptation is an LLM.
  - Also: ~800 un-virtualised rows after `CANDIDATE_LIMIT` went to 400 (capped at
    50 rendered per group, sliced AFTER matching); a stale debounced search term
    across a clear-and-retype; and **five separate instances of the same
    close-animation bug** — `BottomSheet` keeps children painted through the
    slide-down, so clearing `isLoading` / `result` / `error` / `query` /
    `pendingOverride` on the close edge each gave the user a frame of the list
    they just tapped turning into an empty state. Reset on the OPEN edge, in the
    render phase.
- **Recurring shape worth remembering: `visible` is not a lifecycle.** #341/#343
  established that closing a sheet is not an unmount, for FETCHING. The same fact
  governs RENDERING — and the correct gate differs per concern: fetch on
  `visible`, reset on the open edge, and cache-read on a `hasOpened` latch (an
  ungated read put a full `cached_exercises` scan on the active-session first
  frame, which is the #341 shape exactly).
- Every fix carries a test verified by MUTATION, not assertion — reverted, watched
  fail, restored.
- **⚠ Untracked local files break the root gates and are not on any branch:**
  `microservices/core/probe-steps.ts` (4 × `no-explicit-any` + prettier) and
  `.agents/skills/sst-resource-change/SKILL.md` (prettier). Don't let
  `probe-steps.ts` get swept into a commit.

**2026-07-31 — APP STORE REJECTION (Guideline 4) + swap-picker refresh bug. PR
[#340](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/340)
OPEN off `main`, branch `claude/signin-apple-design-fix-78rvv9`. Full mobile
suite green: 459 suites / 5304 tests, typecheck clean, prettier clean, lint
clean (2 pre-existing `react/display-name` errors in `__tests__/setup.ts` are
baseline, not from this branch). NOT device-verified — the Apple button is a
native view that cannot render under Jest, so no test proves how it looks.
Check it on a real build, ideally on iPad (the review device was an iPad Air
11-inch M3).**

- **Rejection cause: we drew the Sign in with Apple button ourselves.** Both
  auth screens rendered a generic `<OAuthButton>` with `icon={""}` — the
  Apple logo private-use glyph in the app's own font. Apple's wording was "logo
  artwork that is not downloaded from Apple Design Resources". The whole control
  was app-drawn (our border, surface, typeface, copy), so it failed on every
  axis, not just the mark.
  - Fixed with `<AppleSignInButton>` (`src/ui/components/AppleSignInButton.tsx`),
    a thin wrapper around `expo-apple-authentication`'s
    `AppleAuthenticationButton`. **No assets were downloaded and none are
    needed** — Apple's component supplies artwork, label, typeface,
    localisation, and light/dark variants natively. The dependency and its
    config plugin were already in `app.json` for the auth flow itself.
  - `buttonType=CONTINUE` (copy unchanged from what shipped), `buttonStyle=WHITE`
    (dark-only app), `cornerRadius=14`, height 52 to match the Google button so
    SIWA is no less prominent (HIG).
  - **Do not re-skin this.** No image, icon font, or glyph; no `backgroundColor`
    / `borderRadius` via `style`; no overlay on the artwork. The loading state
    dims + blocks rather than swapping in a "Connecting..." label, because
    obscuring the button is itself a Guideline 4 failure.
- **Swap picker didn't show exercises created mid-flow** (Brad hit this live:
  active workout → swap → create exercise → not in list). `SwapExercisePopover`
  memoised its cache read on `[storage, cacheVersion]`; `cacheVersion` only bumps
  after a *stale 24h* refresh, and the popover stays mounted between opens. So a
  freshly created exercise landed in `cached_exercises` and the list never
  re-read. Added `useCacheRevision(EXERCISE_TABLES)` + `useExerciseLibrary`
  revision — **the exact wiring `AddExercisePopover` already had**; the swap
  picker was simply missed when that fix went in. 3 regression tests, verified
  failing without the fix.
- **⚠ #337's SQLSTATE 23514 fix is merged to `main` but in NO release tag.**
  `c8a0b6d` sits above `persistence-v1.10.0` (`1ad9caa`, 2026-07-29). Production
  therefore still has the session-rating bug. An Apple reviewer hit a production
  Sentry error at **2026-07-30 22:26 UTC** on iPad Air 11-inch (M3) — after #337
  merged (15:37 UTC) but while prod was still unpatched. **Not confirmed to be
  the same error** — the Sentry MCP connector was disconnected this session, so
  the issue (137728287) could not be read. If it is 23514, resubmitting the app
  alone will NOT fix it; it needs a release + deploy.
- **⚠ OPEN, deliberately deferred off PR #340: two more `cached_exercises`
  readers have no exercise-cache invalidation.** `WorkoutsListContainer` (memo
  deps `[saved, templates, storage]`) and `WorkoutDetailContainer` (`[workout,
  storage]`) both call `storage.getCachedExercises()` but are driven off
  `useCacheRevision(WORKOUT_TABLES)`, which does not move on an exercise write.
  Cold start renders Train before `refreshExerciseCache` lands → split badges /
  muscle pills / equipment eyebrow compute against an empty library and never
  recompute. Self-heals on the next focus `rereadCache`, so it is a first-paint
  degradation, not a stuck state — that plus PR #340 being an App Store release
  blocker is why it was left out. Fix is `useCacheRevision(EXERCISE_TABLES)`
  folded into each memo, same one-liner as the other five surfaces, **with a
  revert-checked regression test each** (see below).
- **Lesson from #340, worth keeping: do NOT blanket-propagate the exercise
  change bus.** It is correct for LIST-shaped reads (`getCachedExercises()`),
  which re-read and find a row under its new key. It is WRONG for
  `useExercise`, a single-id read: the sync drain rekeys `local-*` → server id
  via DELETE+INSERT, so the bus makes `initial` recompute to null, blanks a
  loaded row, and re-arms the one-shot fetch against the dead id → 404 (and on
  the editor, discards in-progress form input). This was actually shipped in a
  #340 commit and reverted after Inspector Brad demonstrated it. `useExercise`
  now carries a regression test that fails if someone re-adds the bus.
  - **Still open (pre-existing, also on `main`, NOT caused by #340): a detail
    screen already open when the drain fires keeps the dead `local-*` id in its
    route param**, so `ExerciseDetailContainer.onEdit` → `ExerciseEditorContainer`
    mounts on it, misses cache and 404s. Delete has the same shape. The list fix
    only closes *fresh* navigation. Real fix is the drain publishing the old→new
    mapping, or the route swapping its param — not a bus subscription.
- **Parked, not started: "Create & Add" CTA in the create-exercise flow.** Brad
  asked, gated on difficulty. It needs pending-intent plumbing (the picker must
  close for the full-screen creator, so `pickerMode` can't just persist), a
  route param, a presenter CTA, and a focus-time dispatch in
  `ActiveSessionContainer` — a real slice touching the active-session state
  machine. Deliberately kept out of a release-blocking hotfix branch.

**2026-07-28 — HOME TRAIN RING + WORKOUT DURATION bug fixes. PR
[#334](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/334)
OPEN off `main`, branch `claude/fix-train-ring-and-duration` (5 commits, head
`25189f22`). All gates green; 4 Inspector-Brad passes (8 + 6 + 4 findings fixed,
final pass clean). NOT device-verified — and that matters more than usual here,
see below.**

- **Both reported bugs were hardcoded constants, not broken maths.**
  - Workout duration was always 30: V2 dropped legacy's `calculateWorkoutDuration`
    at port time and kept only its fallback constant, the form seeded 30, and the
    backend's `?? 30` therefore never fired. Ported the heuristic to
    `application/workouts/estimateDuration.ts` and made it SERVER-side so all three
    authoring paths share it.
  - Train ring read 45% for a heavy session: it was weekly volume ÷ a hardcoded
    20,000 kg (8,960 ÷ 20,000 = 44.8%). Now daily HealthKit active energy. Weekly
    volume was already on the Home card + You VolumeStats, so nothing was lost.
- **Move's goal now reads the user's Steps habit target** (`habit_configs`), falling
  back to 10k. Active energy has no habit equivalent — `calories` there is nutrition
  INTAKE (`within_tolerance`, feeds Fuel) — so its goal is a **500 kcal stopgap**.
- **⚠ OPEN PRODUCT QUESTION for Brad, recorded as spec 06 AC 1.2b.** Move and Train
  now BOTH read HealthKit, so a user who declines Health permissions sees the hero
  dial at a permanent 0%, even right after logging a workout. Before this, Train came
  from server-side volume and moved without device permission. Options: gate
  Move/Train like Fuel, or rely on the connect prompt. Recommended gating; not decided.
- **⚠ TWO migrations need manual prod apply**: the duration backfill
  (`20260728121000_backfill_workout_estimated_duration.sql`) and SQLite migration 1
  (ships with the app, clears `cached_home`).
- **Latent bug this surfaced: HealthKit energy reads had no explicit unit.**
  `preferredUnits(for:)` returns kJ on AU/NZ devices and for anyone with the Health
  app set to kJ — 4.184× high. Both energy reads now pass `unit: "kcal"`. Pre-existing;
  the new ring is what would have made it visible.
- **The backfill nearly destroyed real data — twice.** First scoping assumed a stored
  30 could only be the V2 default; the still-live LEGACY app sends
  `max(15, 2n + totalSets)` EXPLICITLY, which is exactly 30 for 5 exercises × 4 sets.
  Then the same flip-flop reappeared via the edit path (the editor sent the full plan
  on every PATCH, so a rename re-derived). Both closed. **Backfill validated against
  STAGING read-only** — SELECT + EXPLAIN + case-by-case discriminator check.
- Unrelated pre-existing flake noted: `useAutoRetryOnUpgrade › flip-flop mid-flush`
  fails intermittently under full-suite parallelism, passes 7/7 in isolation.

**2026-07-28 — LOADOUT Phase 2's SCREENS + Phase 3's scan sheet. Branch
`claude/loadout-phase-2-screens` (3 commits off `dfeed666`), NOT merged, NOT
device-verified. The first user-reachable Loadout surface: before this, every
Loadout phase was contract, engine and step machine with nothing attached.**

- **Shipped T-2.2…T-2.9, T-3.4 and T-3.5's mobile half.** Entry card + locked
  upsell, collect (scan / picker / saved gym), manual checklist with name +
  save toggle, adapting skeleton, review with per-row reasons and swap, saved
  setups on the parent, save and save-and-start, success, and saved-gym
  management under Profile · Account. Recreated in the app's primitives and
  tokens from `~/Downloads/Any Gym/project/` — no lifted prototype JSX.
- **The load-bearing decisions are in `tasks.md`
  § "Landed in Phase 2's screens beyond the checklist"** and § Open items above.
  The two most likely to be undone by a well-meaning refactor: the flow is the
  **`/(app)/loadout` route** (`fullScreenModal`) — NOT a root-mounted overlay,
  which was tried twice and broke on device both times (see § Loadout Phase 2's
  screens) — and the swap sheet's containment context is
  **`preview.equipmentTypeIds`** — the kit the SERVER resolved — never the
  client's saved-gym row.
- **Fixed in passing, each found by building against it:** `SnapAISheetContainer`
  resized **width-only** under a comment promising a long edge, so every portrait
  photo shipped ~1/3 over the token budget and small ones were UPSCALED (now a
  shared `resizeToLongEdge`, used by the scan too, which matters more there —
  Opus-class at $0.0272 an inference); `SwapExercisePopover` listed the **local,
  not-visibility-aware** exercise cache and so could not enforce AC-3.6 (now
  `/exercises/substitutes`, with a refresh-and-retry guard because
  `applyPickerSelection` resolves the pick through that cache and returns
  **silently** on a miss); the in-memory adapter's saved-gym 409 carried no
  `loadoutCode`, making the rename-vs-fail branch untestable.
- **⚠ A REAL bug the mutation sweep surfaced, not the tests:** "Choose one" on an
  `unresolved` row opened an EMPTY picker. An unresolved row has
  `exerciseId: null` by definition, so ranking against it sent
  `forExerciseId: null` — on the one row that most needs replacing.
  `adaptWorkout` sets `substitutedFromExerciseId` to the source precisely so the
  original stays reachable; the container now falls back to it.
- **⚠ A literal U+0000 reached a commit and passed EVERY gate.** It was the array
  separator in `EquipmentAwareSwapSheet`. Prettier, ESLint, Babel and `tsc` all
  accepted it while git treated the file as BINARY — so the one component that
  derives `isUserOverride` rendered as "Binary file not shown" and could not be
  3-way merged. Only Inspector Brad caught it. `file <path>` saying "data" is the
  tell; § Active gotchas now records it.
- **IB: 1 sweep (10 findings: 1 🔴 / 2 🟠 / 5 🟡 / 2 🟢, all addressed) + 1 CLOSED
  verification pass (7 of 8 confirmed closed, 4 residuals + 1 🔵, all addressed).**
  The 🔴 was a permanent hang: the preview request's dedup key was never cleared,
  so re-adapting the same (workout, gym) pair after a close issued no request and
  left the skeleton forever — with no retry affordance, because that only renders
  on an error. The closed pass then found the SAME hang by a second route (a fresh
  `context` object with identical contents cancelled the in-flight request and
  declined to replace it). Two 🟠: the flow's saved-gym list was fetched once per
  app *session*, feeding a stale kit to the swap sheet's containment context; and a
  throw in the scan's image pipeline stranded the sheet on a spinner with no exit.
  **CI action NOT fired** — 1 sweep + 1 closed pass, per the two-sweep cap.
- **LESSON — a surviving mutant has three causes and only one is a test gap.**
  Missing test (write it), dead branch (delete it), or two layers guarding
  different channels (annotate it). This slice hit all three: a real gap in the
  drop filter, a genuinely unreachable un-drop-on-pick branch that was deleted,
  and the touch-vs-a11y `disabled` pair that must stay. Guessing wrong either way
  costs quality — a test that cannot fail, or a deleted safety net.
- **Gates:** prettier (whole tree) · typecheck 8/8 · lint 0-err · build 13/13 ·
  test:unit 19/19 (mobile **460 suites / 5409 tests**; core 285 files / 3123;
  scripts 3 / 112). Mobile coverage 96.55 / 91.01 / 96.63 / 98.01; every new
  Loadout presenter at or near **100 %**. ~60 mutations applied across the new
  guards; all caught bar three annotated redundant-by-design pairs.
- **PR #328 raised; TWO red CI runs before green, both my own doing, and the
  pattern is the lesson.** Run 1 failed on the saved-gym delete test — which I had
  already seen fail locally once and dismissed as the known parallel-load flake.
  It was not: confirming a delete cleared `pendingDeleteId`, which swapped the
  confirm card back for the ROW, and `remove()` takes TWO sequential round trips
  before the list re-reads — so the row the user just deleted **reappeared** for
  that whole window, reading as "the delete didn't work". Fixed with an optimistic
  hide (restored on failure; both directions mutation-verified), and the assertion
  now waits for the cause before the effect. Run 2 failed on a different test with
  a 5000 ms **per-test timeout** in a suite CI took **50.76 s** to run: the six new
  suites were missing the `jest.setTimeout` every other heavy container suite here
  already sets. Green on run 3.
- **⚠ NEXT: device-verify on an EAS dev build against staging (the checklist is in
  the PR body), then merge.** Nothing else is outstanding on the branch.

**2026-07-28 (cont.) — Brad's device run, and the three things it found. All on
the same branch; the flow is STILL not verified working end-to-end by me.**

- **The screens were unreachable, twice, for two different presentation
  reasons.** Attempt 1 mounted the flow as an absolute-fill sibling of the Stack;
  the entry point is `workouts/[id]/index`, which is `presentation: "modal"`, so
  the whole flow rendered *behind* the workout sheet and tapping the card did
  nothing. Attempt 2 wrapped that in an RN `<Modal>` and was **worse** — a
  root-mounted modal cannot present over an already-presented route, so it froze
  the screen with an invisible modal swallowing touches. Brad's detail
  ("if i swipe away the workout, the rest of the screen freezes") is what
  identified it. Now the `/(app)/loadout` route. **The lesson is that I reached
  for fix 2 without re-examining fix 1's premise.**
- **⚠ A BACKEND 500 was the real blocker behind "Couldn't adapt this workout",
  now SPLIT OUT to PR #332 at Brad's request — I could not have found it from
  the mobile side** — the client only sees a
  generic error. Brad pasted the stack trace and it was immediate:
  ``sql`${array}::uuid[]` `` renders a ROW constructor. Four predicates in
  `exerciseRepository`; two of them three months old and never executed, because
  the exercise library filters locally from its SQLite cache. See § Active
  gotchas. **#332 must merge AND staging must be redeployed
  (`deploy-staging.yml` takes a `workflow_dispatch`) before the flow can work on
  device.**
- **⚠ A render test that PINNED the bug.** `exerciseRepositoryLoadout.test.ts`
  already rendered the predicate through `PgDialect` — exactly the guard the
  previous SQL incident prescribed — and asserted `($1)::uuid[]`, the invalid
  shape, as correct. Rendering closes the mocked-`getDb` gap only for defects the
  author knows to look for; it says nothing about whether Postgres can execute
  the result. The replacement bans the bad form mechanically and runs both
  arities, because one id and several fail with *different* errors.
- **"Save this gym for next time" was contingent on the adaptation succeeding.**
  The gym was created inside `save()`, so Brad's 500 lost the named kit and every
  ticked chip — the toggle's label promises something about the KIT, not about
  the variation. It now fires when the user commits the kit, alongside the
  preview rather than before it (that request already spends 2.6 s p50 in
  Bedrock), and `save()` awaits the in-flight create instead of racing it into a
  duplicate-name 409.
- **⚠ The safe-area bug was NOT what it looked like.** `SafeAreaView` from
  `react-native-safe-area-context` is a purely native view that never reads
  `SafeAreaInsetsContext` — so the missing root `SafeAreaProvider` I had flagged
  was a real finding but the WRONG fix, and adding one alone would have changed
  nothing. Inside the `fullScreenModal` route the native measurement returned
  zero, intermittently. Fixed with both halves: a route-scoped provider seeded
  from `initialWindowMetrics`, and the two Loadout presenters moved to
  `useSafeAreaInsets()`. The tests assert the actual numbers (44 / 34), because
  a truthy check passes on `paddingTop: 0` — which is the bug.
- **NOT done, deliberately:** the Gym-tab-in-Train idea (Brad: "worth keeping an
  eye on") — logged under § Open items. And the app-wide root `SafeAreaProvider`,
  which would give every other sheet in the app its home-indicator padding back.


**2026-07-27 (cont.) — LOADOUT Phase 3 backend + Phase 2 FOUNDATION. MERGED as
PR [#326](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/326)
(squash `f0e8929`), branch deleted; all 5 CI checks green. The scan endpoint is complete;
the mobile flow has its contract, its pure logic and its step machine, and **ZERO
screens** — nothing is user-visible or device-verified.**

- **`POST /ai/equipment-scan` SHIPPED** (T-3.1…T-3.3, `46b19d9`). Guard order cloned
  from `nutritionAiEstimateHandler` verbatim because that order IS the cost-safety
  contract and this endpoint is 5× the unit cost. Mounted in `loadoutRoutes`;
  `/ai/equipment-scan` is fully literal so no matcher can capture it, and it did NOT
  tip `packages/web`'s Eden treaty (typecheck 8/8).
- **⚠ SCAN CEILING DECIDED: 6/day, not design § 8.1's 10** (Brad: "go with your
  recommendation… calculated against all costs from one user compared to their
  subscription"). **The 10's reasoning was the flaw** — it was analogised from
  Mealprint's suggest/day-plan/swap ceilings, which are daily-use surfaces, whereas
  **a scan is a once-per-GYM action** because `saved_gyms` persists the result. At
  $0.0272/scan, 6/day = ~$4.90/user/mo worst case, i.e. PARITY with the re-map's
  $5.13, so both Premium+ AI surfaces together are ~$10/mo against ~$32 net (£29.99
  less Apple's 15 %). 10/day would have been $8.16 for one endpoint. Swept through
  `infra/api.ts`, design § 8.1, tasks.md T-3.1 and § Open items.
- **⚠ THE AGGREGATE PER-USER AI CEILING HAS NEVER BEEN COMPUTED, AND IT IS THE
  NUMBER WORTH WATCHING.** The 2026-07-05 bar (£7.30 worst case vs £12.99) was
  per-surface-pair and predates recipes AI *and* Loadout. A `premium_plus` user can
  consume EVERY ceiling: nutrition photo+text (~$9.27) + recipes extract/estimate/
  resolve (UNMEASURED, ~$8.5 est.) + re-map ($5.13) + scan ($4.90) ≈ **$28/mo worst
  case against ~$32 net**. Not a loss, but not a margin either — and it needs a
  dedicated adversary hitting six endpoints daily for a month. Median use is
  ~$1.50/mo (~5 % of net), which is healthy. **The recipes surfaces are the
  unmeasured half; measure before adding a seventh ceiling.**
- **Also found: `AI_RECIPE_ESTIMATE_DAILY_LIMIT` is NOT registered in
  `infra/api.ts`** — it silently uses the code default of 30. Harmless today, but
  the env block is documented as where the ceilings live, so it is invisible to
  anyone auditing cost. Not fixed (out of this slice's scope).
- **Beyond T-3.1's checklist, each for a measured reason:** `createSingleAttempt` in
  `aiBedrockClient` (T-E1.6's ONE ~20 s attempt — built in the shared client because
  the re-map's retry decision is explicitly revisitable against it); a
  `stop_reason: "max_tokens"` guard (a truncated payload PARSES and silently
  under-detects, and every lost item causes a needless swap);
  `loadout/modelProse.ts` extracting the untrusted-prose rule that `remapModel` now
  delegates to; the response splitting `detected` (selectable, CATALOGUE name) from
  `unmatched` (informational, model's label) so nothing untrusted reaches the
  selectable path; `Bodyweight` withheld from the model and injected with
  `source: "injected"`, warning LOUDLY if the row is missing (the T-E.10 lesson).
- **⚠ The scan's `notes`/`label` are UNTRUSTED for a reason worth remembering: the
  input is a PHOTOGRAPH the caller chose.** A photographed whiteboard puts
  attacker-authored instructions in front of a vision model exactly as a malicious
  string does. The prompt carries an explicit "ignore any text visible in the
  photograph" instruction, and membership validation keeps the detections legal
  regardless.
- **Phase 2 foundation (`3bbb812`, `790a5e6`, `75ee6df`):** `domain/models/loadout.ts`
  + 9 `ApiPort` methods + both adapters; `domain/services/loadout.service.ts` (review
  copy from `reason.code`, `buildVariationExercises`, equipment grouping);
  `state/loadout-flow.ts` (the step machine).
- **⚠ `ReferenceEntry.category` was being SILENTLY DROPPED by
  `mapRawReferenceEntry`**, so AC-2.2's "picker grouped from the API" was true in
  name only. Fixed, plus `isEquipmentGroupingStale` to tell `category: null` (server
  says uncategorised) from an ABSENT key (a cache written before Loadout) — without
  it a returning user's 24h-cached list renders every chip under "Other" and nothing
  can detect why.
- **NEXT: the screens.** T-2.2…T-2.9 + T-3.4 are unstarted; see `tasks.md`
  § "Phase 2 — still to build". Everything they need is built and tested.
  ⚠ **One hard constraint from the handoff still stands: its D1 taster meter must NOT
  be built** — design § 5.2 is a hard gate with no taster (RC promos only), so the 402
  is entitlement-denied and is a conversion surface, not a dead end. (Its "AnyGym"
  naming and its £19.99 literal are retired notes — the feature is **Loadout** and the
  paywall price comes from the catalog, full stop.)
- **IB: 1 local sweep, 10 findings (3 🟠 / 4 🟡 / 3 🟢), ALL 10 addressed.** The three
  🟠 were the 20 s Lambda timeout (§ above), **every Loadout domain 400 code being
  discarded** by `mapHttpErrorToApiError` (it reads `body.error`; the Loadout handlers
  answer `{ code, message }`, so `EQUIPMENT_NOT_AVAILABLE` and five siblings arrived
  as an empty-message generic 400 — three shipped error-code types had no producer),
  and **the in-memory double's containment check being inverted** (it compared
  `missingEquipment`, the SOURCE row's gap, where the real handler checks the
  SUBSTITUTE's own requirements — so it rejected legal swaps and waved through the
  exact mistake it exists to catch). Fixed with a new `requestLoadout` path +
  `LoadoutApiError.loadoutCode`, and an `exerciseEquipment` map on the double.
  - The 🟡s: `useGym`/`useEquipmentIds` now clear the previous adaptation (a
    re-collect mid-flow reapplied stale picks by `sortOrder`); `intensity_mismatch` is
    DROPPED on a manual pick (it describes the substitute being replaced, so keeping
    it persisted misinformation into the provenance jsonb); `rowsNeedingAttention`
    now takes `manualPicks` (else a flagged row could never be resolved and a
    Save gate would deadlock); a server-INJECTED `Bodyweight` detection can no longer
    be deselected. The concurrency finding is recorded above rather than fixed.
  - The 🟢s: blank unmatched labels dropped, `deriveVariationName` cuts on a code
    POINT via a new `shared/utils/text.ts` (twin of the backend's `modelProse` —
    mobile shares no package with core), and `describeLoadoutRow` gained a `default`
    branch because `substitution_reason` is untyped jsonb read back for AC-3.3.
  - **Then 1 CLOSED verification pass, which found 5 more (1 🟠 / 4 🟢) — including a
    real bug in my own fix.** The `loadoutCode` union named
    `duplicate_name`/`unknown_equipment`, which are `SavedGymCreateResult` **repository
    statuses** the handlers translate and never serialise; the wire codes are
    `SAVED_GYM_NAME_TAKEN` / `UNKNOWN_EQUIPMENT_TYPE`, and
    `UNKNOWN_SUBSTITUTED_FROM_EXERCISE` was missing entirely. **And the test I wrote
    asserted a hand-invented body the server never sends, so it passed while the
    contract was wrong** — the same "test that cannot fail" class this file already
    has a lesson about. Now a `const LOADOUT_ERROR_CODES` array transcribed from the
    handlers, with the regenerating grep in its docstring
    (`grep -rn 'code: "' microservices/core/src/application/loadout`), a real runtime
    membership check replacing an `as` cast that let `ENTITLEMENT_DENIED` in, and the
    three dead per-endpoint code unions DELETED rather than corrected.
  - **LESSON — a union transcribed from a repository result type is not a wire
    contract.** Read the handler, not the repository, and grep for `code: "` rather
    than inferring. Two of ten members were wrong and two were missing.
  - **CI action NOT fired** — 1 sweep + 1 closed pass locally, per the standing rule
    and the two-sweep cap. The last round of fixes was verified by grepping the
    handlers directly (the authoritative source for a wire contract) plus mutation
    tests, rather than by spending a third pass.
- **Gates:** prettier (whole tree) · typecheck 8/8 · lint 0-err · build 13/13 ·
  test:unit 19/19 (core 285 files / **3123 tests**; mobile 452 suites / **5193
  tests**; scripts 3 files / 112). Changed files ≥ 90 % on all four axes — the three
  new mobile files are **100 %** across the board; scan handler 100/98/100/100, scan
  model 100/95.34/100/100, `modelProse` 100 %. **38 mutations applied across the new
  guards, all 43 caught** — including the exact inverted-containment regression IB
  found and the wrong saved-gym wire code the closed pass caught.



**2026-07-27 — LOADOUT Phase 1 (adaptation engine + preview) — MERGED.
PR [#322](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/322)
squashed to `1a7b956`; branch `claude/loadout-phase-1` deleted. Backend only: no
migration, no mobile, no scan endpoint. All of T-1.1…T-1.11 ticked in
`tasks.md`.**

- **The engine is the HYBRID D7 selected by measurement** (design § 6.0):
  deterministic § 6.2 shortlist (top 25/row) → model selection over that
  shortlist → model reasons. Stages 1, 3 and 4 stayed deterministic, so the model
  changes *which* exercise is picked, never *whether* the pick is legal.
  New `microservices/core/src/application/loadout/engine/` —
  `rankSubstitutes.ts` (pure § 6.2 weights), `adaptWorkout.ts` (partition /
  shortlist / stage-3 assembly), `remapModel.ts` (the forced-tool Bedrock
  adapter), `reasons.ts`, `intensityMismatch.ts`, `types.ts`. Plus
  `loadout/preview/workoutLoadoutPreviewHandler.ts` and
  `exercises/substitutes/exercisesSubstitutesHandler.ts`. New env in
  `infra/api.ts`: `AI_LOADOUT_REMAP_MODEL_ID` (Haiku-class) and
  `AI_LOADOUT_REMAP_DAILY_LIMIT` (shipped as a placeholder 30, **promoted to a
  decision later the same day** — see § Open items → § DECIDED). No IAM change
  needed — the existing Bedrock wildcards cover the model id.

  **The contract Phase 2 consumes** (so it need not be re-derived from code):
  `POST /workouts/:id/loadout/preview` takes EXACTLY ONE of `savedGymId` or
  `equipmentTypeIds` (both, or neither → 400 `EQUIPMENT_CONTEXT_REQUIRED`; both
  keys with the unused one `null` is fine). It returns rows carrying
  `status: kept|swapped|unresolved`, the parent's targets UNCHANGED, an
  `exercise` display block, and `reason = { code, missingEquipment, matchedOn,
  flags, note, selectedBy }`. **`code` drives the copy — the backend emits no UI
  strings.** ⚠ **`reason.note` is UNTRUSTED model prose** (capped at 300 chars,
  unpaired surrogates stripped): a stranger's PUBLIC workout is adaptable
  (AC-1.2) and neither `workouts.name` nor `exercises.name` is length-bounded, so
  **Phase 2 must render it as plain text — never markup, a link, or anything
  actionable.** On the save path, the "doesn't fit your kit" acknowledgement MUST
  set `isUserOverride: true` or the deliberate pick is rejected 400
  `EQUIPMENT_NOT_AVAILABLE`.
- **⚠ `GET /exercises/substitutes` tipped `packages/web`'s Eden treaty into
  TS2589, and it CANNOT be nested out of trouble.** It must precede the
  `/exercises/:id` matcher, so a late-mounting sub-app cannot hold it. TWO nesting
  variants were measured — pairing it with `exercisesSearchHandler`, and
  collapsing all ten exercise routes into one sub-app — and **both moved the same
  error into `microservices/core`'s own `api.ts`**, i.e. from an unused client into
  the build everything depends on. Annotating the handler's response type
  explicitly did not help either: the cost is the extra ROUTE, not its shape. So
  `packages/web/src/lib/eden.ts`'s `@ts-expect-error TS2589` is back — which is the
  remedy that file itself prescribes for this case, and the client has 0
  call-sites. **Don't re-attempt the nesting; it is measured and worse.**
- **⚠ `sort_order` IS NOT A ROW IDENTITY.** No unique constraint
  (`001_initial_schema.sql:699-702` indexes only workout_id / exercise_id /
  superset_group) and `toWorkoutExerciseInsert` writes the client's value verbatim,
  so two rows can share one. Keying the shortlist map on it collapsed one row's
  candidates into another's and produced a **cross-muscle substitution (a squat for
  a bench press) through the guards rather than around them** — reachable via a
  stranger's PUBLIC workout, which AC-1.2 makes adaptable. Fixed with
  `PlanRow.rowKey` (position in the ordered plan). The tool field the model sees is
  still named `sortOrder`, deliberately, so the prompt stays byte-identical to the
  arm E2 measured.
- **Brad's three Phase-1 checkpoints were DECIDED later the same day** — ceiling
  30/day, keep `createWithRetry`, keep the 503 (see § Open items → § DECIDED).
  They shipped as flagged placeholders/recommendations and were promoted to
  decisions in a follow-up, with every doc that assumed "open" swept.
- ~~**Bedrock grant NOT re-verified this session**~~ (**since RESOLVED — Brad
  confirmed both ids in prod, 2026-07-27**) — both SSO tokens were expired and
  refreshing needs an interactive login. The ledger's evidence stands (Brad granted
  Haiku 4.5 in prod 2026-07-26); the check is queued in § Open items rather than
  claimed as done.
- **A model failure is a 503, never a silent downgrade to the § 6.2 ranker.**
  Shipping ranker output under a Premium+ badge is exactly what the bake-off
  rejected (it lost 4-50 and produced Atlas Stones in a hotel room). Raised for
  Brad rather than treated as settled.
- **IB: 2 local sweeps (9 findings, then 3) + 1 closed verification pass (which
  REFUTED one of my own fixes).** 12 defects fixed across 3 commits.
  **The `@inspector-brad` CI action WAS fired this time — at Brad's explicit
  request, not pre-emptively — and came back CLEAN @ `e2ebbbb` with zero
  findings** (`claude-opus-4-7` / `high`). The standing rule still holds by
  default: it bills Brad's subscription and is his to trigger. Worth knowing the
  two gates agreed. The refutation is
  worth remembering: reserving the model's picks to stop a repair cascade
  **traded a filled row for a hole** and then reported `no_candidate` for a row
  that had a candidate. A closed pass asked to verify "(c) no row can now be
  starved" is what caught it — the question was worth asking explicitly.
- **LESSON — a mutation that survives is not always a test gap.** Three surviving
  mutants were EQUIVALENT: the reservation loop's legality / membership /
  prior-use screens change no behaviour, because the repair re-filters all three
  itself. The right response was deleting the dead conditions, not writing tests
  that pretend to pin them. A fourth survivor was a real gap (a KEPT row's
  selection must reserve nothing) and got a test.
- **LESSON re-confirmed — `bun run test:unit` is NOT a typecheck.** `res.json()`
  returns `unknown`; the whole new handler-test suite was green while `tsc` had 19
  errors.
- **LESSON re-confirmed — the shell cwd drifts.** Three commands failed on
  relative paths after an earlier `cd` into `microservices/core` persisted. Prefix
  every path with the repo root.
- **Gates:** prettier · typecheck 8/8 · lint 0-err · build 13/13 · test:unit 19/19
  (core 281 files / **3027 tests** / 98.37 % overall). Every changed file ≥ 90 % on
  lines, branches AND functions; the engine is 100 % lines / ≥ 97 % branches.
  **48 mutations applied to the new guards, all caught.** All 5 CI checks green on
  #322 before merge; the staging deploy fired on merge (Lambda-only — Phase 1 has
  no migration).


**2026-07-26 (cont. 3) — LOADOUT Phase E eval spike. D7 DECIDED BY EVIDENCE:
the HYBRID wins. Branch `claude/loadout-phase-e` (HEAD `d4139d4`, 2 commits),
PR not yet raised. NO product code — script + dataset + verdict + spec updates.**

- **E2 bake-off ran: 3 arms × 80 fixtures (20 workouts × 4 equipment contexts,
  58 of them swap-bearing, 171 swap rows), identical candidate sets, blind
  judge (Opus 4.6) on plans anonymised in hash-determined order.**
  | | legal | muscle fid | pattern/coherence/reason (blind 1–5) | cost/adaptation |
  |---|---|---|---|---|
  | A ranker only | 80/80 | 0.968 | 3.07 / 3.21 / 2.62 | $0 |
  | B model, full pool | 80/80 | 0.822 | 4.43 / 4.10 / 4.02 | $0.0199 |
  | **C hybrid (SHIPS)** | 80/80 | 0.930 | 4.07 / 3.93 / 3.81 | **$0.0057** |
  Head-to-head: **B beat A 52–5, C beat A 50–4, C vs B 25–25 with 8 ties.** So
  the hybrid is judged-equivalent to the full-pool model arm at **28.7 % of its
  cost**, and the § 6.2 ranker survives **as the shortlister** (top 25/row) —
  T-1.2 stays in Phase 1's scope.
- **⚠ ARM A DID NOT LOSE NARROWLY, AND THE REASON IS STRUCTURAL.** § 6.2's
  scoring is dominated by primary-muscle overlap and its `movement_type` signal
  has **no data** — NULL for all 2281 seeded rows (only
  `exercisesCreateHandler`/`exercisesUpdateHandler` ever write it, for
  user-created exercises), so it degrades to `category`, which is `strength` for
  1976/2281. Result: equipment-legal but unshippable swaps — **Barbell Deadlift →
  Atlas Stones** in a bands-only context, **Machine Bicep Curl → Floor Rope
  Climb**, rear-delt fly for a lateral raise. A deterministic-only engine would
  need `movement_type` backfilled across the catalogue FIRST (T-E.11).
- **E1 RAN (Brad supplied 7 photos, 6 stock + 1 real phone photo, "this can do
  for now"). VERDICT: PROVISIONAL GO — and it overturned two design choices.**
  Opus 4.6: **recall 0.966** (28/29), 3 FPs, **0 hallucinated ids**, 23 items
  correctly returned `null`+label; **1.000 on the one real phone photo** (n=1).
  Haiku 4.5: 0.759 recall, 7 FPs, **2 hallucinated ids**, only 3 null-labelled,
  **0.500 on the real photo**, and it missed **`Squat Rack` in 3 of 7 photos**.
  - **⚠ Stock photos are EASY MODE, so 0.966 is a CEILING, not a real-world rate.**
    Scan is a provisional go **as a confirmed draft (AC-2.3)**, NOT established as
    the only collect path. The real ~30-photo set is still wanted (phone, in the
    room, not stepped back, commercial floor with equipment behind equipment).
  - **⚠ design § 8's "Haiku-class first (the task is far simpler than food
    estimation)" is WRONG — it's HARDER. Use the Opus-class id.** Haiku fell for
    both planted look-alikes in the real photo (road bike → `Exercise Bike`, rubber
    floor tiles → `Yoga Mat`) and barely used the `null` escape hatch, i.e. it
    **forces real kit onto the nearest catalogue row** — worse than a miss.
  - **⚠ `createWithRetry` is NOT usable as-is for the scan.** Measured Opus **mean
    10.1 s / max 12.3 s**, and the max already exceeds its own 12 s per-attempt
    timeout → realistic worst case is timeout-then-retry ≈22 s + overhead against a
    hard 30 s. Needs ONE attempt at ~20 s (what GTM § 3 P2 asked for) or a smaller
    image — E1 ran 1568 px/~3000 tokens where prod food photos run 640 px.
  - Scan costs **$0.0272** — ~5× the re-map. At 10/day that's $8.16/user/month
    worst case, which is material against £29.99; first real argument that the scan
    ceiling needs to be low. Also: **exclude `Bodyweight` from scan output** (true
    of every gym; inject server-side).
- **⚠ BRAD'S CRITIQUE WAS RIGHT, AND IT'S A GAP NEITHER ARM CLOSES.** He said
  equipment+muscle matching misses whether the muscle is worked "in the same
  manner", and that a swap may not be able to do it. Measured on the winning arm:
  **10 of 171 swaps put a strength-range row (reps ≤ 6) onto kit that cannot load
  it** — `Barbell Deadlift 4×4-6 → Band Good Morning 4×4-6`, `Barbell Back Squat
  5×5 → Band Front Squat 5×5`, clustered in `bands_only` + strength templates.
  **The exercise choice in those rows is CORRECT (hinge→hinge) and the prescription
  is still unusable** — so no ranker or model improvement fixes it. Cause is § 1
  rule 2 (targets copied from the parent, never model-authored).
  - **My E2 rubric never scored this** — the judge was asked about pattern
    fidelity/coherence/reason quality, never "is this viable at the stated
    intensity". Second time in this eval the instrument was the weak point.
  - **Phase 1 ships DETECTION only** (new **AC-3.5b** + **T-1.11**, design § 7.1b):
    a deterministic check (strength-range parent AND replacement lost every
    loadable equipment type) → `intensity_mismatch` flag through the existing
    AC-3.4 machinery. No model, no cost, no ceiling.
  - **Changing the target to suit the kit (4×4-6 → 3×12-15) is a BRAD DECISION
    with its own slice** — it relaxes § 1 rule 2. Explicitly NOT for the ranker to
    do implicitly.
- **⚠ SPEC CONSEQUENCES ALREADY FOLDED IN — a model is now on the re-map path.**
  `AC-10.2`'s old text ("the deterministic re-map has no ceiling and writes no
  usage rows — it costs nothing to run") is **VOID** and rewritten; new
  **AC-10.3**: programme-level MUST be an async job (120 workouts = 120 model
  calls ≈ 5 min ≈ $0.69, far past the 30 s API Gateway ceiling that § 7.3
  previously said "does not bind"). **That job infrastructure is shared with
  spec-26 Mealprint — build it once.** design § 1 (the canonical section spec-26
  mirrors) also updated; it had still described stage 2 as an open bake-off.
- **⚠ LIVE DATA BUG FOUND (T-E.10, not an engine bug):** `Leg Press` and
  `Leg Curl` resolve to `equipment_required = '{}'` because their seeded
  equipment names have no `equipment_types` row (`Leg Press Machine` /
  `Leg Curl Machine`) and `seedExercises.ts`'s `resolve()` **drops unmapped names
  silently**. `x @> '{}'` is always true, so **a bands-only athlete keeps the leg
  press** — in the seeded "Lower Body" and "Full Body Starter" workouts, i.e. the
  first two a new account owns. Needs a data migration + a seeder guard that
  fails loudly. The blind judge flagged it unprompted on both arms.
- **⚠ OPEN BRAD CHECKPOINTS (see § Open items above for the live list):** the **re-map** daily ceiling
  (deliberately NO number proposed — hitting a cap mid-gym is the bad failure),
  the equipment-scan ceiling (10/day) and the programme cap (120 workouts, whose
  rationale changed even though the number survives).
- **Bedrock:** Haiku 4.5 and Opus 4.6 both re-verified callable in `ess-dev`
  eu-west-2 before the run. Haiku 4.5 is granted in **both** accounts so the
  re-map has no prod grant blocker — but re-verify per account before shipping
  (the 2026-07-26 outage lesson). `assertDevEnvironment()` now refuses to run the
  harness unless `AWS_PROFILE=ess-dev` and the model id starts `eu.`.
- **LESSON — two eval metrics COULD NOT FAIL, and both changed published
  numbers.** `muscleFidelity` returned a fiat `1` on the 22 zero-swap fixtures
  and was averaged over all 80, compressing every arm's gap (real figures are
  0.968/0.822/0.930, not 0.977/0.871/0.949); `nearDuplicatePairs` used an
  asymmetric `i ⊆ j` subset test so detection depended on which row a pick landed
  on (arm B was 13, not 11). Same class as PR #317's three tests that couldn't
  fail. **A default that stands in for "not applicable" is a value that cannot
  fail — use `null`.**
- **LESSON — hand-derived numbers in a document drift from the data.** The first
  verdict's cost/latency/token table was arithmetic in prose on a divisor of 60
  when only 58 fixtures bear a swap. Fixed by making the figures a command
  (`src/resummarise.ts`, free and offline, recomputes from the committed dataset)
  rather than re-spending ~$1.50 on Bedrock. **If a doc quotes a measurement,
  ship the command that regenerates it.**
- **LESSON — deciding a spec question means sweeping every doc that assumed the
  old answer.** Flipping D7 left five surviving contradictions, the worst being
  design § 1 — explicitly "the canonical statement… spec-26 mirrors it" — still
  offering three arms as live options. IB found all five; grep for the old
  premise, don't just add the new section.
- **IB: 1 sweep (18 findings: 2 🟠, 6 🟡, 7 🟢, 3 🔵) + 1 closed verification
  pass.** Both 🟠 were the metric/arithmetic defects above. CI action NOT fired.
- **Gates:** prettier · typecheck 8/8 · lint 0-err · build 13/13 · test:unit
  19/19 (`TURBO_FORCE` on typecheck + test:unit). No coverage claim — the eval
  harness is throwaway scratchpad code and deliberately untested; nothing under
  any package `src/` changed.

**2026-07-26 (cont. 2) — LOADOUT Phase 0 MERGED + production AI outage diagnosed.
`origin/main` HEAD = `86a03a7` (squash of PR #317). Next up: spec-21 Phase E.**

- **PR #317 MERGED** (squash `86a03a7`) — all 5 CI checks green, IB clean @
  `6652a29`. Branch deleted. The four migrations auto-applied to STAGING on merge.
- **⚠ CORRECTION TO A LONG-STANDING LEDGER CLAIM: "PROD MIGRATION APPLY IS
  MANUAL" IS WRONG.** Repeated across many earlier entries in this file, and it is
  stale. `production-deploy.yml` runs `supabase db push --linked` (with a
  `--dry-run` first) as part of the **Deploy Production** job, which fires on
  `release: published` — i.e. when the release-please chore PR is merged and its
  release is published. That workflow has run successfully 8+ times, most recently
  `persistence: v1.8.0` on 2026-07-26. **Production migrations are automatic on
  the release deploy. Do not hand-apply them** (Brad confirmed 2026-07-26).
  - **And the ordering is already correct**: the workflow migrates BEFORE
    `sst deploy`, so the database is always ahead of the code. That is the safe
    direction for the additive Loadout columns — `workoutRepository`'s full-row
    `select().from(workouts)` reads and `GET /exercises/equipment`'s `category`
    projection would 42703 only on the reverse order (new Lambda, old schema),
    which this workflow cannot produce. **The deploy-order hazard flagged on #317
    is handled by CI; no manual sequencing needed.**
  - Residual caveat for a FUTURE change: migrate-then-deploy is only safe for
    ADDITIVE migrations. A destructive one (drop/rename) leaves the old Lambda
    running against the new schema for the length of the deploy — that needs
    expand/contract across two releases, not a workflow change.
- **⚠ PRODUCTION AI OUTAGE — ROOT-CAUSED AND FIXED (by Brad, in the AWS console).
  Claude Haiku 4.5 was never granted in the PRODUCTION Bedrock account**
  (`465891279888`), though it was granted in Development (`111315405717`).
  `POST /nutrition/ai/estimate-text` (5/5 requests) and
  `POST /trainers/me/clients/:id/ai-summary` (8/9; the one 200 was a
  `client_ai_summaries` cache hit) **returned 503 to every production user for 30
  days** while passing every test and working perfectly in staging. Photo
  estimation was fine — different model (`eu.anthropic.claude-opus-4-6-v1`).
  Brad granted Haiku 4.5; production now verifies OK on both ids.
  - **LESSON — BEDROCK MODEL ACCESS IS PER-ACCOUNT AND PER-MODEL.** Staging green
    says NOTHING about production. `eu.` ids are cross-region inference profiles;
    `eu.anthropic.claude-opus-4-6-v1` looks malformed (no `:0`) but is valid —
    don't chase that. `eu.anthropic.claude-opus-5` is still UNGRANTED in prod.
  - **LESSON — the failure was invisible by construction, and this is unfixed.**
    Bedrock's `AccessDeniedException` is a 403 → `isRetryable` declines a 4xx →
    `AiUnavailableError` → the handler **RETURNS** a 503 body → `coreErrorHandler`
    only logs uncaught throws → **not one log line existed for any failure**. The
    provider's explicit "AWS Marketplace subscription cannot be completed" text
    was captured into an error string and discarded. Mobile then relabelled the
    503 as "try rephrasing", advice that could never work.
  - **How to diagnose this class of bug fast:** the API Gateway access log
    (`/aws/vendedlogs/apis/persistence-api-production-apicore-rmbczern`) has
    per-route status + latency. A ~380ms 503 means the provider rejected us
    outright (a 4xx isn't retried); a ~24s 503 means timeouts. Then
    `aws bedrock-runtime invoke-model --model-id <id>` per account for the exact
    exception. AWS profiles: `ess-dev` (dev/staging), `ess-prod` (production —
    Brad added it this session), both via the `ess-dev` SSO session.
- **⚠ PR #318 (deploy-time Bedrock model preflight + failure logging + mobile
  status-aware error copy) was CLOSED UNMERGED at Brad's instruction** — the grant
  is fixed so he doesn't want the gate. **Branch `claude/ai-model-preflight`
  (HEAD `844fd01`) is left in place, NOT deleted.** It contains a working
  `scripts/check-bedrock-access.ts`, `infra/aiModels.ts` (model ids as a single
  source of truth), the `createWithRetry` logging and a shared
  `aiEstimateErrorMessage`. **Do NOT rebuild it from scratch** — cherry-pick if
  the class of failure recurs. Brad's call; don't re-litigate unless asked.
- **STILL TRUE AND UNFIXED (deliberately, per Brad):** a Bedrock failure is
  logged nowhere, and both AI surfaces collapse every non-429 error into
  "Couldn't estimate that — try rephrasing" (`QuickAddSheetContainer.tsx:267`,
  `SnapAISheetContainer.tsx:100`). If AI ever "mysteriously stops working" again,
  that is why, and the fix is on the closed branch.
- **Security audit (Brad asked): server-side entitlement enforcement is REAL, not
  frontend-only.** All six AI endpoints assert `ai_access` before the model call;
  `create_workout` on `POST /workouts` + the fresh-workout branch of
  `POST /sessions/record`; `trainer_clients` on the roster; `loadout` on the new
  variation create. Guard order correct everywhere (entitlement before the model,
  ceilings count actual inferences only, so a 402 never burns quota). The one
  systemic risk: `assertEntitlement`'s catch-all
  `if (feature !== "create_workout") return { allowed: true }` — any new feature
  name added without an explicit routing line **silently allows everyone**, with
  no type error. The three current stubs are deliberately open and nothing on the
  paywall sells them, so there's no live leak.
- Incidental: the prod access log is full of bots probing `/.env`,
  `/.aws/credentials`, `/.git/config` — **all 404, nothing exposed.** Noise.

**2026-07-26 (LOADOUT Phase 0 — backend data model). PR [#317](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/317) MERGED (squash `86a03a7`); was branch `claude/loadout-phase-0`, HEAD `6652a29`.**

- **Scope:** spec-21 Phase 0 = T-0.1…T-0.11, backend only. 4 migrations
  (`saved_gyms`; `workouts` parent linkage; `workout_exercises` provenance;
  `equipment_types.category`), `schema.ts` mirror, `SavedGymRepository` +
  service + 4 CRUD handlers, `GET`/`POST /workouts/:id/variations`, the
  `loadout` EntitlementFeature + `assertLoadout`, feature-aware
  `pickUpgradeTier`, `isNull(parentWorkoutId)` on BOTH `mine` paths, new
  `loadoutRoutes.ts` sub-app.
- **⚠ MANUAL PROD MIGRATION ×4 + DEPLOY ORDER.** Migrations must land BEFORE
  the Lambda: `workoutRepository`'s four full-row `select().from(workouts)`
  reads now emit the new columns and `GET /exercises/equipment` projects
  `category`, so a Lambda ahead of the migrations 42703s **every workout read
  and the shipped mobile equipment picker** — features older than Loadout.
  Accepted, not fixed (explicit projections would restate ~13 columns 4×).
  ~~**`20260725194527_premium_plus_tier.sql` is STILL PENDING on prod and must
  land first**~~ — **STALE, corrected 2026-07-26 (cont. 3): verified present at
  tag `persistence-v1.8.0`** (`git cat-file -e persistence-v1.8.0:supabase/...`),
  and that release deployed, so `loadout_access` IS on prod. What is NOT yet on
  prod is Phase 0's four migrations + the spec-28 consent migration — they sit on
  `main` behind **open release PR #319 (v1.9.0)**; merging it publishes the release
  and the prod deploy applies them.
- **`loadout_access` is deliberately NOT in the shared `loadTier` projection** —
  it's on the hot path of `create_workout` + `ai_access`, so a young
  hand-applied column would break features older than itself.
  `loadFreeTierLoadoutAccess` confines the blast radius to Loadout.
- **A root `.use(loadoutRoutes)` HELD** — no TS2589, including packages/web's
  Eden treaty. The nutritionRoutes comment's "any new leaf route MUST join an
  existing sub-app" is over-cautious for ONE grouped sub-app. Verified with a
  full-workspace `TURBO_FORCE=true typecheck`.
- **SIX equipment categories, not design § 2.3b's five** (Brad's steer). The
  five left bands/ropes/sled/foam roller/yoga mat/box homeless, and "bands only"
  is one of E2's four canonical contexts. `accessories` is the sixth; bench +
  squat rack sit with free weights. design § 2.3b + AC-2.2 updated to match.
- **Two Phase-1 guards PULLED FORWARD** (recorded in tasks.md § "Landed in
  Phase 0 beyond the checklist"): exercise read-visibility on every submitted
  row (new `ExerciseRepository.findUnreadableExerciseIds`), and saved-gym
  ownership when `sourceGymId` is claimed. T-1.6 keeps only the containment half.
- **`GET /workouts/:id/variations` has NO parent read gate, deliberately.** It
  was redundant (response only contains `created_by = caller`) and harmful:
  parent read access is REVOCABLE, so a spec-25 offboarding would have made the
  athlete's own variations unreachable from every surface at once (hidden by
  `parent_workout_id IS NULL` + 404 here).
- **Housekeeping:** `specs/26-coach-data-sharing-consent` → **`specs/28-`**
  (26 was used twice; 45 inbound refs fixed). The applied `20260720230030`
  migration's `COMMENT` still says "(spec 26)" — deliberately unedited.
  **tasks.md T-P0.10 amended**: create the Premium+ ASC products but leave them
  UNSUBMITTED/UNATTACHED until the Loadout launch build.
- **Gates:** prettier · typecheck 8/8 · lint 0-err · build 13/13 · test:unit
  19/19 (core 270 files / **2791 tests**, mobile 449 suites / 5046). Every
  changed file ≥90% (new handlers + savedGymService 100%).
- ~~**⚠ OPEN Brad checkpoints, NOT decided:** equipment-scan ceiling (proposed
  10/day) and programme cap (proposed 120 workouts) are still Claude proposals.~~
  **The scan ceiling was DECIDED 2026-07-27 at 6/day, not 10** (§ Open items →
  § DECIDED). The programme cap is still open. § Open items is the live list.
  **Phase E blocked on ~30 real gym photos from Brad** (E1's dataset).
- **IB: clean @ `6652a29`** — 2 sweeps (7 findings, then 5) + 1 closed
  verification pass. CI action NOT fired. The sweep-2 🟠 was a genuine
  production bug: **`isSavedGymNameConflict` read `code` off the thrown error,
  but Drizzle puts the SQLSTATE on `.cause`** — so every duplicate gym name
  500'd instead of 409'ing, and the test fixture used a flat error shape the
  driver never produces. `stripe/pgErrors.ts` already documented the cause-chain
  walk. **LESSON: when catching a Postgres error by SQLSTATE, walk `.cause` —
  and model the fixture on what the driver actually throws, or the test proves
  nothing.**
- **LESSON — three tests I wrote could not fail.** One asserted a property of
  its own mock fixture (`expect(tx).not.toHaveProperty("update")`); one asserted
  the mock's return value instead of the SQL projection (so dropping a column
  from a `select()` stayed green — the mocked-getDb blind spot in a new
  disguise); one used the wrong driver-error shape. All found by mutation
  testing, all now sensitive. **Mutation-test every new guard — it is the only
  thing that catches a test that cannot fail.**
- **LESSON re-confirmed — `git add -A` swept in Brad's pre-existing untracked
  `docs/app-store/` + `marketing/*.md`.** Caught before committing (the #159
  lesson). Stage with explicit pathspecs and inspect `git diff --cached
  --name-only` first.
- **LESSON re-confirmed — the shell cwd drifts.** Running vitest from the repo
  root instead of `microservices/core` produced 20/20 phantom failures (wrong
  config resolution) that vanished from the package dir. Always `cd` with an
  absolute path before a test run.

**2026-07-25/26 (LOADOUT kickoff + App Store 3.1.2 rejection fix). THREE PRs ALL MERGED to `main` at Brad's instruction: #312 spec triplet (`e7d9556`), #314 marketing copy (`2ae43ad`), #313 M19-P0 + paywall truth pass + Apple compliance (`fe28bd8`). `origin/main` HEAD = `fe28bd8`.**

- **A — spec-21 triplet authored** (`requirements.md` / `design.md` / `tasks.md`), superseding `BRIEF.md`. Loadout = ADAPT an existing workout/programme to available kit, saved as a variation under the parent; original never mutated. Phased P0 → 0 (data model) → 1 (ranker + adaptation) → 2 (mobile) → 3 (scan) → 4 (coach programmes), one phase per PR. Twinned with spec-26 Mealprint § 1 (design § 1 is the canonical statement of the candidate-constrained contract).
- **⚠ TWO PREMISE CORRECTIONS — do not re-inherit the old ones.** (1) **There is NO deterministic substitute ranker to reuse.** `BRIEF.md` § Reuse and the GTM brief both say there is; what exists is the orphaned Postgres fn `get_alternative_exercises` (`002_functions_and_triggers.sql:432`, 50/20/15/±15 weights, **zero TS callers, no route, no tests**) plus `SwapExercisePopover`'s unranked muscle filter. The ranker is net-new Phase-1 work; formula inherited, implementation not. (2) **`equipmentAny` is array OVERLAP (`&&`); Loadout needs CONTAINMENT (`@>`)** — new `equipmentSubsetOf` axis, and `COALESCE(equipment_required,'{}')` is load-bearing (legacy NULL rows). Also `profiles.available_equipment` is write-only/unvalidated — `saved_gyms` supersedes it.
- **⚠ The GTM brief's "mobile paywall is catalog-driven, verify it degrades gracefully" is FALSE.** Both presenters — including the LIVE iOS rail — did `find(t => t.tierName === "premium")`. A new catalog row rendered **no card at all**. P0 rewrote both to iterate non-trainer catalog rows.
- **B — M19-P0 shipped on `claude/m19-p0-premium-plus`** (shared prerequisite with spec-26 — built once, do NOT build twice). Migration adds the `premium_plus` row (£29.99/£299.99) + `subscription_tiers.loadout_access` (true for premium_plus + 3 trainer tiers). No enum — `tier_name` is text+unique, so a new tier is just a row. Registered in `SubscriptionTierName`, `coerceTierName`, `nextTrainerTierUp`, `RC_ENTITLEMENT_IDS`, `rcEntitlementToTier`, `TIER_RANK` (renumbered, premium_plus above premium), `resolveTrial` (shares `has_used_user_trial` with premium), and the mobile maps.
- **⚠ THE ROW IS SEEDED `is_active = false` ON PURPOSE.** `listActive()` filters on it and the new paywall renders every active non-trainer row — an active row publishes a buyable £29.99 card selling a tier whose differentiator doesn't exist. **Launch = a one-line `UPDATE subscription_tiers SET is_active = true WHERE tier_name='premium_plus';` in its own migration, once Phase 2 is device-verified.** The row still exists so the `user_subscriptions` FK resolves and RC promotional entitlements can be granted pre-launch.
- **⚠ `listActive()` now projects explicitly** (omitting `loadout_access`). A bare `select()` emitted every `schema.ts` column, so a Lambda deployed before the hand-applied prod migration would 42703 the PUBLIC `GET /subscription-tiers` and show every user "Failed to Load Subscription Options". **Deploy-order hazard both ways:** the reverse (RC `premium_plus` entitlement arriving before the catalog row is on prod) FK-fails the webhook into a retry loop.
- **⚠ MANUAL PROD MIGRATION** `20260725194527_premium_plus_tier.sql` (staging auto-applies on merge). **ASC/RC ops runbook handed to Brad in chat, NOT committed** — products at £29.99/£299.99, RC entitlement **lookup_key literally `premium_plus`** (`revenueCatClient.ts:107` reads `lookup_key`, not product id), both attached to the `default` offering. Product ids must contain the literal `premium_plus` — `tierFromProductId` is a substring ladder and `premiumplus`/`premium.plus` would silently grant Premium.
- **Deliberately NOT built in P0:** the `loadout` EntitlementFeature + `assertLoadout` (Phase 0), and feature-aware `pickUpgradeTier` — `loadout` doesn't exist as a feature yet, so that branch was unreachable and only passed coverage behind a `v8 ignore`. Reverted and moved to Phase 0. **No taster code anywhere** — hard gate, RC promos only.
- **Gates (P0):** prettier · typecheck 8/8 · lint 0-err · build 13/13 · test:unit 19/19 (core 268 files/2700 tests/98.47% cov, mobile 448 suites/5032 tests).
- **LESSON re-confirmed (twice):** `bun run test:unit` is NOT a typecheck. After reverting the `pickUpgradeTier` signature the suite was green while `tsc` failed on the stale two-arg test calls. Run `TURBO_FORCE=true bun run typecheck` separately, always.
- **LESSON:** three DIFFERENT suites flaked under parallel load this session (`ClientDetailContainer`, `trainersMeGenerateClientAiSummaryHandler`, `useMySubscription` — the last has a pre-existing "Jest did not exit" open handle). All passed in isolation. Don't chase a single-suite failure before re-running it alone.
- **LESSON:** local `main` was **stale by one merge** (#311 Loadout rename + £29.99 reprice + spec-26 Mealprint). I flagged three "drift" items to Brad that were pure stale-checkout artefacts. **`git fetch` before trusting the working tree at session start.**
- **B is PR [#313](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/313); marketing companion is [#314](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/314).** Five IB sweeps on #313.
- **⚠ UNBUILT-FEATURE SWEEP (Brad, 2026-07-25): "the only scope we have are the two — Loadout and Mealprint".** Analytics, data export, **Gym Buddy** and **"N AI-generated workouts per month"** were all sold across the paywall and NONE exist (no analytics screen, no export path, `gym_buddy` is an `assertEntitlement` stub with no backend surface or UI, no workout-generation path in `application/workouts`). Took FOUR passes to find them all because the same string lives in three kinds of place: (1) `getFeaturesList`'s `isTrainer` branch — **UNREACHABLE at runtime** (coach tiers render via `TrainerSubscriptionCard`, which doesn't take it); (2) hardcoded JSX in `TrainerSubscriptionCard` — what coaches actually saw; (3) **`subscription_tiers.description`**, seeded in 004, rendered verbatim in the Profile Drawer for EVERY user (free users too, via the synthesised free row) — TypeScript cannot reach it, needs a data migration. **LESSON: when de-claiming a feature, trace every channel it reaches the user through, not just the string you found first.**
- Replacement copy: the consumer card now shows **AI nutrition logging (Snap AI, shipped)** where the AI-workout count was — without it Premium's card read identically to Free's. KEPT because real: "AI supported reporting" on the coach card (`POST /trainers/me/clients/:clientId/ai-summary`, rendered in coach Client Detail) — one IB sweep wrongly flagged it as unbuilt; an earlier sweep had verified it. **Don't take a single sweep at face value on a "this doesn't exist" claim — grep for the endpoint.**
- **STILL OPEN (Brad's):** "(Save 20%)" on the yearly toggle — every seeded annual price is 16.7% off. Pre-existing, on an App Store review surface.
- **LESSON — turbo caches `test:unit` too.** `supabase/migrations/**` is NOT an input to `@persistence/core#test:unit`, so editing a migration doesn't invalidate the cache and a stale green hides a real failure (cost a red CI run on #313). **Run `TURBO_FORCE=true bun run test:unit` before pushing**, same as typecheck.
- **LESSON — the shell cwd silently reverted from the worktree to the main checkout mid-session** and a fix landed on the wrong branch; a later `git checkout --` (cleaning up after mutation testing) then reverted an uncommitted edit in the worktree. **Prefix EVERY tool path with the worktree path, and never `git checkout --` a file with uncommitted work in it.**
- **Mutation-test every new guard.** Three tests I wrote could not fail (one asserted `toBeLessThanOrEqual(1)` where both branches gave ≤1; two asserted substrings that the migration's own comment prose satisfied). All found by IB, all now verified by breaking the implementation and watching them fail.
- Restored the 2026-07-23 BRIEF-7 ledger entry, which was written but never committed (it was sitting uncommitted in the working tree and #311 landed a 07-24 entry on top of it).

### 2026-07-26 additions (same workstream)

- **⚠ APP STORE REJECTION (2026-07-26), Guideline 3.1.2** — no functional Terms
  of Use (EULA) link in metadata. Decision: **Apple's STANDARD EULA**, no custom
  agreement uploaded. Runbook is Brad's `docs/app-store/`. Code side landed in
  #313: `domain/models/legal.ts` (single source of truth for
  `TERMS_OF_USE_URL` / `PRIVACY_POLICY_URL` / `SERVICE_TERMS_URL`; `consent.ts`
  re-exports), `SubscriptionLegalFooter` rendered on BOTH paywall rails.
- **⚠ 3.1.1 FIXED, and it was the bigger risk.** The annual Small Business /
  Medium-Enterprise tiles rendered a **"Contact Sales" mailto** — selling a
  subscription that unlocks in-app coach functionality OUTSIDE IAP, from the
  paywall. Annual IAP isn't possible for both anyway (**£3,000/yr is above
  Apple's standard price points**). Those tiers are now hidden on the yearly
  cycle (`MONTHLY_ONLY_TIERS`) + an explanatory note; `handleContactSales`,
  `SALES_CONTACT_EMAIL` and `contactSalesMode` all deleted. **Do not
  reintroduce a sales mailto on a purchase surface.**
- **⚠ `NSHealthUpdateUsageDescription` was FALSE** — claimed "We do not write or
  modify your health data" while `writeSleep`/`writeBodyWeight` are live and
  write scopes are requested. Rewritten. Purpose strings must match behaviour.
- **Disclosure copy is STORE-AWARE** — `rail="store"` resolves Apple vs Google
  Play by `Platform.OS`, so a future Play submission needs no call-site change.
  `rail="card"` for the Stripe rail.
- **PAYWALL TRUTH PASS (Brad, 2026-07-25): only unshipped features we advertise
  are Loadout and Mealprint.** Analytics, data export, **Gym Buddy** and
  **"N AI-generated workouts per month"** were all sold and NONE exist
  (`gym_buddy` = entitlement stub, no workout-generation path anywhere).
  Stripped from `getFeaturesList`, `TrainerSubscriptionCard`,
  `SubscriptionSuccessContainer`, the tier `description` column (migration step
  4 — the Profile Drawer renders it verbatim, TypeScript can't reach it) and
  the marketing site (#314). Replaced on the consumer card with the row
  `ai_access` really unlocks: **AI nutrition logging** (Snap AI, shipped).
  "AI supported reporting" on the coach card KEPT — the AI weekly client
  summary is real.
- **"(Save 20%)" → "(2 months free)"** — every annual price is exactly 10x
  monthly, i.e. 16.7%, so the old copy overstated on a review surface.
- **⚠ SPEC RE-SEQUENCED (Brad, 2026-07-26): new Phase E eval spike.** The scan
  was sequenced LAST despite being the highest-value AND highest-risk piece.
  **E1** measures whether a vision model can actually read a gym (needs ~30
  real gym photos — **Brad's input, currently blocking**); the scan endpoint
  then ships INSIDE the Phase 2 slice. **E2 is a bake-off**: deterministic
  ranker vs candidate-constrained AI composition, scored blind — **D7 is now
  decided by evidence, not asserted.** Hallucination is NOT a reason to prefer
  deterministic: under D6 the model picks ids from a server-built list.
- **⚠ DO NOT submit the `premium_plus` ASC products with the next build** —
  the tier ships `is_active = false`, so a reviewer can't reach it and an
  unreachable IAP product is its own rejection. Create, leave unsubmitted,
  attach at the Loadout launch build.
- **Design handoff stays at `~/Downloads/Any Gym/project/`** — Brad confirmed
  2026-07-26 it's a stable path and won't move, so it is deliberately NOT
  committed. The old readiness-brief action to commit it is CLOSED.
- **LESSON (cost):** five Inspector Brad sweeps on one PR, each with an
  open-ended "find anything new" prompt, burned a large share of the context
  window. Cap at two sweeps + one CLOSED verification pass ("confirm these N
  items, findings only"), and ask recon agents for conclusions with file:line
  pointers rather than quoted code.
- **LESSON (worktrees, again):** the shell cwd silently reverted from the
  worktree to the main checkout mid-session and an edit landed on the wrong
  branch. **Always pass absolute paths inside a worktree; re-check `pwd`.**
