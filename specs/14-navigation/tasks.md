# 14 — Navigation: Tasks

> **New spec, authored 2026-05-27.** Pairs with `requirements.md` + `design.md`.

---

## Phase 14.1 — State primitives (1 PR)

- [ ] **T-14.1.1** Author `packages/mobile/src/state/user-mode.ts` per `design.md § Mode-state slice`. Implements `requirements.md` STORY-003 ACs.
- [ ] **T-14.1.2** Author `packages/mobile/src/state/drawer.ts` per `design.md § Drawer-state slice`. Implements STORY-004 ACs.
- [ ] **T-14.1.3** Author `packages/mobile/src/ui/hooks/useTrainSegment.ts` per `design.md § <TrainHubContainer>`. Implements STORY-005 ACs.
- [ ] **T-14.1.4** Unit tests for each slice + hook (per `design.md § Testing strategy`).

## Phase 14.2 — Subscription eligibility wiring (1 PR)

- [ ] **T-14.2.1** Wire `useGetUserSubscription` → `useUserMode.setEligibility` in `app/_layout.tsx`. Closes STORY-003 AC 3.3 + AC 3.5.
- [ ] **T-14.2.2** Call `useUserMode.rehydrate()` on app launch in `app/_layout.tsx`. Closes STORY-003 AC 3.2.
- [ ] **T-14.2.3** Integration test: force `subQuery.data.isTrainerTier: true → false` while `mode === 'coach'`; assert `mode → 'athlete'` on next foreground.

## Phase 14.3 — Route slots (1 PR)

- [ ] **T-14.3.1** Delete `app/(app)/(tabs)/progress.tsx`, `app/(app)/(tabs)/workouts.tsx`, `app/(app)/(tabs)/exercises.tsx`, `app/(app)/(tabs)/profile.tsx`. (Their content moves elsewhere — see route migration table in `design.md`.)
- [ ] **T-14.3.2** Create `app/(app)/(tabs)/train.tsx` rendering `<TrainHubContainer>`. Implements STORY-005 ACs.
- [ ] **T-14.3.3** Create `app/(app)/(tabs)/fuel.tsx` rendering `<ComingSoon/>`. Implements STORY-006 ACs.
- [ ] **T-14.3.4** Create `app/(app)/(tabs)/you.tsx` rendering `<YouContainer>` (stub until `06-progress-goals` ships content).
- [ ] **T-14.3.5** Create `app/(app)/(tabs)/programs.tsx` rendering `<ComingSoon/>`. Closes STORY-002 AC 2.6 (Programs half).
- [ ] **T-14.3.6** Keep `app/(app)/(tabs)/clients.tsx` rendering `<ComingSoon/>` until M8 — same pattern as Programs.
- [ ] **T-14.3.7** Update `app/(app)/(tabs)/index.tsx` to branch on `useUserMode().mode` — render `<HomeContainer>` (athlete) or `<CoachHomeContainer>` (coach, stub until M8).

## Phase 14.4 — `<TabsLayout>` rewrite (1 PR)

- [ ] **T-14.4.1** Rewrite `app/(app)/(tabs)/_layout.tsx` per `design.md § <TabsLayout>`. Implements STORY-001 + STORY-002 ACs.
- [ ] **T-14.4.2** Pass `mode` to `<TabBar>` from `01-design-system`. Closes STORY-002 AC 2.4.
- [ ] **T-14.4.3** Remove the V2 `TabIcon` helper + the 24×2pt top indicator bar — superseded by the primitive. Closes STORY-001 AC 1.6.
- [ ] **T-14.4.4** Component test renders both athlete + coach tab specs by toggling the mock. Closes STORY-009 AC 9.3.

## Phase 14.5 — Drawer mount + avatar slot (1 PR)

- [ ] **T-14.5.1** Add `<ProfileDrawerContainer>` mount in `app/(app)/_layout.tsx` driven by `useDrawer().open`. Closes STORY-004 AC 4.2 + 4.3. (Container itself is owned by `08-profile-settings`; this task ships the mount-point.)
- [ ] **T-14.5.2** Confirm `<HeaderBar>` from `01-design-system` accepts a `leading` slot for the avatar trigger. Closes STORY-004 AC 4.4. (If the slot doesn't accept ReactNode flexibly enough, escalate as an amendment to `01-design-system`.)
- [ ] **T-14.5.3** Pattern documented in `design.md § Avatar trigger pattern` for downstream specs to consume.

## Phase 14.6 — Mode-switch transition animation (1 PR)

- [ ] **T-14.6.1** Wire the mode-switch handler per `design.md § Mode-switch animation`. Implements STORY-003 AC 3.7.
- [ ] **T-14.6.2** Active-tab pill colour + label colour interpolation via Reanimated 3 `withTiming(200, cubic-bezier(0.2, 0.7, 0.2, 1))` inside `<TabBar>`. (Adds to `01-design-system <TabBar>` primitive — spec amendment to `01` may be needed if the primitive doesn't already expose the animated accent path.)
- [ ] **T-14.6.3** Tab-equivalent mapping on mode switch (`train → clients`, `fuel → programs`, etc.) implemented in the switch handler.
- [ ] **T-14.6.4** Manual e2e test per `design.md § Testing strategy > Mode-switch flow`.

## Phase 14.7 — Deep-link redirect map (1 PR)

- [ ] **T-14.7.1** Add `LEGACY_REDIRECTS` in `app/_layout.tsx` per `design.md § Deep-link redirect map`. Implements STORY-007 ACs.
- [ ] **T-14.7.2** Wire `Linking.addEventListener('url', …)` handler.
- [ ] **T-14.7.3** Integration tests cover each redirect entry. Closes STORY-007 AC 7.1.
- [ ] **T-14.7.4** Add comment block at the top of the redirect map: `// REMOVE: <date + 6 months>` so Phase 5 cleanup catches it.

## Phase 14.8 — Tab bar safe-area + ActiveWorkoutBar coordination (1 PR)

- [ ] **T-14.8.1** `<TabBar>` reads `useSafeAreaInsets().bottom` and applies `paddingBottom: insets.bottom + 8`. Implements STORY-008 AC 8.1.
- [ ] **T-14.8.2** Document tab-bar-height calculation for `<ActiveWorkoutBar>` positioning in `05-active-session` (this task is the contract; positioning implementation lives in 05).
- [ ] **T-14.8.3** Smoke test on iPhone 8 simulator (no home indicator) + iPhone 14 simulator (with) confirms tab bar floats correctly on both.

## Phase 14.9 — Cleanup + verification

- [ ] **T-14.9.1** Run the codemod from `01-design-system § Codemod` against the new layout file to ensure no hex literals leaked in. Closes contribution to `01-design-system` STORY-006.
- [ ] **T-14.9.2** Run `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green.
- [ ] **T-14.9.3** 90% coverage on `packages/mobile/src/state/{user-mode,drawer}.ts` + `packages/mobile/src/ui/hooks/useTrainSegment.ts`.
- [ ] **T-14.9.4** Manual smoke: launch app → land on Home (athlete) → tap avatar → drawer opens → close drawer → navigate Home → Train → Fuel (ComingSoon) → You; trainer user can then open drawer → switch to coach → see Home / Clients (ComingSoon) / Programs (ComingSoon) / You.

---

## Acceptance gate (navigation phase complete)

- [ ] All 9 phases above ship as PRs in dependency order (14.1 + 14.2 land first, then 14.3-14.8 can fan out, 14.9 verifies).
- [ ] `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` all green.
- [ ] 90% coverage on touched files.
- [ ] Manual e2e: athlete and trainer users can both navigate the app end-to-end. Trainer can switch modes from the drawer. Deep links from old paths land on the correct new tabs.
- [ ] No regression in active-workout overlay positioning (gated on `05-active-session` having been amended to use the new tab-bar-height contract from T-14.8.2).

---

_End of `14-navigation/tasks.md` · 2026-05-27_
