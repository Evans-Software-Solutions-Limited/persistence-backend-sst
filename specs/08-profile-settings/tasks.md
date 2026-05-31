# 08 — Profile & Settings: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks preserved in git history.

---

## Phase 08.1 — ProfileDrawer presenter + container (1 PR)

- [ ] **T-08.1.1** Author `<DrawerSection>` spec-local composite. Implements requirements STORY-002 + 004 + 005 + 006.
- [ ] **T-08.1.2** Author `<ProfileDrawerPresenter>` per `design.md`. Identity block + sections + sign-out row. Implements STORY-001 + 002 + 004 + 005 + 006 + 007.
- [ ] **T-08.1.3** Author `<ProfileDrawerContainer>` wiring all hooks per `design.md § Plumbing`.
- [ ] **T-08.1.4** Verify mount-point integration from `14-navigation` (drawer mounts at `(app)/_layout.tsx`).
- [ ] **T-08.1.5** Unit tests cover every section render, drawer open/close, all row onPress handlers.

## Phase 08.2 — ModeSwitchCard + sign-out confirm (1 PR)

- [ ] **T-08.2.1** Author `<ModeSwitchCardPresenter>` per `design.md`. Implements STORY-003 ACs.
- [ ] **T-08.2.2** Author `<SignOutConfirmDialog>` per `design.md`. Implements STORY-007 ACs 7.1–7.3.
- [ ] **T-08.2.3** Mode-switch flow: tap Switch → close drawer → call `useUserMode().switchTo()`. Tab bar accent + spec swap (handled by 14).
- [ ] **T-08.2.4** Sign-out flow: tap row → confirm modal → call `useSignOut()` → navigate to `(auth)/sign-in`.

## Phase 08.3 — Sub-page shell refreshes (1 PR)

- [ ] **T-08.3.1** `<EditProfilePresenter>` shell refresh — `<HeaderBar>` + form fields with new tokens + `<Btn>` Save. Implements STORY-008 AC 8.1.
- [ ] **T-08.3.2** `<PrivacySettingsPresenter>` shell refresh. AC 8.2 + 8.3.
- [ ] **T-08.3.3** `<HelpCenterPresenter>` shell refresh. AC 8.4.
- [ ] **T-08.3.4** `<ContactSupportPresenter>` shell refresh. AC 8.5.
- [ ] **T-08.3.5** `<TermsOfServicePresenter>` + `<PrivacyPolicyPresenter>` shell refresh. AC 8.6.

## Phase 08.4 — Cleanup + verification

- [ ] **T-08.4.1** Run `01-design-system § Codemod` against new files.
- [ ] **T-08.4.2** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green.
- [ ] **T-08.4.3** 90% coverage on touched files.
- [ ] **T-08.4.4** Manual e2e:
  - Tap avatar from Home → drawer opens with cached profile + subscription + achievements.
  - Trainer user → mode-switch card visible → tap Switch → drawer closes → tab bar shifts violet + COACH dot appears → user lands on Coach Home.
  - Tap each drawer row → assert correct sub-page push.
  - Sign-out: tap → confirm → navigate to sign-in. Local cache cleared.
  - Offline: drawer renders from cache; sign-out disabled with toast.

---

## Acceptance gate (profile drawer phase complete)

- [ ] All 4 phases above shipped as PRs.
- [ ] Drawer is the only profile surface — Profile tab is gone (per 14).
- [ ] Mode-switch end-to-end flow works for trainer users.
- [ ] All sub-pages refreshed with new chrome.
- [ ] No backend changes.
- [ ] Offline rendering verified.

---

_End of `08-profile-settings/tasks.md` · 2026-05-27 (rewritten from scratch)_

---

## Revised 2026-05-31: reconciled task plan

> Pairs with `design.md § Revised 2026-05-31` + `requirements.md § Revised 2026-05-31`. The original 4 phases assumed aspirational hooks + no backend. The deltas below adjust scope; original phases still apply except where superseded. One consolidated PR off `main` (`feat/08-profile-settings`), fix-forward — per the `14-navigation` lesson that stacked per-phase PRs caused rebase churn with the bot reviewer.

### Phase 08.0 — Spec-first commits (land FIRST)

- [ ] **T-08.0.1** `01-design-system` `<BottomSheet>` gains `tall` (88%) height. (design.md + tasks.md T-1.3.12 amended; primitive code + `resolveSnap` + test.)
- [ ] **T-08.0.2** This spec triplet's `Revised 2026-05-31` amendments committed (this file + design.md + requirements.md).

### Phase 08.B — DOB backend slice (STORY-010; backend-first, gated)

- [ ] **T-08.B.1** Migration: `profiles.date_of_birth DATE NULL`.
- [ ] **T-08.B.2** Extend `GET /profile/page` aggregation + `PATCH /profile` body to read/write `dateOfBirth`; surface on the `ProfilePageProfile` wire shape.
- [ ] **T-08.B.3** Mobile domain: add `dateOfBirth: string | null` to `ProfilePageProfile` + `ApiProfile`.
- [ ] **T-08.B.4** `computeAge(dateOfBirth, now?)` pure util in `shared/utils` + `initialsOf(fullName)` util, both unit-tested (leap-year + birthday boundary; null cases).
- [ ] _If the backend slice can't land in the 08 window, ship the drawer with `name · weight` (age omitted) and complete this phase as an immediate follow-up — `profileDetailsSub` handles both states with no drawer change._

### Phase 08.1 delta (presenter + container)

- Build the container against the **real** hooks per `design.md § G` (`useProfilePage`, `useMySubscription`, `useHealthData`, `useAuth().signOut`), NOT the aspirational `useGet*` names.
- Import `<DrawerRow>` from `@/ui/components/composite` (not `foundation`).
- Drawer passes `height="tall"`.
- Add `health` + `notifications` copy keys to `app/(app)/coming-soon.tsx`'s feature map.

### Phase 08.2 delta (mode-switch + sign-out)

- `ModeSwitchCardPresenter` stays pure; container wires `onSwitch → useModeSwitch().switchMode`. Do NOT re-implement close→switch→remap (the hook owns it; T-08.2.3 is satisfied by delegating).
- Sign-out confirm calls `useAuth().signOut` directly (no `useSignOut` mutation hook exists).

### Phase 08.3 delta (sub-page refreshes)

- Only the six shipped routes (`edit`, `privacy`, `privacy-settings`, `help`, `contact`, `terms`) are refreshed — do NOT create `notifications`/`health` sub-routes (owned by 09 / 07).
- `EditProfilePresenter` gains the DOB picker (T-08.B + STORY-010 AC 10.3).
- Apply `insets.top` to each sub-page `<HeaderBar>` (SMOKE_TEST top-inset known-issue); prefer the `01-design-system` `<HeaderBar>` inset amendment if it lands.

### Quality gate (per `14` precedent — sandbox PTY note)

Per-package, not turbo: `npx tsc --noEmit && npx expo lint && npx jest --coverage` (run in `packages/mobile`). 90% coverage on changed files. New persisted state (if any) wires a `reset()` into `useAuth.signOut()` (cross-account bleed precedent). Commit via `git commit -F <file>`. Tab/index navigation uses `/(app)/(tabs)` (not `/index`).

---

_Revised 2026-05-31 — reconciled against shipped `main`; adds DOB backend phase + hook/route corrections._
