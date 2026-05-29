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
