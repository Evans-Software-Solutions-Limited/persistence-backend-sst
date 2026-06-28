# 08 — Profile & Settings: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks preserved in git history.

---

## Phase 08.1 — ProfileDrawer presenter + container (1 PR)

- [x] **T-08.1.1** Author `<DrawerSection>` spec-local composite. Implements requirements STORY-002 + 004 + 005 + 006.
- [x] **T-08.1.2** Author `<ProfileDrawerPresenter>` per `design.md`. Identity block + sections + sign-out row. Implements STORY-001 + 002 + 004 + 005 + 006 + 007.
- [x] **T-08.1.3** Author `<ProfileDrawerContainer>` wiring all hooks per `design.md § Plumbing` (real hooks per § Revised 2026-05-31 § G).
- [x] **T-08.1.4** Verify mount-point integration from `14-navigation` (drawer mounts at `(app)/_layout.tsx`).
- [x] **T-08.1.5** Unit tests cover every section render, drawer open/close, all row onPress handlers.

## Phase 08.2 — ModeSwitchCard + sign-out confirm (1 PR)

- [x] **T-08.2.1** Author `<ModeSwitchCardPresenter>` per `design.md`. Implements STORY-003 ACs.
- [x] **T-08.2.2** Author `<SignOutConfirmDialog>` per `design.md`. Implements STORY-007 ACs 7.1–7.3.
- [x] **T-08.2.3** Mode-switch flow: tap Switch → close drawer → call `switchTo()`. _Delegated to the shipped `useModeSwitch().switchMode` (14) which owns close→switch→tab-remap._
- [x] **T-08.2.4** Sign-out flow: tap row → confirm modal → call `useAuth().signOut()` → navigate to `(auth)/sign-in` (handled inside signOut + AuthGate).

## Phase 08.3 — Sub-page shell refreshes (1 PR)

- [x] **T-08.3.1** `<EditProfilePresenter>` shell refresh — `<HeaderBar>` + form fields with new tokens + `<Btn>` Save (+ DOB field). Implements STORY-008 AC 8.1.
- [x] **T-08.3.2** `<PrivacySettingsPresenter>` shell refresh. AC 8.2 + 8.3.
- [x] **T-08.3.3** `<HelpCenterPresenter>` shell refresh. AC 8.4.
- [x] **T-08.3.4** `<ContactSupportPresenter>` shell refresh. AC 8.5.
- [x] **T-08.3.5** `<TermsOfServicePresenter>` + `<PrivacyPolicyPresenter>` shell refresh. AC 8.6.

## Phase 08.4 — Cleanup + verification

- [x] **T-08.4.1** ~~Run `01-design-system § Codemod` against new files.~~ _N/A — new files were authored against tokens from the start; the codemod retrofits legacy hex, of which the new files have none in token-resolvable positions._
- [x] **T-08.4.2** `npx tsc --noEmit`, `npx expo lint`, `npx jest --coverage` — all green (mobile build is the EAS no-op). Core `vitest` green.
- [x] **T-08.4.3** Coverage: global threshold met (changed-file set ~91% branch, 96%+ stmts/lines/funcs).
- [x] **T-08.4.4** Manual e2e: _Completed by owner on-device review (2026-06-01). PR #94 merged._

---

## Acceptance gate (profile drawer phase complete)

- [x] All 4 phases above shipped (one consolidated PR per the owner's single-PR request).
- [x] Drawer is the only profile surface — Profile tab is gone (per 14).
- [x] Mode-switch end-to-end flow works for trainer users (drawer card → `useModeSwitch`).
- [x] All sub-pages refreshed with new chrome.
- [x] ~~No backend changes.~~ _Superseded: STORY-010 DOB read-path slice added per owner decision (2026-05-31) — see requirements § Revised._
- [x] Offline rendering verified (drawer reads cached hooks; loading state covered).

---

_End of `08-profile-settings/tasks.md` · 2026-05-27 (rewritten from scratch)_

---

## Revised 2026-05-31: reconciled task plan

> Pairs with `design.md § Revised 2026-05-31` + `requirements.md § Revised 2026-05-31`. The original 4 phases assumed aspirational hooks + no backend. The deltas below adjust scope; original phases still apply except where superseded. One consolidated PR off `main` (`feat/08-profile-settings`), fix-forward — per the `14-navigation` lesson that stacked per-phase PRs caused rebase churn with the bot reviewer.

### Phase 08.0 — Spec-first commits (land FIRST)

- [x] **T-08.0.1** `01-design-system` `<BottomSheet>` gains `tall` (88%) height. (design.md + tasks.md T-1.3.12 amended; primitive code + `resolveSnap` + test.) _Shipped — `BottomSheet.tsx` + test._
- [x] **T-08.0.2** This spec triplet's `Revised 2026-05-31` amendments committed (this file + design.md + requirements.md). _Shipped._

### Phase 08.B — DOB backend slice (STORY-010; backend-first, gated)

- [x] **T-08.B.1** ~~Migration: `profiles.date_of_birth DATE NULL`.~~ _No-op — the column already exists (`supabase/migrations/001_initial_schema.sql` + `packages/db/src/schema.ts`), and `PATCH /profile` already accepted `dateOfBirth`. Only the read path + utils were missing._
- [x] **T-08.B.2** Extend `GET /profile/page` aggregation + `PATCH /profile` body to read/write `dateOfBirth`; surface on the `ProfilePageProfile` wire shape. _Shipped — `ProfilePageProfileSlice` + `getProfileSlice` select/return; PATCH path already present._
- [x] **T-08.B.3** Mobile domain: add `dateOfBirth: string | null` to `ProfilePageProfile` + `ApiProfile`. _Shipped._
- [x] **T-08.B.4** `computeAge(dateOfBirth, now?)` pure util in `shared/utils` + `initialsOf(fullName)` util, both unit-tested (leap-year + birthday boundary; null cases). _Shipped — `shared/utils/age.ts` + `initials.ts` + tests._

### Phase 08.1 delta (presenter + container) — shipped

- Build the container against the **real** hooks per `design.md § G` (`useProfilePage`, `useMySubscription`, `useHealthData`, `useAuth().signOut`), NOT the aspirational `useGet*` names.
- Import `<DrawerRow>` from `@/ui/components/composite` (not `foundation`).
- Drawer passes `height="tall"`.
- Add `health` + `notifications` copy keys to `app/(app)/coming-soon.tsx`'s feature map.

### Phase 08.2 delta (mode-switch + sign-out) — shipped

- `ModeSwitchCardPresenter` stays pure; container wires `onSwitch → useModeSwitch().switchMode`. Do NOT re-implement close→switch→remap (the hook owns it; T-08.2.3 is satisfied by delegating).
- Sign-out confirm calls `useAuth().signOut` directly (no `useSignOut` mutation hook exists). _Note: `useAuth.signOut` already resets the device-global `useUserMode` + `useTrainSegment` slices; 08 introduces no new persisted slice, so no extra reset wiring was needed._

### Phase 08.3 delta (sub-page refreshes) — shipped

- Only the six shipped routes (`edit`, `privacy`, `privacy-settings`, `help`, `contact`, `terms`) are refreshed — do NOT create `notifications`/`health` sub-routes (owned by 09 / 07).
- `EditProfilePresenter` gains the DOB field (T-08.B + STORY-010 AC 10.3). _Shipped as a `YYYY-MM-DD` `<TextInput>` (no date-picker dep in the package); container diffs-on-save, empty clears to null._
- Apply `insets.top` to each sub-page (SMOKE_TEST top-inset known-issue); the `01-design-system` `<HeaderBar>` inset amendment remains a future option.

### Phase 08.4 — verification — shipped

- `tsc --noEmit` + `expo lint` (0 errors) + `jest --coverage` (global threshold met, 2286 mobile tests) all green. Core `vitest` 343 profile tests green.

### Quality gate (per `14` precedent — sandbox PTY note)

Per-package, not turbo: `npx tsc --noEmit && npx expo lint && npx jest --coverage` (run in `packages/mobile`). 90% coverage on changed files. New persisted state (if any) wires a `reset()` into `useAuth.signOut()` (cross-account bleed precedent). Commit via `git commit -F <file>`. Tab/index navigation uses `/(app)/(tabs)` (not `/index`).

---

_Revised 2026-05-31 — reconciled against shipped `main`; adds DOB backend phase + hook/route corrections._

---

## Revised 2026-06-28: Phase 08.C — in-app account deletion (STORY-011)

> Pairs with `design.md` + `requirements.md` § Revised 2026-06-28. One PR off `main` (`feat/account-deletion`). App Store hard blocker #1.

### Phase 08.C.0 — spec-first (land FIRST)

- [x] **T-08.C.0** This triplet's `Revised 2026-06-28` addendums (requirements STORY-011 + design § Account deletion + this phase).

### Phase 08.C.1 — backend infra + secret

- [ ] **T-08.C.1** `infra/secrets.ts`: add `SupabaseServiceRoleKey` secret. `infra/api.ts`: wire `SUPABASE_SERVICE_ROLE_KEY` into the core API route env. (Implements requirements 11.4/11.7 dependency.)

### Phase 08.C.2 — backend deletion logic + endpoint

- [ ] **T-08.C.2.1** `account/accountDeletionPlan.ts` — `ACCOUNT_DELETION_STEPS` (data-driven FK plan per design § Deletion order) + `buildStatement`. (11.4/11.5)
- [ ] **T-08.C.2.2** `account/accountRepository.ts` — `purgeUserData(userId)` runs the plan in one `db.transaction`. (11.6)
- [ ] **T-08.C.2.3** `account/supabaseAdminClient.ts` — `getSupabaseAdminConfig()` (fail-fast) + `deleteAuthUser(userId)` Admin REST (404 == ok). (11.4/11.7)
- [ ] **T-08.C.2.4** `account/delete/accountDeleteHandler.ts` — `DELETE /account`; register in `api.ts`. (11.4/11.6/11.7)
- [ ] **T-08.C.2.5** Backend unit tests: plan, repository, handler (configured/unconfigured/404/5xx/401). 90% on changed files.

### Phase 08.C.3 — mobile port + adapter

- [ ] **T-08.C.3.1** `ApiPort.deleteAccount()` + `sst-api.adapter` (`DELETE /account`) + in-memory adapter. (11.4)
- [ ] **T-08.C.3.2** `useAuth().deleteAccount()` — backend call + shared `tearDownLocalSession()` reuse; failure leaves session intact. (11.3/11.8)

### Phase 08.C.4 — mobile UI (Privacy Settings)

- [ ] **T-08.C.4.1** `PrivacySettingsPresenter` — destructive "Delete Account" section + remove stale "contacting support … deletion" copy. (11.1)
- [ ] **T-08.C.4.2** `PrivacySettingsContainer` — `onDeleteAccount` double-confirm `Alert` → `deleteAccount()`; failure → retry Alert. (11.2/11.3/11.8)
- [ ] **T-08.C.4.3** Mobile tests: presenter (row present), container (confirm/cancel/failure), `useAuth().deleteAccount`. 90% on changed files.

### Phase 08.C.5 — gates + verify

- [ ] **T-08.C.5** Root gates (`prettier:check`, `typecheck`, `lint`, `build`, `test:unit`) + `@persistence/web test:unit` green. Device-verify steps handed to owner.

_Revised 2026-06-28 — Phase 08.C account deletion._
