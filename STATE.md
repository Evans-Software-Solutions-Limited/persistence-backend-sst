# Project memory · persistence-backend-sst

Canonical state ledger. NOTE(Brad): previous ledger lives at
`~/.claude/projects/<hash>/memory/MEMORY.md` — copy any still-relevant
content in with:
`cp ~/.claude/projects/*/memory/MEMORY.md ./STATE-old-ledger.md && review`

Read this at session start; update it before ending any session.
Cross-check with `git log --oneline -30` — anything here that contradicts
the git history is stale.

## Verified facts

- SST 3.19.3 (Ion) per `package.json` / lockfile (verified 2026-07-05).
- Workspaces: `packages/` (api-utils, db, mobile, seed, web) +
  `microservices/core`.
- Legacy mobile app (port reference) at sibling path
  `../persistence-mobile/`.
- Slack channel for progress updates: `#brad-claude-agents` =
  `C0ATYL6T11V` (hardcoded in the slack-progress-updates skill).
- As of 2026-07-11, `main` HEAD is `0dbe02c` (Merge PR #197 — Coach Home v1).
  Recent merges: #195/#196 trainer-client-caps (→ `39f6c63`), #197 Coach Home v1
  (→ `0dbe02c`). Coach Mode is now complete except Phase 8 (invite-QR). See "Last
  session" for detail. (Older facts below may lag — cross-check `git log`.)
- **2026-07-12: Phase 8 (invite-QR + coach-accept) BOTH MERGED — #198 backend
  (squash `e1df44d`) + #202 mobile (squash `7492f9b`). `origin/main` HEAD =
  `7492f9b`. COACH MODE IS NOW COMPLETE (all phases).** Both Inspector-Brad-local
  clean, all CI green. ⚠ **4 migrations auto-applied to STAGING on the #198 merge;
  PROD apply is MANUAL + STILL PENDING** (`20260711140000` initiated_by column,
  `140100`/`140200` enum values, `140300` trigger rewrite). ⚠ NOTHING device-
  verified — needs a FRESH EAS dev build (QR + expo-clipboard are native).
  (NB: #199 + #201 — client-detail fixes + macro calculator — also merged to main
  around the same time, by Brad; my PRs landed on top cleanly.) See newest "Last
  session" entry.
- (historical) As of 2026-07-09, `main` HEAD was `0e6a0d7` (Merge PR #185 — Athlete Training
  page mobile). Coach Mode: Phases **0–7, 9, 11, 12 + 5/6 MERGED**; remaining =
  Phase 8 (invite QR, decision #2), Phase 10 (Coach Home, decision #1). Reshaped
  roadmap: **Athlete Training page SHIPPED** (#184 backend + #185 mobile);
  remaining = Send-brief, Live-session milestone (Start + Swap).
  (Older facts below may lag — cross-check `git log`.) **spec-19 Programs = FULLY SHIPPED** (backend
  #148/#149/#152 + mobile #166: coach Programmes tab/editor/assign sheets +
  athlete Home card/Today's-training + Client Detail programme surfaces + the
  `/users/me/home` activeProgramme/todaysTraining extension +
  `/trainers/me/clients/:id/active-programme`). Untracked: `STATE.md`,
  `marketing/`, `app-store-tracker.html`, `specs/milestones/M13-sync-hardening/`,
  `M14-responsive-hardening/`, `COMPLIANCE-SPRINT-BRIEF.md`.

## General rules

- `specs/milestones/ROADMAP.md` § Phase status was refreshed 2026-07-05
  (#157) but can lag again — this file + `git log` are authoritative.

## Go-live gaps (mobile) — NOT YET BUILT

- ~~**Remove a logged calorie/nutrition entry — NO UI**~~ **SHIPPED — PR #179
  MERGED (2026-07-08, main e508ee8).** Swipe-to-delete on Fuel entry rows (ReanimatedSwipeable →
  red Delete), optimistic + offline-coalesced (cancels an un-drained create/edit
  instead of firing a 404-looping DELETE). PR #179 ALSO ships: `custom_name`
  column so AI/one-off entries show their real name not "Quick entry"; P/C/F
  macros on logged rows + search results; `swapLocalNutritionEntryId` id-swap
  closing the in-flight-create delete-orphan window. Awaiting merge + device
  verify (needs EAS build). ⚠ PROD MIGRATION manual: `20260708120000_
nutrition_entries_custom_name.sql` (staging auto-applies on merge).

## Open failures

- _(resolved 2026-07-06)_ Monday-boundary habits-test flake — fixed in #167 (test
  now anchors on `localDayISO()` + a deterministic Mon→Sun boundary test in
  `date.test.ts`; NO prod change — `weekStartMondayISO` was already correct). It
  was a LOCAL-only flake (BST machine near midnight); UTC CI never saw it. Now on
  main. Note learned: the "blocks CI on Mondays" fear was overstated — CI runs UTC
  (localDayISO === UTC date there), so it only bit the local dev gate.
- **#159 swept pre-staged index WIP into main** (2026-07-05). The working tree
  had staged changes at session start (`M CLAUDE.md`, `D .claude/skills/
elysia-route-change.md`, `D .claude/skills/sst-resource-change.md`); my
  Phase-0 `git commit` committed the whole index, so those rode into #159:
  - CLAUDE.md formatting broke the staging deploy's `prettier --check .` →
    hotfix **#162** (blank-line removal, content retained), staging deploy
    now GREEN incl. migrate + deploy.
  - **Two skill .md files deleted on main**; their replacement dir-form
    (`.claude/skills/{elysia-route-change,sst-resource-change}/`, created
    pre-session) is UNTRACKED, so on a clean checkout both skills are gone
    until Brad commits the new dir form. **ACTION FOR BRAD:** commit the
    dir-form skills to finish that migration (or restore the .md if the
    dir-form was abandoned). Not reverted by me — the deletion looked
    intentional (part of your refactor).

## Lessons learned

- **Commit with explicit pathspecs; inspect the staged set first.** `git commit`
  commits the whole index — pre-staged WIP present at session start rides along.
  Use `git commit -- <files>` / verify `git diff --cached --name-only` before
  committing. (Caused #159 to carry unrelated CLAUDE.md + skill-deletion WIP.)
- **PR prettier is change-scoped; the staging deploy runs `prettier --check .`
  over the whole tree.** A green PR prettier job does NOT guarantee the deploy's
  prettier passes. Run `bun run prettier:check` (repo-level) before merging —
  and note untracked local files (STATE.md, marketing/, milestone briefs) show
  as warnings locally but are invisible to CI's clean checkout.
- **Deploy Staging auto-applies migrations** (Migrate database step) — so a
  merged migration hits the STAGING DB on merge (prod is separate/gated).

## Last session

**2026-07-14 (later) — Supabase prod-setup + multi-env: LARGELY DONE. Staging fully stood up on the new isolated project + smoke-verified; prod project created (cutover pending). 5 PRs shipped this session (#224 setup+CI seed/refresh workflows, #225 CI password-quoting fix, #227 OFF dump refresh w/ serving_quantity, #226 backend-fingerprint cache, #228 app variants). All IB-local clean + CI green. ⚠ **SSL-enforcement broke the DB client** (client.ts set no ssl option → `ESSLREQUIRED` on the seed AND the Lambda DB path — the staging smoke test's 401 was the auth guard firing BEFORE any DB query, so it missed this). FIXED = **PR #229** (`ssl: "require"`). ⚠ **Seed then HUNG** on the transaction pooler (6543): connected + wrote system user, then wedged on the reference insert with ZERO DB backend activity (pg_stat_activity = only bg workers) — Supavisor transaction-mode parks the client connection between transactions. FIXED = **PR #230** (seed runs over the SESSION pooler 5432; Lambda stays on 6543). **GOTCHA: bulk seeds/migrations = session pooler 5432; serverless/Lambda = transaction pooler 6543.** merge #229 (done) + #230 (done) → **STAGING SEED COMPLETE** (run 29369513251 green: exercises 2281, foods 144043 [147408 read / 3365 filtered — no barcode/name/complete macros, matches old ~142,972], + reference + migration-seeded tiers/goals/achievements). Legacy `sync_exercise_to_algolia` trigger RAISEs a harmless WARNING per exercise insert (app doesn't use Algolia — searches Postgres; cleanup chipped `task_49abbbed`). REMAINING (Brad): prod cutover (Production secrets → prod, gated deploy, seed) → device-verify EAS staging build → IAP sandbox sign-off gate. **LESSON: after prod cutover, verify a DB-TOUCHING authed endpoint, not just a 401.** See per-topic bullets below + `specs/milestones/SUPABASE-PROD-SETUP/`.**

_(Original entry — kept for the detailed arc:)_ **Supabase prod-setup: Phase 0 audit DONE + decisions LOCKED + committable runbook written.**
Operational task: split the single shared free Supabase project into isolated staging + prod. New docs under `specs/milestones/SUPABASE-PROD-SETUP/` — `PHASE0-FINDINGS.md`, `DECISIONS.md`, `RUNBOOK.md` (all no-secrets, committable).
- **Live state:** ONE free project `dfeyebgdktfteqlacmru` (org `yeasty-apricot-zahshtf`, eu-west-2, PG17) serves BOTH stages. Only **4 test auth users** + reference data (142,972 foods / 0 with serving_quantity, 2,281 exercises, 28 equipment, 5 tiers) → no real prod data.
- **Brief corrections (verified):** (1) RLS is NOT off — 59/60 public tables have RLS ON; exposure is anon/authenticated grants + `revenuecat_webhook_events` (RLS off) → fix = **disable the Data API**, NOT enable RLS. (2) `SUPABASE_URL` is NOT a GitHub secret — hardcoded per-stage in `packages/api-utils/src/domains/domain-config.ts:68-71` (+ test `:84,94`) AND mobile `packages/mobile/eas.json` + `.env.example`; Phase-4 "update infra/domains" = a code edit there. (3) Seed maps serving_quantity but the committed `off-uk.jsonl.gz` (Jun 28) lacks the field AND `refreshOffDump.sh` didn't project it → **FIXED this session**: `refreshOffDump.sh` now `TRY_CAST`s top-level `serving_quantity` + seed-header example updated. Dump must be regenerated (`bun run refresh:foods`, needs DuckDB — couldn't run in-sandbox) + committed before the prod foods seed.
- **Cutover is low-risk:** workflows already read `SUPABASE_PROJECT_REF`/`DATABASE_URL`/`SUPABASE_DB_PASSWORD`/`SUPABASE_SERVICE_ROLE_KEY` per GitHub Environment (`staging`/`Production`) → divergence = just different secret values + the domain-config.ts/eas.json URL edits. No workflow/`sst.config.ts`/`infra/secrets.ts` change. SST secret names: `PersistenceDatabaseUrl`/`SupabaseServiceRoleKey`/Stripe*/RevenueCat*/`ExpoAccessToken`. ⚠ RevenueCat GitHub secret names have NO underscores (`REVENUECATAPIKEY`).
- **Decisions locked (Brad, AskUserQuestion):** two fresh projects (retire old free one only after cutover proven); **staging = Free in the EXISTING org**, **prod = new org upgraded to Pro + Small compute + PITR 7-day** (two orgs required — Supabase bills per-org); both eu-west-2.
- **Phase 1 DONE:** `persistence-staging` CREATED via MCP (ref `nxkhlrvjxotyjulodxzk`, free org, eu-west-2). `persistence-prod` CREATED by Brad (ref `opcvjypsoivaxerahbal`, NEW separate org, **Micro** for now — Small/PITR DEFERRED so PITR not yet active). Coords in `PROVISIONED.md`.
- **⚠ MCP scope wall:** the Supabase MCP connector is authorised ONLY for org `yeasty-apricot-zahshtf` (sees staging + old persistence). The prod project is in a DIFFERENT org → **every MCP call on `opcvjypsoivaxerahbal` = "permission denied."** All prod work = dashboard + CI. Re-auth the connector for the new org to let Claude help prod via MCP.
- **⚠ Migrations must NOT go via MCP:** `apply_migration` doesn't preserve the repo's migration versions → would break the CI `supabase db push` (non-idempotent re-apply). Migrations for BOTH projects go through CI `db push` (needs Brad's GitHub secrets).
- **PR #224 MERGED (squash `9fdabea`).** ⚠ **Staging deploy run 29347892253 FAILED at "Migrate database (dry-run)"** — `supabase db push` → Postgres `28P01 password authentication failed for user "postgres"`. The staging GitHub env **`SUPABASE_DB_PASSWORD` does not match the linked project** (and/or `SUPABASE_PROJECT_REF`/`DATABASE_URL` not repointed to `nxkhlrvjxotyjulodxzk`). Failed BEFORE the real migrate + SST deploy → **nothing applied/deployed; new staging project still 0 tables; no half-state.** (NB `gh run watch --exit-status` misleadingly returned 0; authoritative check = `gh run view --json conclusion` = failure, + MCP list_migrations on the new project = empty.)
- **ROOT CAUSE FOUND (Brad spotted it): the deploy workflows never exported `SUPABASE_DB_PASSWORD` to the migrate step env** — password was only on the `--password` flag, but the `latest` supabase CLI reads it from the env var (its error literally said so). `link` succeeded (access-token auth), `db push` 28P01'd regardless of the secret value. 3 staging deploy runs failed this way (16:05/16:39/16:47) even after Brad correctly updated all the staging secrets (verified via gh api updated_at: PROJECT_REF/DB_PASSWORD/DATABASE_URL all set today; ACCESS_TOKEN unchanged = fine, account-level).
- **FIX = PR #225 (`fix/deploy-supabase-password-quoting`)**: export `SUPABASE_DB_PASSWORD` (+ `SUPABASE_PROJECT_REF`) via each step's `env:` + quote all expansions, in BOTH deploy-staging.yml + production-deploy.yml. **MERGED — main = `ddecd2d`.** (Real root cause was likely a value mismatch Brad also corrected; #225 is correct hardening regardless + matches the CLI's env-var preference.)
- **STAGING DEPLOY GREEN (run 29353063508 @ ddecd2d).** Migrate applied the full 63-migration chain to `nxkhlrvjxotyjulodxzk`; SST deploy succeeded.
- **PHASE 7 SMOKE (staging) — 5/6 PASS (verified via in-app browser; curl+MCP sandbox-blocked):** ✅ migrations applied ✅ API live ✅ JWKS on new project (ES256) ✅ authed route `/users/me/home` no-token → 401 ✅ anon PostgREST → 503 PGRST002 zero-data (Data API closed, stable). ⏳ REMAINING: positive authed read/write (needs a real user JWT — do on the staging app or Brad supplies a token; I won't create an account). ⚠ Data-API check returns PGRST002 (schema-cache) not a clean 404 — consistent with disabled but Brad should confirm in dashboard the Data API is explicitly off / `public` unexposed.
- **STILL TODO staging:** run **Seed Database** workflow (exercises + foods; refresh OFF dump first for serving_quantity — only subscription_tiers/goal_types/achievements are migration-seeded so far). Then repeat the whole cutover for PROD (secrets → gated deploy → seed → smoke) + prod eas anon key already baked in PR #224.
- **IAP decision (Brad 2026-07-14):** **staging IAP DEFERRED** — do NOT stand up a staging RevenueCat project. Staging variant build keeps the PROD RC key (`EXPO_PUBLIC_REVENUECAT_IOS_KEY`) so the SDK inits; purchases not exercised on staging. **IAP verified via SANDBOX on the PRODUCTION build** instead (Apple sandbox testers, real product set). ⚠ **LAUNCH SIGN-OFF GATE:** sandbox-buy each tier on the prod build → confirm entitlement syncs via RC webhook → prod backend → unlocks, BEFORE final go-live sign-off. (RC webhook is per-project → a separate staging RC project would've been needed for staging→staging-API routing; not worth it now.) Staging ASC app id = **6790912063** (bundle `com.bradleyevans96.persistence.staging`) → goes in `eas.json submit.staging.ascAppId`.
- **MULTI-ENV FOLLOW-UP (Brad chose "fingerprint now + variants now"):** the offline SQLite cache (`persistence.db`, single fixed name) had NO backend awareness → stale data survives a backend switch; staging+prod are the SAME bundle id today (shared sandbox). Two-part fix: (1) **backend-fingerprint cache/session auto-wipe → PR #226 OPEN** (`feat/mobile-backend-fingerprint`, IB-local clean, mobile gates green tsc/lint/prettier/**jest 4567**): stamps `meta.backend_fingerprint` = compiled Supabase URL; absent‖differs → clearAll (in a txn) + `clearLocalSession()`; needs device-verify on EAS. (2) **App variants → PR #228 OPEN** (`feat/mobile-app-variants`, IB-local clean, mobile gates green tsc/lint/prettier/**jest 4570**): NEW `app.config.ts` (Expo dynamic, extends app.json, per-variant scheme/bundleId/package; staging `.staging`+`persistencemobile-staging`, dev `.dev`; **PROD byte-identical — display-name change reverted per IB 🟢, prod rename left as Brad's separate call**); `eas.json` APP_VARIANT per profile + `submit.staging.ascAppId=6790912063`; `deep-link.ts` scheme-family regex (`/^persistencemobile(?:-[a-z0-9]+)?:\/\//i`, pure module, prod parity kept). ⚠ **REQUIRED before a staging build works (IB 🟡):** add `persistencemobile-staging://auth/callback`+`://**` to staging Supabase redirect allow-list + `com.bradleyevans96.persistence.staging` to its Apple-provider Client IDs. Staging RC key stays prod (IAP deferred); per-variant icons deferred. Device-verify on EAS. (2 🟢 folded: deterministic `gzip -nc` + TRY_CAST comment). ⚠ **Set the GitHub `staging` secrets to the NEW staging project BEFORE merging** — merge auto-triggers `deploy-staging.yml` (migrate+deploy); if secrets still point at the old project the Lambda's SUPABASE_URL (new, JWKS) and DATABASE_URL (old) disagree. Prod safe on merge (gated workflow). Contains: `domain-config.ts` SUPABASE_URLS → staging `nxkhlrvjxotyjulodxzk` / prod `opcvjypsoivaxerahbal` (+ test, `bunx vitest` 82/82); `eas.json` STAGING profile → new staging URL+anon (**PROD profile NOT edited** — needs prod anon key, MCP can't read it); `refreshOffDump.sh`+seed-header serving_quantity fix; the SUPABASE-PROD-SETUP docs; and **2 new dispatch workflows** — `seed-database.yml` (seed exercises/foods/both into staging|Production via env `DATABASE_URL`) + `refresh-off-dump.yml` (regenerate off dump via DuckDB, pushes a branch to PR; best-effort, local `bun run --filter @persistence/seed refresh:foods` is the reliable fallback). ⚠ Don't merge until each stage's GitHub secrets point at the matching project.
- **PITR DROPPED** (Brad 2026-07-14 — ~$100/mo too much pre-launch): prod stays **Micro + daily backups only**; revisit PITR (needs ≥Small) post-revenue. Docs updated.
- **RevenueCat webhook path = `/revenuecat/webhook`** → RC dashboard webhook URLs: staging `https://api.staging.persistence.evans-software-solutions.com/revenuecat/webhook`, prod `https://api.persistence.evans-software-solutions.com/revenuecat/webhook`. `EXPO_PUBLIC_REVENUECAT_IOS_KEY appl_...` is one public SDK key shared across stages (expected).
- **SUPABASE_URL is NOT a GitHub secret** — baked into `domain-config.ts` (on the branch). Brad's staging/prod URL values match. No GH secret needed for it.
- **NEXT (Brad, dashboard/CI):** (a) both projects: disable Data API + enable auto-RLS + enforce SSL + auth hardening; (b) grab secrets (DB pw, pooler `DATABASE_URL` :6543, service_role, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`) → GitHub `staging`/`Production` Environments; (c) paste Claude the prod anon key → Claude finishes `eas.json` prod profile; (d) regenerate OFF dump (`refresh:foods`, DuckDB) so foods seed carries serving_quantity; (e) merge code+secrets together → staging deploys+migrates; seed; verify; then gated prod. Full steps in `RUNBOOK.md` + the guide handed in chat 2026-07-14.

**2026-07-14 — Barcode serving-size full fix (#223) + active-workout-over-drawer fix (#222) BOTH MERGED. `origin/main` = `6cd6482`. IB-local clean, all CI green. NOT device-verified (need EAS). app-store-tracker.html refreshed (HEAD→6cd6482, 2 new device-QA items) + artifact re-published.**
Executed the queued barcode spec ([[project_barcode_off_data_quality]]) + a small drawer z-order bug Brad flagged. Built inline on Opus; delegated only the mechanical mobile-fixture threading to a grunt-worker (Haiku). Brad authorised the merge on IB-clean.

- **PR #223 `feat/barcode-serving-quantity` (backend + mobile, 1 PR).** New `foods.serving_quantity` (nullable numeric; migration `20260714120000`). Shared `nutrition/services/offEnergy.ts::kcalFromOffNutriments` — kcal→kJ (÷4.184) fallback, rejects negative, used by BOTH the live resolver AND the seed/delta mapper (so kJ-only products resolve AND seed, not just resolve). OFF client + offMapper read `serving_quantity` (positive-only→null) → ResolvedFood/OffFoodRow/FoodDTO; `upsertManyFromOff` persists + refreshes on conflict. Mobile: `Food.servingQuantity`; `portionToServings` Serving mode = `value×realServing/servingSize` — **macros STAY per-100g**, servingQuantity is ONLY the Serving-tab multiplier; null → byte-identical legacy behaviour (custom foods + the ~143k pre-existing seeded rows unaffected). Scan label shows real pack grams. Foods round-trip via the `cached_foods` JSON payload (no SQLite schema change). PgDialect guard on the new conflict fragment. Gates: core **2455** vitest (changed 100% / global 92.3% br) + mobile **4560** jest + tsc 8/8 + lint 0-err + build 13/13 + prettier clean. IB-clean @ bdd37ea (folded in 1 🔵 negative-kcal parity). **⚠ PROD migration MANUAL** (staging auto-applies on merge). **⚠ ~143k seeded rows stay serving_quantity=NULL** (cache-first) — Serving tab = servingSize for them (unchanged) until a **manual re-seed** re-ingests the OFF dump via `seedOpenFoodFacts.ts` (can't run the DuckDB/dump step in-sandbox — documented follow-up, NOT in the PR). Scan-sheet macro/serving editing-before-Add = still deferred (Brad's product call, not built).
- **PR #222 `fix/active-workout-bar-over-drawer` (mobile).** The floating "workout in progress" bar (`ActiveWorkoutOverlay`) painted OVER the open profile drawer — both are root-mounted siblings in `app/(app)/_layout.tsx` and the overlay mounts AFTER the drawer with no z-index. Fix: gate `visible` on `!drawerOpen` (from `useDrawer`), mirroring the existing `!onSessionScreen`/`!inAuth` posture. Revert-guarded test (IB 🟡: my first test was vacuous — passed pre-fix because auth hadn't resolved; fixed to assert bar present → toggle drawer → hidden → reappears). CI fully green.
- **Mechanics:** grunt-worker (Haiku) threaded `servingQuantity: null` into 13 mobile fixture files (excluded the 3 I was editing for behaviour, to avoid the parallel-edit collision lesson); its work re-verified by me (tsc + tests in the main loop). STATE.md updated but left UNCOMMITTED on the feature branch (established pattern). ntfy likely still sandbox-blocked; Slack ping attempted.

**2026-07-13 (cont.) — Device-QA clusters 3–7 ALL MERGED (#215–#219) + carry-code-through-signup follow-up MERGED (#220). `origin/main` = `9805221`. Plus a new barcode-scan review (fix queued as own spec). NOTHING device-verified (all need EAS). app-store-tracker.html + STATE refreshed; artifact re-published.**
Picked up the queued clusters from the audit below. Brad authorised merging on IB-pass; he device-reviews on main after. `origin/main` = `9805221`.

- **Barcode-scan review (new, from a Brad screenshot):** the calorie/macro mismatch is NOT our bug — verified the live OFF API for barcode `5045098404823` returns exactly what the app shows (195kcal/12/20/6.8); OFF's crowd entry is stale vs the physical pack. The "Serving = 100g" IS a real design gap (backend requests OFF `serving_size` at `openFoodFacts.ts:16` but never reads it; hardcodes 100g at `:79` + `offMapper.ts:90`; `serving_quantity` never requested). **Brad chose: full fix as its OWN SPEC, queued AFTER clusters 3–7.** Caveats for that spec: macro-basis coupling (Food model stores per-serving macros; keep per-100g + use serving_quantity as a display multiplier) + ~143k seeded rows already at servingSize=100 (cache-first → need re-seed/delta). Latent bonus bug: energy read only from `energy-kcal_100g` (`:69`) — a kJ-only product reports barcode_not_found (÷4.184 fix). See memory [[project_barcode_off_data_quality]].
- **Cluster 3 — accept-invite deep link (#2) → PR #215 MERGED (`ed34f49`).** New `app/+native-intent.ts` `redirectSystemPath` → shared `redirectSystemPathForDeepLink` in `deep-link.ts` reusing `SCHEME_HOSTS` (handles full-URL, createURL leading-slash, + legacy host-form; unknown paths pass through unchanged). QR/Share now use `Linking.createURL("/accept-invite",{queryParams:{code}})`; jest `createURL` mock made query-faithful. IB clean. **FLAG (not built, Brad's product call):** unauthenticated athlete loses `?code=` through the `/(auth)/sign-in` redirect (`app/_layout.tsx:173`) — registered-only vs carry-code-through-signup.
- **Cluster 4 — nutrition freshness (#3) + Habits/Fuel calorie unification (#9) → PR #216 MERGED (`f2616fb`).** #3: `FuelTargetsContainer.onSave` now calls `useFuelSheets().notifyMutated()` (used the existing sheetRev mechanism, NOT the brief's useFocusEffect — the fuel hook guards mount-refresh on staleness so an unconditional focus-refresh clobbered fresh caches + broke 4 tests). #9: `daily_kcal` is the single source of truth for the calorie habit, **derived-at-read** (new pure `resolveCalorieHabitTarget`; `validateHabitConfigInput` gained an optional readOnly-target override + SKIPS the client range-check for read-only targets — IB 🟡 fix, else a sub-500/over-20000 fuel target 422'd the habit; self+coach GET resolve live for display; self+coach PUT substitute; streak scoring `getCollectionHabitAggregates` bands the calorie habit off daily_kcal so it agrees with nutrition_streak). NO migration. #9b bulk/cut DEFERRED.
- **Cluster 5 — real kg/lb (+ cm/ftin) display preference (#8b) → PR #217 MERGED (`b6c1676`).** New `src/shared/utils/units.ts` (KG_PER_LB, kgToLb/lbToKg, weightInUnit, formatWeight, volumeInUnit, formatVolumeParts, formatVolume, cmToFeetInches, formatHeight) — **kg/cm byte-identical to before**, only imperial converts. Threaded via `useProfilePage().weightUnit ?? "kg"` in containers → presenters across ~15 surfaces (body-weight tile+delta, previous-set chips + column headers, PRs, volume You+Home+summary+workout-detail, Fuel targets weight+height, profile drawer). Consolidated 5 copy-pasted KG_PER_LB. Backend confirmed to project weightUnit/heightUnit (`profileRepository`). Built via `implementer` (Sonnet), reviewed+gated in main loop. IB 2 🟡 (metric no-regression) FIXED. **OUT (documented):** goals (own goal.unit), dead BodyWeightTile/MyProgressSection, coach ClientDetail + coach nutrition label stay "kg" (payloads don't carry client weightUnit yet — follow-up).
- **Cluster 6 — workout creator/editor restyle (#4a) + remove client-detail Create (#4b) → PR #218 MERGED (`3dcc897`). ⚠ On-device VISUAL verify still outstanding.** Built to the v3 prototype (`~/Downloads/handoff/design-source/screens/workout-creator.jsx`). #4a = VISUAL-LAYER-ONLY: new foundation `Field`/`Stepper`/`RepRange`; both presenters now render a shared new `WorkoutFormBody` (editor==creator); ExerciseConfigCard restyled keeping ALL business logic + testIDs + "Inherited from superset". **Deliberately OMITTED (net-new, no existing logic — flagged): drag-to-reorder, delete-workout+confirm modal, disable-Save-when-invalid.** Kept "Create/Edit Workout" header (container tests) but Save label is prototype sentence-case. #4b = removed the client-detail create-assign quick-action + prop + test + rewrote STORY-007. ⚠ `WorkoutCreatorContainer`'s assignClientId path now entry-point-less but retained. Built via `implementer` (Sonnet), reviewed+gated in main loop. IB clean (no 🔴/🟠/🟡; fixed a 🟢 supersetLead deref guard). ⚠ Stepper is a 4th stepper variant (3 local non-typeable ones exist) — consolidation follow-up flagged in the PR.
- **Cluster 7 — drawer scroll (#5) → PR #219 MERGED (`5bc4d2f`). ⚠ scroll-fix efficacy DEVICE-ONLY (CI mocks gorhom).** Brad's steer: no drawer fix had actually been written (only described), and don't treat the design mocks as gospel → used a design agent (design-source-agnostic). **Verdict = Option D (NOT full-screen route, NOT You/profile merge).** Package = `@gorhom/bottom-sheet` v5.2.14; wrapper already had `BottomSheetScrollView` + `enableDynamicSizing={false}` so the residual fix is in-package. (1) added `keyboardBehavior="interactive"` + `keyboardBlurBehavior="restore"` + `android_keyboardInputMode="adjustResize"` to the shared wrapper (all 18 sheets); (2) removed the coach "Workout library" row from the settings drawer (it was drawer-only + made it mode-symmetric); (3) relocated it to a Coach You card → `/(app)/workouts/library` (hoisted ABOVE the overview-gated block — IB 🟡 fix, else a failed overview hid the only path). IB: 1 🟡 fixed + 1 🔵 (device-verify the tall INPUT sheets, not just Fuel Targets, since `interactive` shifts the sheet up). ⚠ scroll-fix efficacy is DEVICE-ONLY (CI mocks gorhom). **#10 (You/profile merge) = NOT DONE, and per the design agent NOT the right fix** (over-engineers a fixable bug + switches to an IA the app didn't choose) — the full-screen `ProfileScreen` in design-source `extra.jsx` is reserved for a future "profile-as-a-tab" decision only.
- **Carry-invite-code-through-signup (cluster-3 flag, Brad's call) → PR #220 MERGED (`9805221`).** In-memory one-shot `usePendingInvite` store; AuthGate stashes the `?code=` on the sign-in bounce + PEEKs it post-auth → routes to accept-invite; 3 consume sites (AuthGate / SubscriptionSuccess.onGoToHome / RestoreAccount.onRestore); accept-invite clears on arrival; reset on signOut. Deliberately IN-MEMORY (not AsyncStorage) to avoid a stale code bleeding across accounts on a shared device (IB 🟠). PEEK not consume-clear to survive Supabase's multi-emission auth churn (IB 🟡). 2 IB rounds, all fixed. Residual (documented, low): same-continuous-session handoff bleed, bounded by manual submit. Device-verify pending.
- **Barcode serving-size full fix = STILL QUEUED as its own spec, AFTER these (unchanged).** Brief handed to Brad in chat this session for the next window. See [[project_barcode_off_data_quality]].
- **Mechanics:** clusters 3/4 built inline; 5/6 via `implementer` (Sonnet) subagents off scratchpad briefs, reviewed + full-gated + IB'd in the main loop (subagent gate claims re-verified, not trusted). ⚠ GitHub Actions had transient "Failed to resolve action download info" flakes on #215 (re-ran failed jobs → green). ntfy sandbox-blocked; Slack pinged once (then MCP disconnected on a mid-session process restart). A process restart mid-session lost a background recon agent (re-ran synchronously).

**2026-07-13 — Device-QA audit (11 items) → 2 CRITICAL PRs shipped (#213, #214) + API-split milestone decided. Clusters 3–7 QUEUED (task list #3–#7 + #8/#9 follow-ups). NOT device-verified (all need EAS).**
Brad ran a device pass and gave an 11-item bug/gap list. Validated + root-caused each via 7 parallel read-only agents, then fixed forward. Decisions taken via AskUserQuestion.

- **Consolidation insight:** items #1 (coach can't see completed workout), #6 ("not done" despite sets), #8-volume (blank You-page volume) were ONE defect — completed sessions stranded in the mobile sync queue (`getPendingMutations` drops `status='failed' AND retry_count>=max_retries` forever; `clientSessionId` never sent so #191 idempotency was dead-on-arrival + duplicates over-counted adherence). Every server-derived view read empty while the LOCAL recent-sets cache still showed the work.
- **PR #213 (`feat/m13-durable-session-sync`, raised + merged to main this session on green CI)** — M13 PR2 + correctness. Mobile: send `clientSessionId`; NetInfo reconnect resurrects exhausted SESSION-RECORD entries once (scoped to `/sessions/record` — non-idempotent creates left for manual retry) then flush; `flush()` coalescing re-pass; failed-sync review UI (`/sync-failed`, mirrors M10.6 SyncBlocked); versioned SQLite migration mechanism (empty history). Backend: replay reconstructs `personalRecords` from immutable exercise_sets (was `[]`); `getVolumeStatsHandler` guards the recompute (500→200 degrade). IB-clean after fixes (reverted Task-3 occurrence-selection — see task #8; fixed 2 🟢). Gates: core 2382 + mobile 4462. **NO migration** (uses #191's column). Occurrence-selection catch-up semantics = task #8, needs a product call.
- **PR #214 (`feat/account-deletion-soft-delete`, raised + merged to main this session on green CI)** — #11. Fixes the Coach-Mode deletion crash (3 NOT NULL/NO-ACTION FKs unhandled: trainer_actions_audit + client_ai_summaries deleted on BOTH cols; `program_assignments.assigned_by` → nullable + ON DELETE SET NULL) + orphaned avatar + adds **30-day soft-delete** (deleted_at/purge_after cols; DELETE=stamp, POST /account/restore=clear, `accountPurgeCron` SST daily Cron does the real purge+auth-delete+avatar). **Restore-during-sweep race fixed** (purgeUserData gated on `deleted_at IS NOT NULL` under FOR UPDATE — serializes with restore; postgres.js/TCP driver supports it — NB the CLAUDE.md "Neon HTTP" note is STALE, real DB is Supabase via postgres.js pooler). "Hide soft-deleted users from coaches immediately" (Brad's call): `deleted_at IS NULL` filters across roster/relationship-guard/list/profile/workout-visibility/trainer handlers + a soft-deleted COACH is blocked from on-behalf actions. Mobile restore screen + AuthGate redirect + confirm copy; web Privacy.tsx. IB-clean after fixes (1 🔴 race fixed+tested, 1 🔵 coach-guard hardened; 2 🟢 documented). Gates: core 248 files + mobile 4427 + web 1. ⚠️ **PROD MIGRATION MANUAL: `20260713120000_account_soft_delete.sql`** (staging auto-applies on merge).
- **Decisions locked (Brad):** #11 = 30-day soft-delete (not immediate); #8b units = build a REAL kg/lb display preference (currently `weightUnit`/`heightUnit` exist but NO display surface consumes them — volume hardcoded kg→tonnes); #4b = REMOVE create-from-Client-Detail (it's spec'd STORY-007 but Brad wants it gone; update the spec); #10 You/profile merge = attempt drawer fix first, merge only if that fails; #9b bulk/cut = DEFERRED. Billing during soft-delete = non-issue (Stripe dormant, RC/IAP is the rail, server can't cancel IAP).
- **API SERVICE SPLIT decided (task #9):** adding ONE route tipped `treaty<CoreApi>` into TS2589 — the monolith is at Eden's type ceiling. Brad chose "unblock now (documented `@ts-expect-error` in web/src/lib/eden.ts), split as its own milestone." KEY: mobile does NOT use Eden today (no elysia/eden dep; raw fetch + hand-mirrored types → that's why cluster-1's clientSessionId drifted). The split's goal includes adopting `treaty<Service>` in web AND mobile for real end-to-end types. web has 0 `api.core` call-sites today.
- **Non-issues found:** #7 Apple "still logged me in" = expected (persisted session + biometric re-auth + AuthGate). #4b reachability = spec'd feature (but Brad chose to remove it).
- **REMAINING (queued, severity order):** #3 accept-invite deep link (task #3: add `app/+native-intent.ts` redirectSystemPath reusing SCHEME_HOSTS + `Linking.createURL` QR encoding; flag unauth-athlete code-carry-through-signup). #4 nutrition freshness + Habits/Fuel calorie unification (task #4: FuelContainer useFocusEffect + notifyMutated; Habits reads nutrition_targets.daily_kcal not its own goals.target_value — also corrupts streak scoring; only days/week+leniency settable). #5 units kg/lb feature (task #5). #6 create-workout prototype styling rewrite + remove client-detail entry (task #6). #7 drawer scroll systemic fix (task #7: gorhom unreliable on-device for tall/form sheets — wrapper IS correct BottomSheetScrollView but fixed-height + no keyboard config; CreateExercise precedent = full-screen escape; CI can't catch, gorhom mocked → needs device verify) → then #10 merge call.
- **Mechanics:** built via parallel `implementer` (Sonnet) subagents off scratchpad briefs, reviewed inline + gated + IB'd in main loop. ⚠️ LESSON: a mobile implementer ran `git stash` in the SHARED working tree and collided with the parallel backend agent (recovered, verified byte-for-byte); the backend agent then STALLED ~48min at its final test run (I stopped it + took over verification). For parallel implementers on ONE branch: forbid `git stash`, or use worktrees. Both PRs' full gates re-run by me in the main loop (subagents' gate claims verified, not trusted). ntfy still sandbox-blocked; Slack not pinged (Brad live in-session).

**2026-07-12 — Fuel → Recipes AI (PR2+PR3 combined) → PR #210 MERGED (squash `9464675`). `origin/main` = `9464675`. IB-local clean @ 8fc316b (2 findings fixed), all CI green. NO migration. NOT device-verified (needs EAS build). THE FULL FUEL→RECIPES FEATURE IS NOW SHIPPED (PR1 #209 + PR2/PR3 #210). Readiness item a9 = DONE.**
Brad steer: "merge PR1, put the remaining PR work all in the same branch, churn through it" → built backend + mobile AI in ONE branch/PR, merged on green CI per that durable auth.

- **Backend (microservices/core, reuses the M9.5 Bedrock infra):** `aiBedrockClient.ts` (shared harness extracted from `aiEstimation.ts` — client seam/retry/forced-tool-use/errors/`findToolUse`; aiEstimation refactored to reuse it, public API + its 16 tests unchanged); `recipeExtraction.ts` (`extractRecipeFromPhoto` opus-4-6 `report_recipe` DOCUMENT-transcription + `estimateFoodMacros` per-100g); `resolveIngredientFood.ts` (DB-miss→AI-estimate→`FoodRepository.create source='ai_recognized'`); `imageValidation.ts` (shared). Endpoints `POST /nutrition/ai/extract-recipe` + `/nutrition/ai/resolve-ingredient` — both `assertEntitlement('ai_access')` → daily ceiling (`AiUsageLogRepository.countForUserToday`, usage-log gated on reachedModel) → model. infra env `AI_RECIPE_MODEL_ID`/`AI_RECIPE_DAILY_LIMIT`(12)/`AI_RESOLVE_DAILY_LIMIT`(60); no IAM change. **NO migration** (foods.source accepts 'ai_recognized', recipes.source accepts 'ai_extracted').
- **Mobile (packages/mobile):** ApiPort+SST/InMemory adapters+hooks for both endpoints (online-only, never queued); `recipe-draft` + `add-recipe-menu` zustand stores; the **create-recipe form (hub)** with food-linked ingredient picker (`useSearchFoods` DB → AI-create-on-miss `useResolveIngredient`, gated `useNutritionAiGate`) + live client-side macro total; URL-import (deterministic) + AI snap-photo flows both prefill the form; library "+" now opens the 4-path Add menu.
- **IB fixes (2):** 🟡 DATA ISOLATION — `ai_recognized` foods were shareable via `getById/getByIds/getByBarcode` (`source != 'user'`); fixed to share ONLY curated `'openfoodfacts'` (aligned with `search()`), every createdBy-owned custom (user + ai_recognized) private-to-creator; **locked with a PgDialect predicate-render guard** (mocked-DB blind spot — see [[reference_drizzle_groupby_param_bug]]). 🟢 create-form `timeMinutes` was captured but never persisted (no column) → field removed.
- **Gates:** core 2372 vitest (92.1% br), mobile 4400 jest (90.35% br), typecheck 8/8, lint 6/6, build 13/13, prettier clean. **Deferred/flagged:** recipe photo-upload + tags (no model fields), prep-time (no column); prototype "auto-estimate macros" toggle replaced by the live linked-ingredient total.
- **Build mechanics:** two `implementer`s (Sonnet) in PARALLEL off `scratchpad/PR2_BACKEND_AI_BRIEF.md` + `PR3_MOBILE_AI_BRIEF.md` (disjoint trees), reviewed inline + gated + IB'd in main loop; coverage-tightened both via warm SendMessage. ⚠ mobile agent hit the ACCOUNT session limit mid-follow-up once (resumed after reset — Brad flagged it). 
- **NEXT:** device-verify on an EAS build: snap a cookbook page → extract → link ingredients (DB + AI-create) → save → log; URL import; at-cap 402/429; **run a real recipe-photo accuracy sanity-check on staging/EAS (a live Bedrock eval was NOT runnable in-sandbox — no AWS creds).** No prod migration to apply.

**2026-07-12 — Fuel → Recipes PR1 (no-AI slice) → PR #209 MERGED (squash `55cd382`). IB-local clean @ 1e3fe73, all gates green. Library + recipe/meal detail + Log-to-today + Save-a-meal; pure mobile UI + routes + tests, no backend changes. NOT device-verified.**
New Fuel → Recipes screen built to the `~/Downloads/handoff/design-source/screens/recipes.jsx` prototype (Recipes is a NEW prototype-driven screen, NOT a legacy port — Brad corrected this early). This is a MULTI-PR feature; PR1 = the no-AI browse/log/save core with ZERO backend changes.

- **Scope decisions locked (Brad, via AskUserQuestion):** (1) recipe-photo AI extraction = BUILD IT (reuse the M9.5 Bedrock harness `nutrition/services/aiEstimation.ts` with a NEW `report_recipe` tool schema + prompt — it's DOCUMENT extraction, a different task than plate-macro estimation, so the M9.5 eval doesn't cover it → Phase-0 eval first). (2) ingredient macros = food-linked → search the ~143k-row `foods` DB → **AI-estimate per-100g on a miss** → save `source='ai_recognized'`, user-editable. NO OFF name-search (OFF resolve is BARCODE-ONLY today). Honours the locked "AI never owns the numbers" rule as a last-resort editable layer.
- **PHASING (Brad chose "build PR1 now"):** PR1 = library + detail + log-to-today + save-a-meal (SHIPPED, this PR). PR2 = AI backend (`extractRecipeFromPhoto` + `estimateFoodMacros` + DB→AI food resolution, gated `ai_access` + ceilings, eval-gated). PR3 = mobile AI UI (food-linked create-recipe form + URL import + Snap-a-recipe-photo + the full 4-path Add menu).
- **PR1 shipped (`packages/mobile`, all UI + routes + tests, no port/adapter/hook changes):** `RecipesLibrary`/`RecipeDetail`/`MealDetail`/`SaveMeal` container+presenter pairs; routes `fuel/recipe/[id]`, `fuel/meal/[id]`, `fuel/save-meal` + `fuel/recipes` now owns HeaderBar (`headerShown:false`); `defaultMealSlot()` helper. Log-to-today reuses `useLogEntry({recipeId|mealId})` (backend re-derives macros) + noon-UTC anchor + `notifyMutated()`. **Save-a-meal excludes ref-less entries** (a `MealItemInput` needs a food/recipe ref, else backend persists a junk 0-macro row — my correctness fix on top of the implementer's build).
- **Deliberate flagged deviations:** library "+" opens Save-a-meal directly (4-path Add menu = PR3); recipe secondary line = `servings · source` (model has no prep-time field).
- **Build mechanics:** delegated file authoring to an `implementer` (Sonnet) off a precise brief (`scratchpad/PR1_RECIPES_BRIEF.md`), reviewed inline + ran all gates in the main loop (subagents can't run gates in this sandbox), fixed the save-meal ref-guard + IB's meal-detail loading-gate finding myself + tightened changed-file branch coverage via the warm implementer. Gates: tsc/eslint/prettier clean, **4268 jest / 90.18% global branches**, changed files 91–100% branches. IB local clean @ 1e3fe73.
- **NEXT:** await Brad merge (needs go-ahead). Then PR2 = the AI backend — START WITH the Phase-0 recipe-photo eval (mirror M9.5 `snap-eval/`; ~8-10 cookbook pages/screenshots through candidate Bedrock models with the `report_recipe` schema; the M9.5 photo model = opus-4-6). Reuse: `aiEstimation.ts` harness (client seam/IAM/forced-tool-use/retry-under-30s/errors), `assertEntitlement` ai_access, `ai_usage_log`+ceilings (#156), `FoodRepository.search`/`create` (source='ai_recognized'). Slack pinged (#brad-claude-agents); ntfy sandbox-blocked (curl denied).

**2026-07-12 — Coach Mode Phase 8 (invite code + QR + coach-accept) → BOTH MERGED: #198 backend (squash `e1df44d`) + #202 mobile (squash `7492f9b`). `main` = `7492f9b`. Both Inspector-Brad-local clean, all CI green. Off `specs/milestones/M8-coach/PHASE_8_INVITE_QR_BRIEF.md`. COACH MODE COMPLETE (all phases).**
Grew from "frontend-only" per the brief's recon note — the coach-accept half of decision #2 (COACH accepts) did not exist. Built backend inline; mobile plumbing + UI via a warm `implementer` subagent (10-80-10), reviewed inline + IB-swept.

- **Crux — the reconciliation.** Two pending-creation paths have OPPOSITE acceptance directions: email invite (trainer-initiated → CLIENT accepts, existing M10) vs invite-code redeem (client-initiated → COACH accepts, decision #2). Solved with a NEW `pt_client_relationships.initiated_by` column ('trainer' default). It lets the shared `create_pt_relationship_notifications` trigger SELF-CORRECT direction (stays silent for client-initiated INSERT + pending→active so app code emits those WITH push; trainer-initiated + AI branches preserved byte-for-byte), gates each respond endpoint to its correct pending type, and drives which side shows the accept affordance.
- **Backend #198 (`feat/coach-invite-qr-backend`, IB clean @ `ad83aba` + follow-up `aa6b1fb`):** NEW `POST /trainers/me/relationships/:id/respond` (coach accept/decline; at-cap accept → **402 upsell** — coach is the actor, consistent with #195/#196 invite-CREATION, NOT the redeem's client-facing 409; athlete notified `coach_request_accepted` + audited). Invite-code redeem stamps `initiated_by='client'` (insert + revive); client-side respond guarded to `'trainer'` so an athlete can't self-accept + bypass decision #2; **email-invite revive re-stamps `'trainer'` (IB 🟠 fix — else a revived ex-code row is stranded/consent-flipped)**. `initiated_by` + `relationshipId` surfaced on the roster (`getClients`) + client relationships list. Core **2256** tests. ⚠ **4 PROD-MANUAL migrations** (staging auto-applies on merge): `20260711140000` initiated_by column, `140100` coach_request_accepted notif type, `140200` client_request_{accepted,declined} audit values, `140300` trigger rewrite.
- **Mobile #202 (`feat/coach-invite-qr-mobile`, off main, IB clean @ `53bde39`):** Flow 1 coach share (AddClientSheet email/code `Segmented`; generate code + QR encoding `persistencemobile://accept-invite?code=<code>` + tap-to-copy (`expo-clipboard`) + RN `Share` + expiry; 402/offline handled). Flow 2 athlete redeem (`app/(app)/accept-invite.tsx` prefilled from `?code=`; each error→inline copy, `coach_client_limit_reached` inline NOT paywall; You "Have a coach's code?" entry + own client-initiated pending shows "awaiting acceptance"; Requests filters to trainer-initiated). Flow 3 coach accept (client-initiated pending roster rows get "Awaiting your OK" pill + Accept/Decline, RequestsPresenter shape, optimistic + roster refresh, 402 alert; ClientsContainer reads `?clientId=` → All segment). Plumbing: `initiatedBy` on ClientTrainerRelationship, `trainerInviteCode` models, port + SST/InMemory adapters + hooks, `coach_request_accepted` registered, `accept-invite` deep-link. Deps: `react-native-qrcode-svg` + `expo-clipboard`. Mobile jest **4110**. IB found 2🟡+1🟢+1🔵 (deep-link segment re-sync, You focus refresh, Share `.catch`, deploy-ordering `!== "client"` default) — all fixed + re-swept clean.
- **Brad steer this session:** tap-to-copy IN (accepts the `expo-clipboard` native dep).
- **NEXT:** ⚠ apply the 4 PROD migrations manually on merge. **Device verify (needs FRESH EAS build — QR + expo-clipboard are native):** coach mints code → QR/Share/copy → 2nd device redeems (typed + deep link) → coach "Awaiting your OK" → Accept → athlete active + push; each redeem error; at-cap accept 402; decline. STORY-015 ACs updated to spell out the trainer-accept endpoint + coach-accept UI. **DONE post-merge: flipped Coach Mode → COMPLETE in `app-store-tracker.html` (co3 refined to "email invite"; new co8 "Invite code + QR + coach-accept (Phase 8)") + header synced to `7492f9b`/12 Jul; go-live artifact republished in place (same URL `a583d57e-9e07-464b-9a12-079395941f18`).** Slack pinged (twice — PRs-up + merged). ntfy sandbox-blocked.

**2026-07-11 — Coach Home v1 (Coach Mode Phase 10) → PR #197 MERGED (squash `0dbe02c`). `main` = `0dbe02c`. IB-local clean @ `7744e61`, all 5 CI checks green, 4021-jest. Off `specs/milestones/M8-coach/COACH_HOME_V1_BRIEF.md`. Frontend-only, NO migration, NO backend. Device verify outstanding.**
Replaced the `ComingSoon` stub in `CoachHomeContainer` with the real coach-mode Home triage screen, ported 1:1 from `~/Downloads/handoff/design-source/screens/coach-home.jsx`. Built INLINE (1 Explore agent for recon only). **Brad confirmed decision #1 this session: schedule hero DEFERRED** (no appointments backend).

- **Recon correction (crux):** the brief's §Data claimed the roster carries `programLabel`+`programEndDate`. The MOBILE `TrainerClient` type was STALE (comment "programLabel always null", no `programEndDate`) but the BACKEND roster (`trainerRepository.getClients`) HAS emitted both since spec-19 (`getLiveProgramInfoByClient` → `programLabel`/`programEndDate`). The SST adapter is a pure passthrough (`requestEnvelope<TrainerClient[]>`), so the fields already arrive at runtime — the fix was purely to ADD `programEndDate: string|null` to the mobile type + correct the `programLabel` comment. So block 4 (programme alerts) is feasible with NO backend, exactly per the brief's intent.
- **Shipped (all `packages/mobile`):** `CoachHomeContainer.tsx` (hooks + exported pure builders `buildDateLabel`/`buildFlaggedClients`/`buildProgrammeAlerts`/`buildTrainYourselfSubtitle`) → new pure `CoachHomePresenter.tsx` + sub-presenters `coach/{FlaggedClients,ProgrammeAlerts,TrainYourselfCard,ScheduleHero}Presenter.tsx`. Flagged = band atRisk/crisis OR any flag (cap 4, worst-first); alerts = `programEndDate` within 14d (ember ≤7d else trainer, cap 4); train-yourself = `useGetStreaks` streak + `useGetHome` queued workout, tap → `useModeSwitch().switchMode("athlete","index")`. Empty states: 0-flagged calm card, 0-alerts hidden, 0-clients "Invite your first client" nudge → AddClient sheet. Top safe-area owned by the tab route (mirrors HomePresenter, NOT CoachYouPresenter).
- **ScheduleHero DEFERRED but BUILT + gated off** (`ScheduleHeroPresenter`/`ScheduleRow` real, proto-faithful; `CoachHomePresenter` renders it only when a non-empty `schedule` prop is passed, which the container never does in v1 → re-enables unchanged when the appointments spec lands).
- **Also:** rewrote `specs/10-trainer-features` STORY-001 AC 1.2–1.7 (title too) from the stale business-dashboard layout (that's Coach You) to the shipped triage layout (per design.md reconciliation). Deleted the now-obsolete `PlaceholderContainers.test.tsx` (only tested the CoachHome stub).
- **IB (`inspector-brad` local) clean @ `7744e61`:** no blocking; 2 low notes FOLDED IN (dropped churning `now`-dependent `useMemo`s → `dateLabel`/`programmeAlerts` now plain per-render consts; hardened `onRefresh` with `.catch`), 2 dormant date-precision notes DOCUMENTED in `daysUntil` (timestamp-vs-date-only assumption — only bites once the Programs backend wires `programEndDate` into this path). Gates: tsc 8/8-equiv (mobile tsconfig 0), expo lint 0 err, repo prettier clean on changed files, mobile jest **4021** pass / global cov 96.3|90.1|96.6|97.8 (≥90 gate green; changed-file branch dips are cosmetic `pressed`-state style callbacks, same as existing ClientRow).
- **NEXT:** Device-verify (needs EAS build): coach lands on Home → flagged clients + programme alerts + train-yourself → Train-yourself flips to athlete Home; empty states for a new coach. **Remaining coach phase: Phase 8 (invite-QR, decision #2)** — Coach Mode otherwise COMPLETE (Phases 0–7, 9, 10, 11, 12 + 5/6 all shipped). Post-merge: refreshed `app-store-tracker.html` coach section (co4 Coach Home + co5 Programs + co6 Client Detail + co7 assignment all `todo`→`done`, since spec-19/M8 shipped them) + republished the go-live-tracker artifact. Slack pinged; ntfy still sandbox-blocked (curl denied). STATE.md/skills/briefs left untracked by choice (not committed — matches established pattern).

**2026-07-11 — Trainer-client-caps (revenue-leak fix) → BOTH PRs MERGED: #195 backend (squash `fdce22f`) + #196 mobile (squash `39f6c63`). `main` = `39f6c63`. Both Inspector-Brad-local clean, all CI green. Off `TRAINER-CLIENT-CAPS-BRIEF.md`.**
Enforced `subscription_tiers.trainer_client_limit` (individual_trainer 2 / small_business 30 / medium_enterprise 500) — the catalog advertised it but NOTHING enforced it (any trainer could build an unlimited roster on the £14.99 tier). Built INLINE (recon via 3 Explore agents first; the brief's state-machine assumptions were partly wrong — recon corrected them).

- **Recon-corrected state machine:** a seat is consumed only at `pt_client_relationships.status='active'` (non-AI). FOUR write paths: invite-code redeem (`trainersAcceptInviteCodeHandler`, creates `pending`), email invite (`trainerRepository.inviteClientByEmail`, had an active-only `no_slots` check), the CLIENT-side accept `pending→active` (`trainersRespondToRequestHandler` — the TRUE seat-consumption point, was bare non-tx), and the SQL signup trigger (`process_pending_invitations`, inserts `pending` → funnels through the accept gate, out of TS scope). Unique index (trainer_id, client_id) → re-accept reuses the row.
- **PR #195 backend (`fix/trainer-client-caps-backend`):** (1) `assertEntitlement` `trainer_clients` stub → real active-count-vs-cap verdict (`evaluateTrainerClientsActiveSeat` + `nextTrainerTierUp` ladder; cancelled/expired→free rules; NULL-limit trainer=unlimited; non-trainer=`tier` deny). (2) NEW `trainers/seats/trainerSeats.ts`: committed-seat accounting = active+pending rels + pending email invitations (invite CODES excluded — bounded 1/trainer/24h + counting the code being redeemed is a paradox; the accept-time active backstop is the guarantee). Invite CREATION (code create + email send) → **402 EntitlementError upsell** (trainer=actor); join/accept → **409 `coach_client_limit_reached`** (client=actor, NOT a 402) + best-effort trainer notification, all under a per-trainer `SELECT … FOR UPDATE` lock. (3) NEW notification type `trainer_client_limit_reached` (schema enum + repo union/array + migration). IB fixed 1 🟢 (at-cap trainer can still re-fetch an already-issued code — only NEW generation gated). Gates: tsc 8/8, lint 0, build 13/13, core **2245** tests, changed files 97–100% cov. **⚠ PROD MIGRATION MANUAL:** `20260711120000_trainer_client_limit_reached_notification_type.sql` (standalone idempotent ADD VALUE; staging auto-applies on merge).
- **PR #196 mobile (`fix/trainer-client-caps-mobile`, off main):** `computeClientSeatVerdict` + `nextTrainerTierUp` in `useFeatureGate.ts` (mirrors backend; kept SEPARATE from `useFeatureGate('trainer_clients')` which stays the boolean isTrainerTier SCREEN gate — count-based would lock at-cap trainers OUT of their roster). Clients screen: "N of M slots used" line + disabled invite at cap + "No client seats available — remove a client or change your subscription" warning (CTA → subscription-selection, next trainer tier pre-selected). AddClientSheet handles the 402 backstop. Notification type registered across all 5 mobile sites. IB fixed 1 🟢 (lapsed sub returned limit:null so no contradictory "0 of N used" line) + locked past_due consistency. Gates: tsc ✓, lint 0, mobile **3989** tests, changed files clear 90% floor. NOTE (brief-specified): mobile "slots used" counts ACTIVE only (not committed) — a trainer with outstanding invites can see an enabled invite that the backend 402s; cleanly backstopped by the sheet's 402 handler.
- **NEXT (post-merge):** **⚠ APPLY THE PROD MIGRATION MANUALLY** — `20260711120000_trainer_client_limit_reached_notification_type.sql` (staging auto-applied on the #195 merge; prod is separate/gated). Device-verify the coach Clients cap UI (needs EAS build): at-cap trainer sees the slots line + disabled invite + no-seats warning; a client join at cap → 409 + the trainer gets a `trainer_client_limit_reached` push. Slack pinged; ntfy still sandbox-blocked (curl denied in this sandbox).
- **NEXT AGENT QUEUED (Brad's steer 2026-07-11):** **Coach Home v1 (Coach Mode Phase 10)** — the last unbuilt coach surface (Home tab still a `ComingSoon` stub in `CoachHomeContainer.tsx`; the tab already branches coach→CoachHome). Grounded brief authored → `specs/milestones/M8-coach/COACH_HOME_V1_BRIEF.md`. **Recon verdict: NO new backend** — all data derives client-side from the existing `GET /trainers/me/clients` roster (flags/band/adherence/programEndDate); `getOverview` is Coach You's, not Coach Home's. Build to the `~/Downloads/handoff/design-source/screens/coach-home.jsx` prototype 1:1 (prototype = source of truth). v1 = 4 blocks (header / needs-you-today flagged clients / programme alerts / train-yourself→switch mode); **schedule hero DEFERRED** (no appointments backend — Brad decision #1, default confirm). Also fix STORY-001's stale ACs to the triage layout. Frontend-only, 1 mobile PR. ⚠ still-open coach phase after this: Phase 8 (invite-QR, decision #2).

**2026-07-10 (Fable planning) — GTM Expansion plan AUTHORED: `specs/milestones/GTM-EXPANSION/{BRIEF,DESIGN-TASKS}.md` (untracked, Brad commits when he chooses). NO code built.**
Planning session off Brad's colleague's B2B/acquisition-loop document + Brad's AI-workout ideas.
Codebase grounded via 3 Explore sweeps. **Key grounding findings:** (1) freeform Quick Start
sessions + mid-session add/remove/SUBSTITUTE exercise ALREADY SHIPPED (`substitute-exercise.command`,
`isSubstituted`/`originalExerciseId`) — Brad's "less blockers" idea mostly exists; only the
intelligent/equipment-aware suggestion layer is missing (V2 dropped legacy `similar_to`). (2) Equipment
data model ALREADY EXISTS (`equipment_types`, `exercises.equipmentRequired uuid[]`,
`profiles.availableEquipment uuid[]`, repo overlap-filtering). (3) NO org/seat model exists —
small_business/medium_enterprise are price points only; subs strictly per-user (one-LIVE partial
unique). (4) NO analytics events/share/referral code anywhere. (5) 30s APIGW ceiling → single-workout
generation can be synchronous, multi-week programme import CANNOT (async job model → spec-20's
problem). (6) ⚠ `trainer_client_limit` (2/30/500) UNENFORCED at app layer (`trainer_clients`
entitlement stub + invite-accept never checks) — revenue leak, flagged as its own task chip.
**Brad's 4 locked decisions (AskUserQuestion 2026-07-10):** (1) consumer AI + growth loop FIRST
(pre-launch), B2B specced-now/built-on-pilot-signal; (2) paywall = premium + free taster (3 lifetime)
PLUS a NEW higher consumer tier (working name `premium_plus`, ~£19.99 — name/price = open checkpoint)
for heavy AI; B2B seats priced separately; (3) B2B MVP = full pilot kit, manual/invoice billing (orgs +
seats-via-invite-code + org-aware assertEntitlement + aggregate-ONLY web admin dashboard + default
programmes; NO SSO/billing code); (4) equipment capture v1 = photo-scan + picklist (Snap-AI clone).
**Plan shape:** M19 Adaptive Workout AI (P0 tier restructure/taster, P1 equipment scan, P2 candidate-
constrained generation — model selects exerciseIds from a server-filtered candidate list, NO fuzzy
matching, both Train-tab + Quick-Start entry points, P3 deterministic swap ranking) → M20 Growth loop
(P1 tracking plan + first-party emitter LAUNCH-CRITICAL, P2 share cards, P3 referral codes via RC
promotional entitlements) → M21 B2B orgs (post-launch, pilot-triggered) → spec-20 import unchanged
(gets the async-job + presigned-S3 + PDF constraints). Spec triplets to author at pickup:
`specs/21-adaptive-workout-ai/`, `specs/22-growth-instrumentation/`, `specs/23-organizations/`.
6 open Brad checkpoints consolidated at BRIEF §9. Design prompts (D1–D6) ready in DESIGN-TASKS.md —
run before the corresponding mobile PRs. Slack pinged (needs-input + completion); ntfy still
sandbox-blocked.
**2026-07-11 follow-up (Brad's notes, all folded into BRIEF.md):** (a) **DATED SCHEDULE LOCKED — BRIEF
§2b is now the schedule of record** (M13/M14 close w/c Jul 13 → M19 core Jul 20–Aug 2 → mobile complete
Aug 3–9 → **ASC submission ~Aug 12** → **LAUNCH w/c Aug 17**); >3-day slip = Slack ping with proposed
re-cut; cut order M20-P3 → P2 → M19-P3; scan+generate+day-0-events+submission protected. (b) **M20-P1
day-0 tracking PULLED FORWARD** — starts immediately as a parallel lane, no M19 dependency. (c) **M21
gains a FOUNDER OPS CONSOLE** (§5 item 1b): platform-admin (profiles.role=admin) section in
packages/web — org CRUD/seat count/seat_tier/join codes/member+revoke; that's how Brad onboards
businesses in practice; RC role boundary documented (RC = IAP rail + INDIVIDUAL promotional
entitlements ONLY — never model orgs in RC; invoicing stays outside the product). (d) **Seats
future-proofed**: organizations.seat_tier grants a real catalog tier (premium OR premium_plus per
contract); rule = individual/time-boxed → RC promo entitlement, bulk/contract → org+seat_tier, never a
third mechanism. Also authored `specs/milestones/TRAINER-CLIENT-CAPS-BRIEF.md` (standalone agent brief
for the caps leak — recon steps, concurrency-safe in-tx gate, client-facing 409 NOT a 402 upsell,
optional trainer notification = Brad checkpoint) + published the delivery/B2B GTM artifact
(claude.ai/code/artifact/3e6fa157-0c72-431d-b97c-c79909b2c646 — dated timeline, revenue architecture,
founder-console answer, showcase kit, cold-calling plan, day-to-day lanes incl. the Cowork ops lane).
**2026-07-11 (later):** Brad locked the caps-fix v1 decisions → TRAINER-CLIENT-CAPS-BRIEF.md updated
(now backend+mobile, 2 PRs): invite CREATION blocked at cap (402+upsell — trainer is the actor there),
accept-time gate stays as hard backstop (409 client-facing, NO upsell), trainer notification IN
(notification_type migration + mobile registration), trainer-side no-seats UI warning IN ("remove a
client or change your subscription", disabled invite, N-of-M slots line, useFeatureGate('trainer_clients')).
Second artifact published: go-live tracker (app-store-tracker.html → claude.ai/code/artifact/
a583d57e-9e07-464b-9a12-079395941f18). **PR #194 MERGED (squash `4b48b5a`)** — GTM-EXPANSION/, caps
brief, LAUNCH_PLAYBOOK, app-store-tracker.html + THIS FILE are now tracked on main (IB local clean @
4a2f056; docs-only, CI change-detection skipped build/test as expected). Still untracked by choice:
the pre-existing M13–M18/COMPLIANCE/WEB-DESIGN briefs + .claude/skills/ (predate this scope — Brad's
call). Brad has the NEXT agent brief queued; the caps-fix agent starts from the committed
TRAINER-CLIENT-CAPS-BRIEF.md.

**2026-07-10 — Three-slice dispatch (Compliance Sprint → M13 Sync Hardening → M14 Responsive). SLICE 1 SHIPPED (#190 merged); SLICE 2 backend up (#191); Slice 2 frontend + Slice 3 PLANNED for a fresh session (recon captured below).**

- **SLICE 1 — Compliance Sprint PR1 → PR #190 MERGED (squash `1a2ed19`).** Recon confirmed the dispatch: PR2 (account deletion #140) + PR3 (push #142) already shipped; only PR1 left. Shipped: (1a) added `NSCameraUsageDescription` to `packages/mobile/app.json` `ios.infoPlist` (expo-camera + expo-image-picker plugins already inject a camera string; this makes the explicit key authoritative); (1b) new public `packages/web/src/pages/{Privacy,Terms}.tsx` + `/privacy` `/terms` routes in `App.tsx` (react-router **v7**, not v6). Theme-aware (semantic CSS vars flip via `.dark`). Verified in-browser (light+dark, no console errors). IB local clean (fixed a 🟡 — privacy policy now discloses meal-photo→AWS-Bedrock AI + lists AWS as a third party). Gates green. **Deliberately did NOT touch mobile privacy/terms linking** — the app already has native `PrivacyPolicyContainer`/`TermsOfServiceContainer` screens (`app/(app)/profile/{privacy,terms}.tsx`); the brief's "rewire mobile to a web URL" sub-step was stale and would regress them. ASC just needs a public URL.
  - **⚠ 2 FLAGS FOR BRAD before ASC submission:** (1) support email is placeholder `hello@persistence.app` (a real `apps@persistence.app` exists in `infra/api.ts` OFF_CONTACT_EMAIL — pick one); (2) the web `StaticSite` (`infra/web.ts`) has **NO custom domain** → auto CloudFront URL; ASC needs a stable URL → configure a custom domain OR paste the CloudFront URL. Governing law placeholder = England & Wales.

- **SLICE 2 — M13 Sync Hardening (brief `specs/milestones/M13-sync-hardening/`).** Recon-first (2 Explore agents). **Key path corrections vs the stale 2026-07-01 brief:** repo is `microservices/core/src/application/repositories/sessionRepository.ts` (NOT `.../sessions/repositories/`); migrations are hand-written `supabase/migrations/*.sql` (NOT `packages/db/migrations`); the table is `workout_sessions` (Drizzle `workoutSessions`); the mobile finish command is `finalizeSessionCommand` in `src/application/commands/session/complete-session.command.ts`.
  - **PR1 (backend idempotency) → PR #191 MERGED (squash `4bda7d1`).** (branch `feat/m13-session-record-idempotency`, commit `55b8370`). Makes `POST /sessions/record` replay-safe: nullable `client_session_id` column + named unique index `workout_sessions_user_client_session_idx` on `(user_id, client_session_id)` (NULLs distinct → existing rows unaffected); `recordSession` step-0 SELECT short-circuit for sequential retry + `onConflictDoNothing` concurrent-race backstop; extracted `buildRecordedSession`; new `RecordedSession.wasReplay` flag so `recordClientSessionOnBehalf` + self handler skip non-idempotent post-commit effects (the coach→client push would otherwise re-fire on every retry — IB 🟠, fixed). Both `/sessions/record` validators accept optional `clientSessionId`. IB local clean @ 55b8370. Gates: core 2217 tests / 98.33% cov, tsc 8/8, lint 0, build 13/13. **⚠ MIGRATION `20260710120000_workout_sessions_client_session_id.sql` — PROD apply MANUAL (staging auto-applies on merge).** Merging on green CI per durable auth.
    - **🟡 KNOWN, deferred to PR2:** a replay returns `personalRecords: []` (re-running PR detection on replay is self-referential/unsafe; per-set `isPersonalRecord` flags ARE preserved). PR2 must verify the mobile Summary's PR source (top-level list vs per-set flags; whether it computes PRs locally at Finish) before deciding if a mobile fix is needed. Also: `wasReplay` is on the wire response — add to the shared mobile response type if strict.
  - **PR2 (mobile sync hardening) — NOT STARTED, FULLY RECONNED. Branch off main. 4 commits, all `packages/mobile`:**
    1. **Send `clientSessionId`** — one line in `finalizeSessionCommand` (`complete-session.command.ts:139` payload): add `clientSessionId: finalized.id` (the local `active_sessions` id). Add `clientSessionId?: string|null` to mobile's `RecordSessionInput` type (find its def — likely `domain/ports` or the command file). Pairs with #191.
    2. **NetInfo + debounced flush in `useSyncWorker.tsx`** — today only mount + AppState→active. Wire `netInfo` (from `useAdapters()`) `.subscribe((connected)=>…)` and flush on a false→true transition (track prev state in a ref). Add a short debounce (~500ms–2s) after enqueue — but enqueue is a StoragePort call, not React; simplest is to expose a flush trigger. Re-use the existing `flush()`/`flushingRef` guard + `processSyncQueue`. NetInfoPort: `src/domain/ports/netInfo.port.ts` (`isConnected()`, `subscribe(cb)→unsub`). Tests: offline→online triggers processSyncQueue without an AppState event; debounce doesn't double-fire.
    3. **Failed-sync review UI** (mirror the M10.6 blocked pattern EXACTLY). NEW storage methods on StoragePort + sqlite.adapter + InMemory adapter: `getFailedExhaustedEntries()` = `SELECT * FROM sync_queue WHERE status='failed' AND retry_count >= max_retries ORDER BY created_at ASC` (mapRow); `resetFailedEntries(ids)` = `UPDATE …SET status='pending', retry_count=0, error_message=NULL… WHERE id IN(…) AND status='failed'` (in `withTransactionSync`); reuse `discardEntries` (already deletes any id). Files to MIRROR: hook `src/ui/hooks/useBlockedSyncEntries.ts`, banner `src/ui/components/subscription/SyncBlockedBanner.tsx` + mount `src/ui/containers/SyncBlockedBannerMount.tsx`, review `src/ui/containers/SyncBlockedContainer.tsx` + `src/ui/presenters/SyncBlockedPresenter.tsx`, route `app/(app)/sync-blocked.tsx`. Build siblings: `useFailedSyncEntries` (poll getFailedExhaustedEntries, 30s + AppState), `SyncFailedBanner` + `SyncFailedBannerMount`, `SyncFailedContainer` + `SyncFailedPresenter`, route `app/(app)/sync-failed.tsx` + register `Stack.Screen name="sync-failed"` in `app/(app)/_layout.tsx`. Mount `<SyncFailedBannerMount/>` on the **Home tab** next to `<SyncBlockedBannerMount/>` at `app/(app)/(tabs)/index.tsx:35` (that's how SyncBlocked is mounted — Home-tab, NOT root). Actions: Retry (resetFailedEntries → then trigger a flush) + Discard (discardEntries, with a warning that a completed-session mutation loses that session locally). Copy: "N items failed to sync". Tests mirror the blocked-UI test suite.
    4. **Versioned SQLite migrations** — no `schema_version`/`PRAGMA user_version` exists today; `initialize()` (`sqlite.adapter.ts:96-617`) does CREATE IF NOT EXISTS + 2 hand-rolled ad-hoc migrations at the end (M18 active_sessions ALTER `:503-516`; M10.6 sync_queue rebuild `:518-616`). Add an EXPORTED, TESTABLE `runSqliteMigrations(db, migrations)` + a `SQLITE_MIGRATIONS: {id,run}[]` const (EMPTY now — mechanism forward-only, do NOT fold in history per the brief). Runner: create `schema_version(id=1, version int)`; if no row → baseline at `latest` (fresh install / existing install already at final shape via CREATE-IF-NOT-EXISTS) and run nothing; else run `migrations.id > current` in order, bumping version. Call it at the END of `initialize()`. Test proves a synthetic step runs once + is idempotent on re-init without a version bump. NOTE the dual-write rule for future changes: update the base CREATE (fresh installs) AND add a guarded migration (existing installs).
  - **SMOKE_TEST.md** has the e2e gate: dup-submit proven idempotent (done in #191 tests); exhausted-retry surfaces in a user-visible UI (PR2 #3); offline→online-while-foregrounded flush (PR2 #2); schema_version mechanism (PR2 #4).

- **SLICE 3 — M14 Responsive Hardening (brief `specs/milestones/M14-responsive-hardening/`) — NOT STARTED.** Frontend-only, `packages/mobile`. P0 (per memory `project_responsive_layout_audit`): `app.json` `supportsTablet: true` with no tablet layout; a carousel with a fixed 170px height clips. Read BRIEF + FRONTEND_BRIEF + SMOKE_TEST before building. **⚠ Verification wants a simulator/tablet — jest/tsc can't prove layout; FLAG on-device/simulator verify as outstanding (Brad runs EAS).** M15 tablet scope is DEFERRED — do not pull it in.

- **Session mechanics:** built INLINE (no implementer subagents). IB local sweeps before each PR (2 real fixes found+fixed across the two PRs). Merges on durable auth (squash + --delete-branch). Slack pings worked (#brad-claude-agents / C0ATYL6T11V); **ntfy still sandbox-blocked** (curl denied).

---

**2026-07-10 (latest) — Apple IAP mobile flow "brief" → recon found it ALREADY SHIPPED; hardened it → PR #189 MERGED (squash `86e9dc9`). `main` = `86e9dc9`. IB local clean, all CI green.**
Took the "Apple IAP mobile purchase flow = the App Store launch blocker" brief. **RECON VERDICT: the brief was STALE — the iOS RevenueCat purchase flow is already code-complete and on main** (M12, commit `e4d894c` mobile IAP flow + `a5f79b9` SDK key + `5b1faff` identity guard + `7f06002`/`b587120` backend). `configure`+`logIn`/`logOut` (App User ID = Supabase id, `providers.tsx` + `usePurchasesIdentity.ts` root-mounted), adapter fully implements getOfferings/purchase/restore/logIn/logOut (jest-mocked, CI never hits the real SDK), `SubscriptionSelectionContainer`→`IOSPurchaseFlowContainer` dispatch on iOS, purchase→success→`invalidateQueries(["user-subscription"])`→`useFeatureGate`/`useUserModeEligibility` recompute, restore + "Manage in App Store" present, public `appl_` SDK key in BOTH `eas.json` profiles. **No greenfield build existed.** Posted the gap analysis to Slack + asked Brad (AskUserQuestion).

- **Brad's calls:** (1) products stay **catalog-driven, catalog = SSOT** — NO hardcoded 2-product filter; he'll reconcile catalog vs App Store Connect (some IAPs may be stopped). NB the brief said "only premium + individual_trainer purchasable" but memory `project_subscription_architecture_revenuecat` (2026-06-27) + code support 4 tiers / 6 packages; purchasability is DERIVED from the RC `default` offering, not code. (2) **Harden + verify** the existing flow.
- **PR #189 (`86e9dc9`, mobile-only, 7 files) — two REAL correctness fixes found auditing the shipped flow:**
  (1) **🟠 Success screen showed the stale (free) tier after an IAP purchase.** Entitlement lands via an ASYNC RC webhook, but `SubscriptionSuccessContainer` refetches `/subscriptions/me` immediately and wins the race → a just-bought `individual_trainer` saw generic copy + NO "Manage Clients" CTA. FIX: `IOSPurchaseFlowContainer` threads the purchased tier to `/(auth)/success?tier=<tier>`; success container prefers a VALIDATED param over the racy query. **Stripe path untouched** (writes the row synchronously → no param → query fallback). (2) **🟡 Deferred (Ask to Buy / SCA) purchases showed "Purchase Error".** RC throws `PAYMENT_PENDING_ERROR` → classifier keyword-matched it as `store_problem`. FIX: new `pending` `PurchasesErrorKind` matched AHEAD of the payment→store rule; container shows an info "Purchase Pending" notice, no nav. Also DRY'd trainer-tier checks behind `isTrainerTierName`; tier-param parse exhaustiveness-guarded via `Record<SubscriptionTierName,true>` + own-property check (rejects `toString`/`constructor`).
- **Gates:** prettier clean, tsc 8/8, lint 0 err, mobile jest 3976 (cov ≥90%), build 13/13. **IB local clean @ `500ba70`** (no blocking; 3 🔵 info — applied the one actionable exhaustiveness suggestion at `d829dd2` + locking test; the other two pre-existing/by-design). @inspector-brad CI NOT fired. Merged on durable auth. Slack pinged (recon, PR-up, merge); ntfy still sandbox-blocked.
- **⚠ NO MIGRATION.** **NEXT (Brad-side, not code):** (a) reconcile subscription catalog vs App Store Connect (stopped IAPs) — keep catalog = SSOT; (b) **on-device SANDBOX verify** (needs a fresh EAS dev build) — every purchase path, restore, deferred/Ask-to-Buy, entitlement propagation, coach-mode unlock; NOTHING IAP is device-verified yet; (c) ops/dashboard: clear "Missing Metadata" on ASC products, sandbox tester Apple ID, App Store Server Notifications V2 → RC, prod webhook once DNS resolves (per `project_subscription_architecture_revenuecat` remaining list).

**2026-07-10 (later) — M18 Start-live PR2 → PR #188 MERGED (squash `535673a`). `main` = `535673a`. IB clean @ `4ab1b60`, all CI green.**
This COMPLETES the reshaped coach roadmap: Attribution ✅ → Athlete Training page ✅ → Send brief ✅ →
**Live-session: Swap #187 ✅ + Start-live #188 ✅**. Built INLINE (no implementer subagents). Branch
`feat/coach-start-live`, 2 commits (`8b8ae5e` feature + `4ab1b60` IB fixes), 28 files.

- **What shipped:** Start-live = a coach runs an IN-PERSON session on the COACH's own device, reusing the
  whole athlete active-session UI in `withClient` mode, and Finish records it as the CLIENT's session
  (`logged_by_user_id = coach`). Async, on-behalf, NO realtime. Closes the Phase-5 deferred on-behalf
  session-logging UI.
- **Backend (new on-behalf RECORD endpoint — the existing `POST .../sessions` writes a HEADER only):**
  `SessionRepository.recordSession` gained optional `{ loggedByUserId, afterRecord }` (additive; self path
  unchanged — passes nothing → loggedByUserId null, afterRecord undefined). New
  `recordClientSessionOnBehalf` (`trainers/sessions/recordClientSession.ts`): `assertTrainerCanActForClient`
  gate (NO entitlement gate, mirrors the header endpoint), client-scoped `recordSession` with PR detection +
  completed-only `linkCompletedSession` occurrence-link (adherence), **in-tx `workout_logged_on_behalf` audit
  for BOTH completed AND cancelled** (§1.4.2 invariant — DELIBERATE strengthening over the brief, which
  folded audit into the completed-only hook and would have left a cancelled on-behalf write un-audited), then
  completed-only post-tx streaks + volume + client notify. Handler
  `POST /trainers/me/clients/:clientId/sessions/record` reuses the self `RecordSessionInput` validator
  verbatim; mounted in `trainersOnBehalfRoutes` (static `sessions/record` segment). **NO migration** (enum
  value exists).
- **Mobile (routes ENTIRELY through the offline sync queue — no new port method):** `finalizeSessionCommand`
  computes the endpoint (on-behalf when a client id present, else self `/sessions/record`); complete + all
  discard paths (session screen, bar long-press, stale-resume) route correctly. The sync worker's
  athlete-summary capture is gated on the self endpoint string → coach case naturally skips it (that cache is
  keyed by the coach's userId). Coach completion returns to Client Detail (not the athlete PR-summary).
  Client Detail "Upcoming sessions" rows gained a **Start** action.
- **⚠ IB FOUND 2 🟠 High data-isolation leaks (first sweep), both FIXED in `4ab1b60`, root cause = coach
  context living only on the zustand/AsyncStorage pointer (violated "SQLite is the existence authority"):**
  (1) rehydrate rebuilt the pointer from SQLite via `adopt(pointerFromSession(live))` with NO trainer context
  → after a force-quit the client's session flushed to the COACH's own history/PRs/streaks. FIX: persist the
  coach context IN SQLite — new `active_sessions.client_id/client_name/client_initials` columns + idempotent
  PRAGMA-checked ALTER migration; threaded `WorkoutSession.withClient` ← `SessionContext`/`createSessionFromWorkout`
  ← `startSessionCommand`; `pointerFromSession` recovers `withClient` from the session. (2)
  `finalizeSessionCommand` ran under the coach's userId → the client's lifts polluted the COACH's `recent_sets`
  ("Previous" chips). FIX: gate the recent-sets upsert on `!onBehalfClientId`. Both locked with behavioral
  regression tests. Re-sweep CLEAN.
- **Gates:** core 2211 tests / 98.35% cov; mobile 3969 / 96.28|90.23|96.59|97.77; tsc 8/8, lint 0 err,
  build 13/13, repo prettier clean on tracked files. Merged on durable auth. @inspector-brad CI NOT fired.
- **NEXT:** NOTHING device-verified yet on the whole Live-session milestone (Swap #187 + Start-live #188) —
  needs a fresh EAS dev build. ⚠ #187's two migrations (`20260709130000` + `20260709130100`) STILL need
  manual PROD apply (staging auto-applied on merge); #188 adds none. Coach Mode remaining (non-roadmap):
  Phase 8 (invite QR, decision #2), Phase 10 (Coach Home, decision #1). ntfy still sandbox-blocked (curl
  denied); Slack pings worked (PR-up + merge).

**2026-07-10 — M18 Live-session milestone: Swap PR #187 MERGED (`626f4ea`). Start-live (PR2) building. Brief at specs/milestones/M18-live-session/BRIEF.md.**
Reshaped-roadmap final piece (Attribution ✅ → Training page ✅ → Send brief ✅ → **Live-session**).
Recon-first (3 Explore agents: active-session lifecycle, workout_assignments model, legacy parity).
**Brad's 2 locked decisions (2026-07-09, via AskUserQuestion):**
(1) **Start-live = coach-run IN-PERSON session, on-behalf, async** — coach opens the client's session on
their OWN device (reuse the athlete active-session UI in the existing `withClient` pointer mode), logs sets
live, Finish records via the SHIPPED `POST /trainers/me/clients/:id/sessions` (`workout_logged_on_behalf`).
NO realtime (there is none anywhere; legacy has realtime only for notifications). Resolves Phase-5 deferred
decision ①. REJECTED: real-time remote co-presence (multi-week new-infra bet, breaks local-first).
(2) **Swap = any OPEN assignment** (ad-hoc + programme occurrence) — PATCH replaces workoutId, keeps
programme link, records original in `swapped_from_workout_id`.

- **Split:** PR1 = coach "today's session" read surface + Swap; PR2 = Start-live layered on it.
- **#187 (Swap, PR1) OPEN** — branch `feat/coach-swap-workout` @ `3b81050`. Backend: `GET`/`PATCH
/trainers/me/clients/:id/workout-assignments[/:id]` (list open assignments + swap-in-place). swapAssignment:
  readability check + ownership/status folded into query + original-preserving swapped_from + **lost-race guard**
  (zero-row UPDATE → not_swappable, mirrors linkCompletedSession). Audit `workout_swapped` in-tx; reuses
  `workout_assigned` notification. Migrations: `action_type_enum += workout_swapped` + `workout_assignments
ADD COLUMN swapped_from_workout_id`. Mobile: getClientWorkoutAssignments + swapClientWorkoutAssignment
  ports + SwapWorkoutSheet + Client Detail "Upcoming sessions" card. Gates: core 2195/98.34%, mobile 3957/≥90%.
  IB local clean @ 3b81050 (1 🟡 lost-race 500→409 found + fixed + regression-tested; re-sweep clean).
  ⚠ PROD migrations manual.
- **Swap PR #187 MERGED (`626f4ea`)** — IB clean @ 3b81050, all CI green, squash-merged on durable auth.
  ⚠ PROD migrations manual: `20260709130000_workout_swapped_audit_value` + `20260709130100_workout_
assignments_swapped_from` (staging auto-applied on merge).
- **NEXT: Start-live (PR2) — SCOPE CORRECTED by recon 2026-07-10 (was mis-scoped in the original brief).**
  The existing `POST /trainers/me/clients/:id/sessions` (`logClientSessionOnBehalf`) writes a session
  HEADER ONLY (`SessionRepository.create`, no sets/PRs/adherence). A coach-run LIVE session logs full sets,
  so PR2 NEEDS **a new on-behalf RECORD endpoint** `POST /trainers/me/clients/:id/sessions/record` that
  reuses `SessionRepository.recordSession`. Seam is clean + fully mapped in the brief PR2 section:
  `recordSession` += optional `loggedByUserId` (threaded into the insert; currently only sets `userId`);
  new `recordClientSessionOnBehalf` core (gate, NO entitlement gate per the header endpoint's precedent,
  `afterCompletedRecord` hook does `linkCompletedSession` + `workout_logged_on_behalf` audit in-tx, post-tx
  streaks+volume scoped to the CLIENT, best-effort notify); handler reuses the self `RecordSessionInput`
  validator; mount in `trainersOnBehalfRoutes`; NO migration (enum value exists). Mobile: Start button on
  the PR-1 Upcoming-sessions row → `startSessionCommand` in `withClient` mode (pointer + Active-Session
  UI + `<TrainerBannerPresenter>` ALREADY partly reference `withClient` — audit what's wired first) →
  `finalizeSessionCommand` routes the enqueue to the on-behalf endpoint when `withClient` set (sync worker
  POSTs `entry.endpoint` generically; the athlete-summary capture is gated on `/sessions/record` so it
  NATURALLY skips the coach case — correct, that cache is keyed by the coach's userId). Submit → back to
  Client Detail (NOT the athlete PR-summary). **RECOMMEND a fresh focused session** — PR2 writes into a
  CLIENT's workout history/PRs/streaks/adherence on-behalf in a shared tx (user-data-isolation dangerous
  area); the M17+M18-Swap marathon was a natural stop-point. This session shipped M17 (#186) + M18-Swap
  (#187) + the M18 brief with both Live-session decisions locked.

**2026-07-09 (latest) — M17 Send-brief → PR #186 MERGED (squash `faa9e67`). `main` = `faa9e67`. IB clean @ 012e8a8, all CI green.**
Brad answered the 3 recon questions in-session: free-text composer (500-char cap, title "Brief from
Coach {name}" / physio "Brief from {name}" / fallback "Brief from your coach"), persists as a normal
`coach_brief` notification row, NO spec needed — build direct. Built INLINE, one PR (backend+mobile,
34 files), branch `feat/coach-send-brief` @ 012e8a8.

- **Backend:** `POST /trainers/me/clients/:clientId/brief` (`trainers/briefs/` — handler + shared
  `sendClientBriefOnBehalf` core, mounted in trainersOnBehalfRoutes). Gate → **notification row +
  `brief_sent` audit in ONE tx** (the notification IS the deliverable — differs from other on-behalf
  writes where the emit is post-commit best-effort) → push post-commit via NEW
  `NotificationDispatcher.dispatchExisting` (never throws; createAndDispatch refactored through it).
  `NotificationRepository.create` gained optional `tx`. Handler trims + 422s whitespace-only;
  t.String 1..500. deepLink = `persistencemobile://train`.
- **Migrations (⚠ PROD MANUAL, staging auto-applies on merge):** `20260709120000` notification_type
  += coach_brief; `20260709120100` action_type_enum += brief_sent.
- **Mobile:** coach_brief in union/labels/CATEGORIES(Trainer & Physio)/notificationVisual
  (IconMessage, trainer). Deep-link: `train` scheme host → `/(app)/(tabs)/train` + NEW shared
  `ui/navigation/notificationRoute.ts` `resolveAndPrimeNotificationRoute` used by BOTH dispatch
  sites (useNotificationDeepLink + NotificationsListContainer) — train-bound tap primes
  setPendingSegment("Training")+setSegment (HomeContainer pattern). Root-mounted `SendBriefSheet`
  (+`state/send-brief-sheet.ts`); 4th "Brief" quick-action on Client Detail (hidden-Schedule slot);
  `sendClientBrief` port method (online-direct) + SST/InMemory adapters.
- **Gates:** backend 2173 tests / 98.32% cov; mobile 3945 / 96.29|90.34|96.56|97.79; tsc 8/8, lint 0
  err, build 13/13, repo prettier clean on tracked files. **IB local clean @ 012e8a8** — 2 🔵
  info-only left as-is (raw-vs-trimmed maxLength; segment priming exact-route-equality would skip a
  future train link WITH a query string — backend emits bare host).
- **NEXT:** ⚠ PROD migrations manual (staging auto-applied on merge): `20260709120000` +
  `20260709120100`. EAS build → device-verify (coach sends brief → athlete push tap → lands
  Train/Training; also the outstanding M16 + earlier device verifies). Reshaped roadmap remaining:
  **Live-session milestone (Start-live + Swap-workout)** — needs a spec first (active session is
  local-first; swap needs `PATCH .../workout-assignments/:id` + `workout_swapped` audit enum).

**2026-07-09 (earlier) — M17 recon findings (all confirmed in the build):**
Recon-first per the M17 brief (3 Explore agents; built nothing at this stage). Findings:

- **Push delivery EXISTS — the golive memory was STALE** (fixed in memory/MEMORY.md). PR #142
  shipped it: `notifications/push/expoPushClient.ts` (real POSTs to exp.host, batch 100, dead-token
  handling) + `notificationDispatcher.ts` — **`NotificationDispatcher.createAndDispatch(userId, {...})`
  is the single choke point**: persists in-app row FIRST, then best-effort preference-gated push
  fan-out to `user_devices` active tokens (`DeviceNotRegistered` → deactivate). Tokens registered via
  `POST /devices/register` (mobile `usePushNotifications` → `getExpoPushTokenAsync`). Optional
  `ExpoAccessToken` SST secret. Real usage example: `trainersAcceptInviteCodeHandler.ts:220–241`.
  **So: full push v1, no in-app-only scope cut needed.**
- **Deep-link path fully EXISTS.** Notification `data.deepLink` (adapter tolerates `deeplink` too) →
  `application/notifications/deep-link.ts` `resolveNotificationRoute()` → routed on BOTH push tap
  (`useNotificationDeepLink`, foreground + cold-start, de-duped) AND in-app row tap
  (`NotificationsListContainer.tsx:207–229`, marks read then push). Absolute paths pass through:
  emit `deepLink: "/(app)/(tabs)/train"`. **Segment one-shot**: `useTrainSegment` default is already
  "Training", but a returning user may have "Workouts" persisted — mirror `HomeContainer.tsx:183–188`
  (`setPendingSegment("Training")` + `setSegment` + push); the dispatch site needs a small hook to set
  the segment for the train route (resolver is a pure route-string fn — design detail for the brief).
- **Patterns mapped** (from #182 notes CRUD): handler → shared core → `assertTrainerCanActForClient`
  → row + `auditTrainerAction` in ONE tx → post-commit `createAndDispatch`. New `action_type_enum`
  value (e.g. `brief_sent`) + new `notification_type` value (e.g. `coach_brief`) = separate idempotent
  ADD VALUE migrations (pattern: `20260706170000` / `20260705150000`) + schema.ts + backend union +
  mobile registration (notification.ts union/array/labels + notificationVisual switch + CATEGORIES
  under "Trainer & Physio"). Mobile affordance: Client Detail QuickActionsRow button → zustand
  sheet store (`state/coach-note-sheet.ts` pattern) → root-mounted sheet in `(app)/_layout.tsx` →
  port method → online-direct SST adapter.
- **⏸ BLOCKED on Brad (Slack pinged #brad-claude-agents; ntfy still sandbox-blocked):**
  (1) brief content — REC: free-text composer, ~500 char cap, title "Brief from Coach {name}";
  (2) confirm persists as a normal re-openable notification row (dispatcher default — no new table);
  (3) spec form — REC: committed `specs/milestones/M17-send-brief/BRIEF.md`, not a full Kiro triplet
  (composes already-specced patterns, no new architecture).
- **NEXT:** on Brad's answers → write the M17 brief → build INLINE (backend PR then mobile PR, or one
  if small): migrations + `sendClientBrief` core + `POST /trainers/me/clients/:clientId/brief` +
  mobile type registration + Send-brief sheet on Client Detail + Train-segment one-shot on the
  deep-link dispatch. IB local sweep before each PR; merge on IB-clean + green CI (durable auth).

**2026-07-09 — M16 Athlete Training page → PR #184 + #185 BOTH MERGED. `main` = `0e6a0d7`.**
Built the reshaped-roadmap "Athlete Training page" per Brad's 3 locked decisions (brief at
`specs/milestones/M16-athlete-training-page/BRIEF.md`, untracked). Built INLINE (no implementer
subagents, per the #182 lesson); Explore agents for recon only. Two-PR split, both IB-local-clean

- green CI, merged on durable authorization.

* **#184 backend (`8f9ceae`)** — enriched `GET /goals` (+`/:id`): `GoalRepository.list`/`getById`
  now LEFT JOIN `goal_types` (name/icon/category) + `profiles` (`assignedByName`, null for self-set),
  returning a `UserGoalDTO` (numeric→number, ts→ISO). Mirrors `nutritionTargetRepository.get()`.
  **NO migration.** The coach parity read `GET /trainers/me/clients/:id/goals` inherits the enriched
  shape (uses the same `list`). create/update/delete unchanged (cheap path — canonical list read is
  the render surface). IB 🟡 (mocked-getDb SQL blind spot) fixed with **PgDialect render-guard tests**
  asserting the join predicates + `user_id` filter (per `reference_drizzle_groupby_param_bug`).
* **#185 mobile (`0e6a0d7`)** — Train tab restructured: `useTrainSegment` widened to
  `Training | Workouts | Exercises`, **"Training" the new default** (fresh install lands on the
  overview; returning users keep persisted). `TrainHubContainer` renders new `TrainOverviewContainer`
  for the Training segment (programme → today's-training → goals). Extracted the Home today's-training
  row into a shared `<TodaysTrainingSection>` (Home consumes it, testIDs preserved). Goals net-new:
  `ApiGoal` enriched + domain `Goal`+mapper; cache-first `useGetGoals` (new `cached_goals` blob table +
  StoragePort methods, `CREATE TABLE IF NOT EXISTS`, no destructive migration); **optimistic online-direct**
  `create/update/delete` commands (write cache + reconcile/revert; reconcile PRESERVES the goal-type name
  because self POST/PATCH is un-enriched); `<GoalCard>` (NO progress bar, decision #2); coach-assigned
  goals **view-only, double-gated** (presenter passes undefined handlers + card hard-gates on
  `!isCoachAssigned`, decision #3); root-mounted `<GoalSheet>` (picker excludes already-owned types per
  `user_goals` UNIQUE). Phase-11 attribution rides through (ProgrammeCard coachName + rows + coach goals).
* **Gates:** backend tsc 8/8 + core test:unit 2159 (cov ≥90%); mobile jest **3932** (cov ≥90%), lint 0 err,
  repo prettier clean. Mobile IB clean @ `bbaae6c` (3 🔵 info-only, left as-is: optimistic-create flicker
  vs concurrent refresh self-heals; sheet reflects post-network on a spinner; update raw-fallback unreachable).
* **Deep-link ready** for the later Send-brief milestone (route: Train tab → Training segment). NO new
  backend endpoints beyond #184; consumes `/users/me/home` + existing goal CRUD.
* **NEXT:** EAS dev build → device-verify (nothing on-device yet). Copy ("Set by Coach {name}" etc.) is
  reversible — Brad may tune. Reshaped-roadmap remaining: **Send-brief** (push → deep-link the Training
  page) → **Live-session milestone** (Start-live + Swap-workout).
* ntfy push STILL sandbox-blocked (curl denied); Slack log pings worked (PR-up + merge for both).

**2026-07-09 (later) — Coach Mode Phase 11 (attribution layer) → PR #183 MERGED. `main` = `d38a17e`.**
Off Brad's reshaped-roadmap ask: surface "Set by Coach {name}" (the coach's REAL name,
`profiles.full_name`) consistently across every athlete-side coach-originated item. Built
INLINE (no implementer subagents, per the #182 misfire lesson). Branch
`feat/coach-attribution-layer`, single commit `bb0a17e`.

- **NO DB migration** — every coach FK already exists (`assigned_by_user_id`, `trainer_id`,
  `assigned_by`, `set_by_user_id`). Change only RESOLVES the name on athlete READ paths
  (mirroring the shipped `nutritionTargetRepository.get()` LEFT JOIN) + renders a shared badge.
- **Backend:** `homeReadRepository.getTodaysTraining` → `assignedByName` (profiles join was
  already there for role); `programAssignmentRepository.getActiveProgrammeForClient` →
  `assignedByName`; `habitConfigRepository.listForUser` → `assignedByName` (write-path
  `toView` stays null, canonical GET carries it); habit config handler + coach habit GET
  handler → `CategoryEntry.assignedByName`.
- **Mobile:** NEW shared `<CoachAttribution>` composite (text + banner variants) — FuelTargets
  now reuses it (dropped its local `TrainerAttributionBanner`). HomePresenter: named today's-
  training line + programme `coachName`; **both attribution paths gate on `assignedByType`**
  (IB fix — a former coach whose role reverted to `user` attributes on neither). ProgrammeCard:
  `coachName` prop → "Assigned by Coach X". HabitCard: named badge shown for ANY
  `assignedByCoach` habit (persists as history after relationship ends, §1.5); controls still
  gated on `locked`. Models: `assignedByName` on progress.ts / habit-config.ts / api.port.
- **Copy** (flagged to Brad, reversible): "Set by Coach {name}" (targets/habits/training),
  "Assigned by Coach {name}" (programme), "Set by {name}" for a physio. Matches spec STORY-013.
- **Gates:** repo prettier (changed files) clean, typecheck 8/8, lint 0 err, build 13/13,
  core cov 98.31%, mobile jest 3889. **Inspector Brad LOCAL clean** (6,041 tests; 2 low/info
  leads both addressed: the assignedByType gating + a coach-assigned-but-unlocked test). CI
  all green; **@inspector-brad CI NOT fired**. Merged on the durable authorization.
- **SCOPE:** athlete GOALS have no surface yet → goal attribution lands with the **Athlete
  Training page** (next), per the agreed build order. This PR = the 4 already-rendering surfaces.
- **NEXT (Brad's roadmap): Athlete Training page — SCOPED + decisions LOCKED, build not started.**
  Brief written to `specs/milestones/M16-athlete-training-page/BRIEF.md` (UNTRACKED, like the
  M13/M14/M15 briefs — Brad commits when he chooses). **Brad's 3 locked decisions (2026-07-09):**
  (1) **restructure the existing `Train` tab** (a `TrainHubContainer` hub: Workouts+Exercises
  segments) to LEAD with a Training overview: active programme → schedule → goals, keeping the
  workout hub intact; (2) **NO goal progress bar in v1** (currentValue is manual + no athlete
  update path → would read empty; show type+target+date+attribution only); (3) **full
  self-service goals** (view all; create/edit/delete OWN; coach-assigned view-only + attribution
  per cross-cuts §2.2, no request-unassign control). Backend = enrich `GET /goals`(+`/:id`) with
  goal_type name/icon + `assignedByName` (LEFT JOIN goal_types + profiles, mirror Phase 11 / the
  `nutritionTargetRepository.get()` pattern) — no migration; CRUD endpoints already exist. Mobile
  = ApiGoal enrich + Train-hub overview (reuse `<ProgrammeCard coachName>`, the today's-training
  row + `<CoachAttribution>`, `home/GoalsSection` visual MINUS the bar) + add/edit-goal sheets
  (goal-type picker) + optimistic CRUD. Suggested 2-PR split (backend, then mobile). Recommend a
  FRESH session re-grounded from the brief for the build (milestone boundary).
- ntfy push STILL sandbox-blocked (curl denied); Slack log ping worked.

**2026-07-09 — Coach client-management: #180 (Phase 6), #181 (goal picker), #182 (notes CRUD) ALL MERGED. `main` = `be843a2`.**
Long autonomous session off Brad's "manage clients" ask. Landed THREE PRs to main.

- **#180 Phase 6 (AI Client Summary)** — merged earlier (was open at session start). `main` picked it up.
- **#181 goal-type picker** (`GET /goal-types` + `goalsRoutes` sub-app + AssignGoalSheet
  catalog picker). Fixed a TS2589 Eden-Treaty depth error in web by grouping goals into a
  sub-app. NO migration. IB local clean; CI green; merged `b8469b6`.
- **#182 coach notes CRUD (Phase 12)** — POST/PUT/DELETE `/trainers/me/clients/:id/notes`,
  audit-in-tx, ownership-scoped (WHERE id+trainer+client), `trainersClientNotesRoutes`
  sub-app; mobile CoachNoteSheet (add/edit/delete) + CoachNotesCard wiring. KEY FINDING:
  the "1 note/client" UNIQUE was a PHANTOM in the Drizzle mirror — real DB (migration 20260117234613) never had it, so multiple notes always worked; corrected schema.ts, NO
  migration. IB local clean @ 76ca779 (added PgDialect WHERE-guard tests). Merged `be843a2`.
- **NEITHER #181 nor #182 added a DB migration** — nothing to deploy beyond #180 (whose
  `20260708130000_client_ai_summaries.sql` staging-applied on its own merge; PROD still manual).
- **Merge mechanics were gnarly** (both branches were off pre-#180 main; #180 landing forced
  merge-conflict resolution across ~7 shared Client-Detail files — all additive "keep both").
  Stacked #182 on #181; merged #181→main, retargeted #182→main, merged. Two CI hiccups: a
  hung Typecheck runner (transient — re-ran clean) and a stale failing run on a pre-amend commit.
- **⚠ LESSONS (reinforced):** (1) `git add -A` on the #182 merge swept the 15 untracked WIP
  files (STATE.md, marketing/, specs/milestones/\*, .claude/skills/) into the commit — caught
  - stripped via `git rm --cached` + amend + force-push BEFORE it reached main. ALWAYS stage
    explicit pathspecs. (2) Change-scoped prettier missed 2 note files (untracked-dir glob skip)
    → CI prettier failed → run repo-level `bun run prettier:check` before pushing. (3) Delegated
    `implementer` subagents MISFIRED badly — a runaway re-delegation chain (~5 nested agents did
    nothing but spawn); one eventually wrote the notes tests correctly. BUILD INLINE for this
    kind of work; don't delegate.

**⚠ ROADMAP RESHAPED BY BRAD (2026-07-09) — the coach "manage clients" sequence:**
Brad reviewed a scoping analysis (solo-athlete vs coached-athlete) + gave direction:

- **One view + a "coaching layer"** (NOT two apps) — a coached athlete = solo athlete +
  additive attribution/coach-originated surfaces keyed on the active relationship. AGREED.
- **Athlete "Training page"** to build — athletes currently have NO goals surface at all, and
  the Programmes tab is coach-only; the page consolidates programme + schedule + goals (+ coach
  attribution). Brad said build it (decision #2 yes).
- **Attribution layer (Phase 11)** — coach name + "set/changed by Coach X" consistently; today
  it's patchy (only Fuel Targets shows the coach NAME; "Set by coach" generic elsewhere; goals invisible).
- **Send brief** = push notification to the client (confirmed). Deep-link SHOULD land on the new
  Training page.
- **Start-live (coach drives a live workout)** = "the crux", but it's its OWN MILESTONE (needs a
  spec — active session is local-first, no coach live surface today). **"Swap workout" FOLDS INTO
  this milestone** (both need "today's session" surfaced + occurrence replacement; swap needs a
  NEW `PATCH .../workout-assignments/:id` + `workout_swapped` audit enum — the existing assign
  path only STACKS rows). **"Log past session" DROPPED** (Brad: not needed).
- Agreed build order: **Attribution (Phase 11) → Athlete Training page (incl. Goals) → Send brief
  → Live-session milestone (Start + Swap)**. Adherence-completeness slots in anywhere.
- Brad DURABLY AUTHORIZED me to MERGE Inspector-Brad-clean PRs (used it for #181/#182).
- **NEXT:** start the Attribution layer (Phase 11), then the Athlete Training page. Prefer a
  FRESH session re-grounded from this ledger. Full scoping detail is in this session's chat
  (not committed) — offer to formalize into `specs/` when picking it up.
- ntfy push STILL sandbox-blocked; Slack log pings work.

**2026-07-08 (later) — Coach Mode Phase 6 (AI Client Summary) → PR #180 OPEN, awaiting Brad.**
Branch `feat/coach-phase6-ai-client-summary` (single commit `4144638`), off `main` @ e508ee8.
Backend + mobile in ONE PR. Inspector Brad LOCAL clean @ 4144638 (2 sweeps).

- **Backend:** migration `20260708130000_client_ai_summaries.sql` (backend-only, RLS-on-no-
  policies; NAMED unique index `…_trainer_client_date_key` matching the Drizzle schema +
  backing onConflictDoNothing) + Drizzle table. `POST /trainers/me/clients/:clientId/ai-summary`
  (`trainersMeGenerateClientAiSummaryHandler`, mounted in trainersOnBehalfRoutes): gate →
  assertEntitlement(ai_access) → per-coach ceiling → row-state (auto-gen / 1 manual refresh /
  cached-no-infer) → Bedrock → upsert → ai_usage_log. 429 ai_daily_limit / 402 / 403 / 503
  graceful fallback. `clientSummaryAi.ts` reuses the M9.5 Bedrock seam (injectable client, forced
  tool use, no live AWS in CI). Aggregate stub FILLED (`clientDetailRepository.getAiSummaryModule`
  - `coachCanSpendOnSummary`) — reads NEVER infer. Consts in `clientAiSummaryRepository.ts`
    (`AI_COACH_SUMMARY_ENDPOINT`, fail-safe `AI_COACH_SUMMARY_DAILY_LIMIT`=40). infra: 2 env vars.
- **Mobile:** real `AISummaryCard` (empty/generating/loaded/refresh-disabled + "Updated … ago");
  `ClientDetailContainer` lazy auto-fire on open (null summary + online, netInfo-confirmed, once
  per visit) + Regenerate; ONLINE-ONLY (no sync queue). `generateClientAiSummary` on api.port +
  SST/InMemory adapters.
- **Inspector Brad first sweep found + FIXED:** 🟡 concurrent-open race (two opens → double-spend
  - UNIQUE-violation 500) → `insertInitial` now `onConflictDoNothing` returning bool; handler
    returns the winner's cached row on a lost race. 🟢 migration UNIQUE-name drift (→ named CREATE
    UNIQUE INDEX). 🟢 usage-log doc-consistency (reached-model failures ARE counted). Re-sweep clean.
- **Gates:** typecheck 8/8, build 13/13, lint 0 err, core coverage 98.32%, mobile jest 3869, prettier clean.
- **4 FLAGS for Brad in the PR (none block review):** (1) lazy auto-fire-on-open (spec default,
  built) vs explicit Generate tap — his UX call; (2) the prompt (pasted, to tune); (3)
  `AI_COACH_SUMMARY_MODEL_ID`=eu Haiku 4.5, limit 40/coach; (4) confirm NO trainer_actions_audit
  row for the cache write (not a client-data mutation — built that way).
- **⚠ NEXT:** Brad reviews #180 → decides the 4 flags → merge → **prod migration is MANUAL**
  (staging auto-applies). Then EAS build → device-verify the coach AI card. Coach Mode remaining:
  Phase 8 (invite QR, decision #2), 10 (Coach Home, decision #1), 11 (attribution badges), 12 (notes UI).
- ntfy push STILL blocked by the session sandbox (curl denied) — Slack log ping worked; no Mac ding.

**2026-07-08 — Fuel delete + food names + macros → PR #179 MERGED. `main` = `e508ee8`.**
Branch `feat/fuel-delete-entry-ui` (commit `87386c1`), merged e508ee8; ALL CI green
incl. Inspector Brad CI "No issues found". Four asks off Brad's device feedback,
all shipped in ONE PR:

- **Swipe-to-delete** on Fuel logged rows (ReanimatedSwipeable → red Delete;
  replaced an initial long-press per Brad's call). Optimistic + offline
  COALESCING in `deleteEntryCommand`: an un-drained create (and any queued edit)
  for the same local id is cancelled — no doomed `DELETE /nutrition/entries/
local-…` (would 404-loop + orphan). Added a jest subpath mock for
  `react-native-gesture-handler/ReanimatedSwipeable` in `__tests__/setup.ts`.
- **`custom_name` column** (backend: migration `20260708120000` + POST/PUT +
  repo + today/list DTOs, no-clobber PUT; mobile: model + logEntryCommand +
  useAiDraftItems passes `item.name` + `entryDisplayLabel` prefers it). Fixes
  AI/one-off entries showing "Quick entry" instead of the food name. (Brad asked
  "isn't there an existing field?" — NO; verified schema had only ids/macros/
  ai\_\*; custom_name is the minimal durable fix, foods-row routing rejected as
  library pollution.)
- **P/C/F macros** on logged Fuel rows + food search-results list (were kcal-only).
- **`swapLocalNutritionEntryId`** id-swap (mirrors exercise/session/habit) —
  closes the in-flight-create delete-orphan window IB flagged.
- **Method:** backend custom_name ran as a parallel `implementer` agent (disjoint
  dirs: microservices/core + packages/db vs my mobile work — no race). 2 IB local
  sweeps (full-branch + focused re-sweep on the id-swap): clean after fixing its
  one 🟡 (the id-swap itself). Gates: repo tsc 8/8, backend unit 19/19 (98%+),
  mobile 3860/3860, lint 0, prettier clean.
- **Brad fired `@inspector-brad` CI on #179 himself** (via me, explicit request)
  as a local-vs-CI quality A/B — the ONE sanctioned exception to the don't-fire
  rule; billed intentionally. CI result pending.
- **⚠ NEXT:** #179 MERGED → prod migration (manual, still pending) → EAS build →
  device-verify swipe-delete + food names + macros (none on-device yet). Still also
  pending: the #174–#178 habit fixes need the same EAS build + device re-verify.
- **NEXT FEATURE = Coach Mode Phase 6 (AI Client Summary).** Brad chose it; full
  execution brief HANDED OVER IN CHAT 2026-07-08 (not committed — chat copy per
  feedback_setup_briefs_as_chat_copy). Architecture already fully specced in
  `specs/10-trainer-features/design.md` §"Module g" (lines 676–745): POST
  `/trainers/me/clients/:clientId/ai-summary`, `client_ai_summaries` table (DDL at
  :694–707, does NOT exist yet), lazy-gen + 1 manual refresh, hard cap 2/client/day,
  `AI_COACH_SUMMARY_DAILY_LIMIT` ceiling, privacy = totals+adherence NOT food log.
  Reuse M9.5 Bedrock seam (`nutrition/services/aiEstimation.ts`) +
  `aiUsageLogRepository.countForUserToday`. Fills the Phase-5 aggregate stub
  (`clientDetailRepository.ts:177–184`) + the mobile AISummaryCard stub
  (`ClientDetailPresenter.tsx:512–565`). OPEN UX DECISION for the Phase-6 agent to
  get from Brad: auto-fire-on-open vs explicit "Generate" tap for the first summary.
- **Inspector Brad local-vs-CI A/B (Brad's experiment):** CI @inspector-brad on #179
  returned "No issues found" — matched the local sweep (which had already driven the
  1 🟡 fix pre-push). Caveat noted to Brad: not a clean head-to-head (local saw the
  pre-fix diff + drove the fix; CI saw the post-fix diff). Brad separately chasing
  why his KIRO-project hook inspector-brad underperforms its CI action — gave him a
  paste-ready diagnostic brief (model tier / diff-scope / repo-read tools / prompt
  depth / verify-pass are the usual gap axes).

**2026-07-07 (cont.) — #178 corrects #177's Home-drop; Supabase habit data cleared. `main` = `19deadf`.**

- **#178** reverts #177's Home-grid change (KEEPS #177's setup banner). Brad
  caught the collision: a deferred disable STILL counts this week, so dropping it
  from Home stranded a habit the user couldn't tick (guaranteed miss). Home now
  filters on LIVE `enabled` (= "counts this week"): pending-disable STAYS this
  week + leaves Monday; pending-enable hidden until Monday. Setup shows off-switch
  - "starts Monday" banner (intent); Home shows what's live/countable. IB clean @
    99fa126. **LESSON: with deferred-disable, "still counts this week" ⇒ must stay
    hittable on Home; the setup screen carries the intent, the grid carries what's
    scoreable.**
- **Supabase habit data CLEARED for bradley.evans26@outlook.com** (user
  7def4fca-9dab-471f-8375-ee95e10c8864, project dfeyebgdktfteqlacmru "persistence")
  at Brad's explicit request — deleted habit_completions(1)/habit_configs(3)/
  habit user_goals(3)/habit_streak(1) in one tx; verified all-zero. Clean slate
  for re-testing habit setup (needs the fresh EAS build).
- **NEW go-live gap logged** (see "Go-live gaps" section): no UI to remove a
  logged calorie/nutrition entry — `deleteEntryCommand` exists, no delete
  affordance surfaces it. Brad-flagged before go-live.

**2026-07-07 — habit disable-visibility fix MERGED. `main` HEAD = `a300409`.**
On-device: Brad disabled habits but they lingered + no "starts next week" cue.
Root cause: disable defers to Monday (live stays enabled + pending
{enabled:false}); (1) Home grid filtered on LIVE enabled → lingered; (2) #175's
draft+Save baseline nulls `pending` for the presenter → the per-control "Starts
Monday" tags went invisible. **Brad's call: keep the deferral, make it visible +
consistent** (#177, IB clean @ a0ad517):

- `buildHabitGrid` (useGetHabits) now filters on INTENDED enabled
  (`pending.config.enabled ?? enabled`) → disabled habit drops from Home
  immediately (pending-enable appears immediately); target-only pending edit
  keeps the habit; streak still scores live until Monday (anti-gaming intact).
- Setup screen: new screen-level **deferral banner** ("Changes take effect next
  Monday…"), driven by `configsList.some(c => c.pending != null)`. Supersedes the
  now-dead per-control Starts-Monday tags under the draft model.
- **Leftover test-habit data: Brad clears it manually on Supabase** (his call —
  no reset tooling built). ⚠ ALL of 2026-07-06/07's mobile fixes (#174–#177) need
  a **fresh EAS dev build** to appear on device — nothing's been device-verified.

**2026-07-06 (latest) — habit-setup UX + water fixes MERGED. `main` HEAD = `90f25d5`.**
Brad on-device testing surfaced three habit bugs; all fixed + merged (merge-on-IB-clean):

- **#174** (`fix/latent-optimistic-rerender`): weigh-in → You body-trend chart
  didn't reflect (retained tab); useFocusEffect→body.reload() on YouContainer.
  The "~10 latent callsites" collapsed to this ONE real case (see prior entry).
- **#175** (`fix/habit-setup-draft-save`): **can't-toggle-off on the habit SETUP
  screen.** Root cause: setup wrote to the backend on every toggle, and a
  disable defers to Monday (pending {enabled:false}, live stays enabled), while
  the Switch was driven by live `enabled` → snap-back. Brad's call: **draft +
  explicit Save button.** HabitSetupContainer now holds local draft (toggles
  instant, off shows off), commits on Save (diff vs baseline; enable-then-disable
  = no write), Back discards; **pending-aware baseline** (`enabled =
pending?.enabled ?? live`) fixes the re-open snap-back too. Sticky footer Save
  btn. IB clean @ a72ea31.
- **#176** (`fix/water-litres-habit-bridge`): water UI mixed cups (log) vs litres
  (habit) AND logging water never ticked the habit. Brad's call: **litres
  everywhere, 1 cup = 250 ml = 0.25 L.** WaterTrackerPresenter (shared Fuel +
  Home water sheet) shows litres; **storage/wire stay integer cups** (0.25 L =
  1 cup exact, no migration). Mobile **binary-threshold bridge**: day's water ≥
  target → ensure water-habit completion (value=target, same as grid tile),
  below → remove; idempotent; invalidateHome on flip. Extracted shared
  `setHabitCompletion()` (toggle-habit + bridge share it). IB clean @ d5eb809.
- **DESIGN NOTE (recurring):** all habit/optimistic surfaces reflect via
  cache-first + focus/invalidate (reload() from #173) — there is NO live push to
  an already-mounted BACKGROUND tab; the tick shows on focus/re-read. This is the
  established design, not a bug. Container tests must assert the presenter/probe
  re-renders, not just that storage was written.
- **Still deferred:** Phase 18.6 HealthKit two-way sync (the water-log→habit
  bridge here is the in-app path; HK path still unbuilt). No device re-verify yet
  (needs an EAS dev build) — worth confirming toggle-off + water-tick on device.

**2026-07-06 (later) — #173 optimistic-rerender fix MERGED. `main` HEAD = `d428421`.**
Brad hit a device bug: tapping a habit tile did nothing until navigate-away/back
(value persisted, grid didn't re-render). ROOT CAUSE: `useCachedResource`
(the shared cache-first hook behind ~17 screens) held cache data in a useState
that only updated on mount or a successful network `refresh()`; optimistic
mutation commands write the SQLite cache + return void, so the mounted
component's snapshot stayed frozen. FIX (#173, mobile-only): added a synchronous
`reload()` to useCachedResource (re-reads cache→setData, no network, offline-safe
— mirrors the pattern useGetFuelToday already had), wired HomeContainer habit-grid
toggle (reloadHabits) + HabitSetupContainer (reflectAfter: self→reload, coach→
refresh CHAINED onto the mutate drain so the GET can't race the on-behalf PUT).
Tests now assert the mounted RE-RENDER (the gap that let it ship — old tests only
asserted the cache write). IB clean @ c736b54 after 2 rounds (caught the coach
race). **KEY LESSON: the whole app's optimistic-write pattern depended on
screens unmounting-on-save to re-read cache; container tests that only assert
`storage.getCached*()` do NOT prove the UI updates — assert the presenter/probe
re-renders.** FOLLOW-UP CHIP — DONE (PR #174, merged, main @ bb256c9). The "~10 latent
callsites" collapsed to ONE genuine fix after precise per-callsite audit:
weigh-in → You body-trend chart (the weigh-in sheet is rendered by HOME, but
YOU owns the chart; tabs are RETAINED — no unmountOnBlur — so returning to You
showed a stale chart until pull-to-refresh). Fix: useFocusEffect → body.reload()
on YouContainer (mirrors ProfileContainer focus-refresh, but sync cache read).
All the OTHERS were already correct or not-built (verified, NOT wrongly
dismissed): FuelContainer logEntry = sheetRev→fuel.reload(); setWater reloads;
setTarget/EditProfile = router.back unmount; ProfileContainer = existing
useFocusEffect(refresh); editEntry/deleteEntry/createRecipe/createMeal have no
containers yet (post-M9). LESSON: the audit's first-pass suggested fix (reload
inside the weigh-in sheet) was a RED HERRING — the sheet's body hook instance ≠
You's instance; confirm the actual consumer before wiring. Did NOT pad the PR
with no-op reloads on already-correct screens.

**2026-07-06 (end of session) — ALL MERGED: #170 (Phase 7) + #171 (Phase 5) +
#172 (workout_unassigned audit). `main` HEAD = `4ed259c`.** Brad authorized
merge-on-IB-sign-off. Merge order was #170 → retarget #171 to main → #171 →
#172. All stack branches deleted (local + remote); this worktree
(suspicious-mendeleev) is synced to main.

- **Coach Mode status now:** Phases 0–5, 7, 9 SHIPPED. Remaining: 6 (AI
  Client Summary — NOW UNBLOCKED, next natural pickup), 8 (invite QR,
  decision #2), 10 (Coach Home, decision #1), 11 (attribution badges,
  unblocked), 12 (notes endpoints+UI, unblocked). Habits 18.6 HealthKit
  two-way sync deferred (own PR, needs device bridge).
- **⚠ MIGRATIONS FOR PROD (Brad, manual):** #172 shipped
  `20260706170000_workout_unassigned_audit_value.sql` (enum ADD VALUE) —
  staging auto-applied on merge; prod still pending alongside the earlier
  `20260705140000` + `20260705150000` if not yet applied. #170/#171 had NO
  migrations.
- **Follow-ups on record:** goal-types list endpoint (AssignGoalSheet
  create-mode is a raw goalTypeId field until then — flagged in #171 body);
  integration-level tx-rollback test for audit-in-tx (§1.4.2, noted in #172
  body); on-behalf session-logging UI (own slice, decision ① in the Phase-5
  brief); EAS dev build → device verification of the new habit-setup +
  Client Detail screens (no on-device check yet — jest/tsc only).
- Citations chip (task_bf71a505) was started by Brad separately but the work
  had already merged via #169 — that session can be closed with no action.

**2026-07-06 (cont.) — #168+#169 MERGED (main e8d2337); Phase 7 → PR #170 OPEN; Phase 5 building.**
Same Fable session, orchestrating (Opus implementer subagents execute).

- **PR #170 (Phase 7, spec-18)** branch `claude/habits-phase7` @ 1e26515, IB clean
  after 2 fix rounds. Backend: holidays routes, completion value validation,
  coach habit routes (gate-first + goal_assigned audit-in-tx), collection
  streak engine (weekMet/effective_from gating/pending promotion in cron/
  mode:"skip" freeze). Mobile: habit-setup screen 1:1 port (athlete
  `/(app)/habits-setup`, coach `/(app)/clients/[id]/habits`), configure/disable
  commands, deriveCollectionStreak, cached_habit_configs, Home CTA wired.
  **IB catches worth remembering:** (1) grid binary tap 422'd once value habits
  got configs → tap now sends value=target for value_gte; Calories tile made
  read-only → Fuel deep-link (engine scores calories from nutrition_entries);
  (2) offline configure-then-tap lost the completion on drain (local- goalId
  never swapped into queued completion payloads) → new
  StoragePort.swapLocalHabitGoalId. 4 product flags in the PR body for Brad
  (tap semantics, calories tile, real within_tolerance, mid-week advance).
  18.6 HealthKit deferred (own PR). No migration.
- **PR #171 (Phase 5, Client Detail full build)** branch
  `claude/client-detail-phase5` @ 5f103d1, **STACKED on claude/habits-phase7
  (#170)** — merge #170 first, do NOT --delete-branch habits-phase7 until
  #171 lands (stacked-close footgun). IB clean @ 5f103d1 (1 🟡 fixed: goal
  edit sheet couldn't seed targetDate → threaded through the aggregate
  contract). Backend: GET /trainers/me/clients/:clientId aggregate (modules
  a–g, aiSummary null stub for Phase 6, calorie totals-only privacy tested,
  route-shadow test). Mobile: full single-scroll rebuild + NEW
  EditNutritionTargetsSheet + AssignGoalSheet (root-mounted). Flags in PR:
  no goal-types list endpoint (create-mode = raw goalTypeId field — needs
  an endpoint before real coach use); aggregate returns unrendered
  habits/prs/recentSessions deliberately (Phase-6 AI inputs); LiveSessionCTA
  shows programme+week (no per-day workout name on ActiveProgramme).
  Follow-up chips queued: workout-assignment DELETE audit row; (earlier)
  cross-cuts fix landed via #169. Phase 6 (AI summary) is now unblocked
  once #170+#171 merge; Phase 12-UI unblocked too.

**2026-07-06 (follow-up, same session) — spec citation fixes → PR #169 OPEN.**
Chip task off the inspector observations. Branch `fix/coach-spec-stale-citations`,
commit `bf0939c`; inspector-brad local clean @ bf0939c. Docs-only, 5 files:
the phantom `profiles.display_name` (column doesn't exist; real = `full_name`
@ schema.ts:283) fixed in cross-cuts § 1.5, 10-trainer design (corrections
block, also :273→:283) + requirements locked-decision #8, 13-nutrition
design + M9 BACKEND_BRIEF (`setByName`). The re-sweep found 3 of those 5
itself (only 2 were originally reported). **No code change needed** — shipped
`nutritionTargetRepository.ts:45` already reads `fullName`; specs were stale,
query always correct. Cross-PR note posted on #168 (its "§1.5 is STALE"
warning becomes moot once #169 merges — harmless either way). No merge
conflicts between #168 and #169 (disjoint files).

**2026-07-06 — Phase 5 execution brief authored → PR #168 OPEN, awaiting Brad.**
Fable planning session (no code). Branch `claude/suspicious-mendeleev-2a035b`,
commit `fba5b59`; inspector-brad local clean @ fba5b59 (caught 2 🟡 wrong repo
method-name citations — fixed: module b = `HomeReadRepository.getRecentPRs`,
module d = `NutritionTargetRepository.get`).

- **New `specs/milestones/M8-coach/PHASE5_CLIENT_DETAIL_BUILD_BRIEF.md`** —
  aggregate `GET /trainers/me/clients/:clientId` + full single-scroll mobile
  build (modules a–f), grounded on 2 Explore-agent inventories of main @
  143f2df vs the Phase-4 contract. Net-new backend work is only: the
  aggregate itself, module-d nutrition week-rollup (totals only — privacy
  line), module-f habit weekly-satisfaction compute (cross-cuts § 3.7),
  aiSummary shape-stub (table is Phase 6). Mobile: port client-detail.jsx
  1:1, wire QuickActions (new EditNutritionTargetsSheet + AssignGoalSheet),
  keep the shipped #146/#166 blocks.
- Old `CLIENT_DETAIL_BRIEF.md` marked SUPERSEDED; phase index refreshed
  (3/4/9 ✅, Phase 5 UNBLOCKED + repointed, fan-out updated).
- **3 open decisions flagged in the brief + PR** (proposals, don't block
  merge): ① on-behalf session-logging UI OUT of Phase 5; ② keep Body-trend
  section + Log-weight CTA (not in prototype); ③ light Calorie adherence
  category in v1.
- Housekeeping: pruned merged `cranky-borg-8a030b` worktree + local branch
  (remote already gone). **Found: STATE.md + CLIENT_DETAIL brief drift risk —
  STATE.md is UNTRACKED so worktree sessions can't see it; CLAUDE.md calls it
  in-repo. Flagged to Brad (commit it or fix CLAUDE.md wording).**
- Known stale-spec debt (inspector observations, not this PR):
  cross-cuts.md §1.5 still says `profiles.display_name` (column is
  `full_name`); design.md corrections block cites schema.ts:273 (now :283).
- **Next:** Phase 5 build off the new brief (Opus session, backend agent →
  frontend agent, one PR) once #168 merges. Phase 7 / Phase 12-endpoints /
  Phase 11 remain parallel-safe.

**2026-07-06 (late) — Phase 9 Programs + habits hotfix MERGED to main.**
`main` HEAD now `143f2df`. Landed both PRs, all gates green, in order:

1. **#167** (`fix/habits-monday-week-boundary`) → main (`91a05ec`). Test-only
   habits Monday-flake fix; branch auto-deleted.
2. Merged `origin/main` INTO the Programs branch `claude/cranky-borg-8a030b`
   (merge commit `ce43221`) to link up Phase 3/4 (#164/#165) + the #167 fix.
   Auto-resolved (no conflicts, incl. the `progress-hooks.test.tsx` overlap +
   `api.ts` program-vs-on-behalf route mounts). Re-ran FULL gates on the merged
   tree — backend typecheck 8/8 + build + test:unit 19/19; mobile tsc + expo
   lint 0 + repo prettier clean. Pushed; CI green.
3. **#166** (Programs mobile F1+F2 + T-19.3.5) → main (`143f2df`). Merge commit.

- spec-19 Programs is now FULLY SHIPPED end-to-end (see Verified facts).
- Remaining spec-19 non-goals (unchanged, deferred): drag-drop editor reorder,
  recommended-workouts engine, athlete programme library/sharing, bulk-assign,
  per-day-of-week scheduling, photo/PDF programme import (ROADMAP § 5.3), Coach
  Home (Phase 10). Client Detail FULL build is still Phase 5 — this only added
  the programme card + assign CTAs onto the interim screen.
- Worktree `cranky-borg-8a030b` is left on branch `claude/cranky-borg-8a030b`
  (now merged); the remote branch still exists (not deleted — it was the active
  worktree branch). Safe to prune the worktree + branch next session.

**2026-07-06 — Phase 3 (trainer on-behalf endpoints, 10.3) → PR #165 MERGED**
(merge commit `4b2ac07`, remote branch auto-deleted; primary-worktree main
fast-forwarded). Backend-only critical-path slice. All gates green; inspector-brad
local clean @ 3599580; `application/trainers` 100% coverage, core global 98.25%.

- **Endpoints** (all `/trainers/me/clients/:clientId/...`): POST+GET `/sessions`
  (`workout_logged_on_behalf`), GET `/measurements` (parity; POST shipped Phase 2,
  notification backfilled), POST+GET `/goals` (`goal_assigned`) + PUT `/goals/:id`
  (edit-own only, **403 `not_assigner`** if caller ≠ assigner, cross-cuts § 2.2),
  PUT `/nutrition/target` (`nutrition_target_set`, writes `set_by_user_id`),
  POST `/workout-assignments` (`workout_assigned`).
- **Pattern:** every write = `assertTrainerCanActForClient` gate → row +
  `trainer_actions_audit` in ONE `getDb().transaction` → best-effort client
  notification post-commit (never fails the write). GETs = gate then read, no audit.
- **RESOLVES the Phase-4 flag:** `POST /workout-assignments` previously wrote NO
  audit row — re-homed onto the shared `assignClientWorkoutOnBehalf` core
  (assert + audit-in-tx + notify), matching how Phase 2 re-homed measurements.
  Repos gained an optional `tx?` (DbOrTx) on the on-behalf write paths. Handlers
  grouped into `trainersOnBehalfRoutes` sub-app (a flat `.use()` chain of that
  length trips TS2589 — mirrors `nutritionRoutes`).
- **Enum:** migration `20260705150000` adds 4 `notification_type` values
  (standalone ADD VALUE, sequenced before emits) + `notificationTypeEnum`
  (schema.ts) + backend `NotificationType` union + default-prefs map. **Staging
  deploy auto-applies it on merge; PROD is manual (Brad).**
- **Mobile follow-up (Brad go-ahead, commit `1bcb85e`, same PR):** registered the
  4 types in the mobile `NotificationType` union + `NOTIFICATION_TYPES` + labels +
  `CATEGORIES` (all under "Trainer & Physio") + `notificationVisual` icon map.
  Additive; backend+mobile enums extended together so `POST /notifications/preferences`
  validates the new keys. Mobile jest 163 notification tests green.
- **Judgment call (initially deferred, then done):** I first deferred the mobile
  union because specs 06/streak + 13/nutrition both shipped backend producers
  WITHOUT it (forward-compat via `WireNotificationType`), and adding it surfaces
  new preference-screen rows (a mobile UI change → CLAUDE.md wants go-ahead).
  Flagged in the PR + Slack; Brad approved → landed in the same PR.
- **Method:** 1 Explore agent mapped all self-routes/repos; 1 implementer agent
  wrote the 7 templated handler tests; core tests written in main loop. The
  implementer guard ("do it yourself, don't spawn") from the Phase-9 lesson held.

**2026-07-05 — Phase 9 (Programs mobile) → PR #166 open, awaiting Brad.**
Coach Mode Completion mandate, specs/19-programs F1 (coach) + F2 (athlete Home);
backend #148/#149/#152 already merged. Branch `claude/cranky-borg-8a030b`, commit
`10d71e3`; inspector-brad local clean @ 10d71e3; all gates green (backend
test:unit + repo prettier; mobile tsc + jest 3618 + expo lint).

- **F1 coach:** Programmes tab (`(tabs)/programs.tsx` → `ProgramsListContainer`/
  `Presenter`, ProgramsScreenV2 port), editor (`programs/create.tsx` + `[id].tsx`
  → `ProgramEditorContainer`/`Presenter`), root-mounted `AssignProgramSheet`
  (+ `state/assign-program-sheet.ts`).
- **F2 athlete:** shared `ProgrammeCard` composite + Home "Your programme" card +
  due-ordered "Today's training" section.
- **Backend (Brad-approved):** extended `GET /users/me/home` (`homeReadRepository`
  - `getHomeHandler`) with `activeProgramme` + `todaysTraining`. The merged
    backend wired these onto the DEPRECATED `/dashboard`, but V2 Home reads
    `/users/me/home` — chose to extend that (over resurrecting /dashboard) per Brad.
- **Decisions:** coach writes are DIRECT online adapter calls (NOT the sync queue
  — create→assign local-id dependency + existing coach writes are online);
  dropped the prototype's tag/Archive chrome (no backend model — D6).
- **T-19.3.5 Client Detail programme surfaces — DONE 2026-07-06 (extends #166,
  commit `eed4ec6`; Brad go-ahead to build now + extend rather than defer).**
  New backend `GET /trainers/me/clients/:clientId/active-programme` (inline
  active-relationship guard mirroring body-trend; reuses
  `getActiveProgrammeForClient`) + `getClientActiveProgramme` port method.
  `AssignProgramSheet` is now DUAL-MODE (program-anchored `openSheet` from the
  editor / client-anchored `openForClient` from Client Detail → pick a
  programme). New ad-hoc `AssignWorkoutSheet` + `assign-workout-sheet` store
  (STORY-006). Client Detail shows the shared `ProgrammeCard` (tap → editor) or
  Assign-programme/Assign-workout CTAs. Inspector Brad (local): clean @ eed4ec6.
- **Lesson:** a delegated coach-UI implementer MISFIRED (re-delegated instead of
  executing) → built it in the main loop; a spawned child + a 2nd test agent
  RACED on the same test files (resolved cleanly; re-ran gates to confirm). Give
  delegated implementers an explicit "do it yourself, do NOT spawn subagents" guard.

**2026-07-05 — Phase 4 (Client Detail functional spec) → PR #164 MERGED** (merge
commit `decfc12`, branch auto-deleted). See "Next up" item 3 for detail. Method:
3 parallel Explore agents mapped the real backend surface before writing a line
(the brief overclaimed "already live"); inspector-brad local sweep caught 2
citation errors (fixed). No code, no migrations — design PR only. Brad signed off

- two AI-summary refinements landed in the same PR: (1) module-d privacy line =
  totals+adherence, no food log; (2) AI summary = ONE update per client per
  concluded day, lazy + 1 manual refresh, hard cap 2/client/day via
  `UNIQUE(trainer,client,covers_date)` + `refresh_count`, no cron.

---

**2026-07-05 (PM) — COACH MODE COMPLETION mandate, Phases 0–2 MERGED to main.**

> #159, #160, #161 all MERGED (merge-commits c7bcf6e / ec71359 / 13702d1;
> #161 was retargeted main before merging #160 to dodge the stacked-close
> footgun). Branches auto-deleted. Worktree cleanup: removed 4 safe stale
> worktrees; LEFT `optimistic-proskuriakova` (uncommitted changes — likely
> active parallel agent on claude/coach-clients-list) and `determined-perlman`
> (detached HEAD b011406 on no branch/remote — removal would orphan it).

Multi-phase build to take the 10-trainer coach surface from ~40% to launch-
ready. Phase-by-phase, each its own PR, inspector-brad LOCAL sweep before every
PR, Brad ping at each phase boundary. Task ledger tracks all 13 phases.

- **PR #159 — Phase 0 (docs)**: coach-mode spec/design reconciliation. Extracted
  the prototype's inline `CoachHome` (triage screen) verbatim to
  `~/Downloads/handoff/design-source/screens/coach-home.jsx` (NOT in-repo);
  fixed T-10.9.1 (old `coach.jsx:12–48` ref was CoachYouScreen); rewrote
  design.md § Coach Home to the triage layout; **appointments/scheduling domain
  DEFERRED to its own future spec** (Coach Home v1 + Client Detail v1 ship
  without the schedule hero / add-to-calendar); added STORY-015 (invite-code+QR,
  two-sided) over #136 endpoints. IB clean @ dedc5a1.
- **PR #160 — Phase 1 (audit foundation)**: migration `20260705140000` —
  `action_type_enum` + `trainer_actions_audit` (RLS-on, zero policies,
  backend-only via RLS-bypassing pooler — mirrors trainer_invite_codes);
  Drizzle schema; `assertTrainerCanActForClient` (role-first-then-relationship,
  cross-cuts §1.3, discriminated verdict) + `auditTrainerAction` (writes on
  caller's tx, rolls back the action on failure, §1.4.2), both in
  `application/relationships/`. 100% coverage. IB clean @ 03391ae.
- **Phase 2 (R-1) — PR pending this session**: reconciled #136 coach weight-log
  onto canonical `POST /trainers/me/clients/:clientId/measurements` via a shared
  `logClientMeasurementOnBehalf` core (assert gate + measurement+audit in ONE
  tx + streak post-commit); old `/clients/:clientId/measurements` kept as thin
  alias; `MeasurementRepository.create` gained optional `tx`; mobile
  `logClientWeight` repointed. Branch `feat/coach-reconcile-136-measurement`
  (stacked on #160's branch), commit cdd8527. Audit-rollback test included.

**Open Brad decisions (pinged #brad-claude-agents; neither blocks in-flight work):**

- (a) Confirm Coach Home v1 ships with NO schedule hero (appointments deferred).
- (b) Confirm invite-QR approach (pure-JS QR of `persistencemobile://accept-invite?code=`,
  athlete redeem = a PENDING request the coach still accepts — NOT auto-connect).

**Gotchas this session:**

- This checkout needed `bun install` — `@anthropic-ai/bedrock-sdk` (M9.5) was
  declared but not installed → red typecheck until installed.
- ntfy push is BLOCKED by this session's network sandbox (curl denied) — Slack
  log pings still work; no Mac ding. Flagged to Brad in-channel.
- Branches are STACKED (#160 → Phase 2 → …). Do NOT --delete-branch a base that
  a stacked PR still targets. Merge bottom-up or retarget.

**Next up (coach-mode phases, in order):**

1. Finish Phase 2: IB sweep clean → PR (stacked on #160).
2. ~~Phase 3 — on-behalf endpoints (10.3)~~ **MERGED — PR #165 (2026-07-06,
   merge `4b2ac07`).** All endpoints + audit-in-tx + notifications + enum
   migration `20260705150000` + mobile-union registration shipped. See the top
   "Last session" entry. The Phase-4-flagged workout-assignments audit gap is
   RESOLVED. Notifications default opt-in "on" per cross-cuts § 5.
3. ~~Phase 4 — Client Detail FUNCTIONAL spec~~ **MERGED — PR #164 (2026-07-05).**
   Revised `specs/10-trainer-features/{design,requirements}.md`: new "Client Detail
   — functional contract" section, modules a–g grounded on code-verified endpoints;
   fixed the "5-tab" wording → single-scroll; AI Client Summary = LAUNCH scope
   (module g, new `client_ai_summaries` cache table + `AI_COACH_SUMMARY_DAILY_LIMIT`
   ceiling, built Phase 6); scheduling explicitly OUT. **Privacy line ANSWERED by
   Brad: coach sees totals + ±10% adherence, NOT the food log.** IB local clean.
   **Audit surfaced the brief overclaimed** — the aggregate `GET /trainers/me/clients/:clientId`
   - all Phase-3 on-behalf GETs + goals/nutrition-target writes + notes + habit
     coach routes are NOT built (documented as such). ~~**Also flagged: `workout-assignments`
     create/delete handlers write NO audit row**~~ — **RESOLVED in Phase 3 (#165):** the
     create handler was re-homed onto `assignClientWorkoutOnBehalf` (audit-in-tx). The
     Phase-3 on-behalf GETs + goals/nutrition-target writes are now BUILT too; the
     aggregate `GET /trainers/me/clients/:clientId` + notes + habit coach routes remain
     unbuilt. ✅ PR #164 MERGED — Phase 5 unblocked.
4. Phases 5–12: Client Detail build, AI summary build, habit setup + coach
   authorship, invite-QR UI, programs mobile, Coach Home v1, attribution badges,
   notes. See task ledger.

**Non-coach backlog (unchanged, deprioritised under this mandate):** Apple IAP
mobile flow (App Store blocker); EAS dev build → Snap device e2e + M9.5 audit;
debt P0s (/sessions/record idempotency, stuck-failed sync, tablet layout).
