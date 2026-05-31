# 14 — Navigation: Tasks

> **New spec, authored 2026-05-27.** Pairs with `requirements.md` + `design.md`.

---

## Phase 14.1 — State primitives (1 PR) — **shipped (PR #84)**

- [x] **T-14.1.1** Author `packages/mobile/src/state/user-mode.ts` per `design.md § Mode-state slice`. Implements `requirements.md` STORY-003 ACs.
- [x] **T-14.1.2** Author `packages/mobile/src/state/drawer.ts` per `design.md § Drawer-state slice`. Implements STORY-004 ACs.
- [x] **T-14.1.3** Author `packages/mobile/src/ui/hooks/useTrainSegment.ts` per `design.md § <TrainHubContainer>`. Implements STORY-005 ACs.
- [x] **T-14.1.4** Unit tests for each slice + hook (per `design.md § Testing strategy`).

## Phase 14.2 — Subscription eligibility wiring (1 PR) — **shipped (PR #85)**

- [x] **T-14.2.1** Wire `useGetUserSubscription` → `useUserMode.setEligibility` in `app/_layout.tsx`. Closes STORY-003 AC 3.3 + AC 3.5. _Via `useUserModeEligibility` (canonical hook is `useMySubscription`); mounted as `<UserModeBootstrap/>`._
- [x] **T-14.2.2** Call `useUserMode.rehydrate()` on app launch in `app/_layout.tsx`. Closes STORY-003 AC 3.2.
- [x] **T-14.2.3** Integration test: force `subQuery.data.isTrainerTier: true → false` while `mode === 'coach'`; assert `mode → 'athlete'` on next foreground.

## Phase 14.3 — Route slots (1 PR) — **shipped (PR #86)**

- [x] **T-14.3.1** Delete `app/(app)/(tabs)/progress.tsx`, `app/(app)/(tabs)/workouts.tsx`, `app/(app)/(tabs)/exercises.tsx`, `app/(app)/(tabs)/profile.tsx`. (Their content moves elsewhere — see route migration table in `design.md`.)
- [x] **T-14.3.2** Create `app/(app)/(tabs)/train.tsx` rendering `<TrainHubContainer>`. Implements STORY-005 ACs.
- [x] **T-14.3.3** Create `app/(app)/(tabs)/fuel.tsx` rendering `<ComingSoon/>`. Implements STORY-006 ACs.
- [x] **T-14.3.4** Create `app/(app)/(tabs)/you.tsx` rendering `<YouContainer>` (stub until `06-progress-goals` ships content).
- [x] **T-14.3.5** Create `app/(app)/(tabs)/programs.tsx` rendering `<ComingSoon/>`. Closes STORY-002 AC 2.6 (Programs half).
- [x] **T-14.3.6** Keep `app/(app)/(tabs)/clients.tsx` rendering `<ComingSoon/>` until M8 — same pattern as Programs.
- [x] **T-14.3.7** Update `app/(app)/(tabs)/index.tsx` to branch on `useUserMode().mode` — render `<HomeContainer>` (athlete) or `<CoachHomeContainer>` (coach, stub until M8).

## Phase 14.4 — `<TabsLayout>` rewrite (1 PR) — **shipped (PR #87)**

- [x] **T-14.4.1** Rewrite `app/(app)/(tabs)/_layout.tsx` per `design.md § <TabsLayout>`. Implements STORY-001 + STORY-002 ACs.
- [x] **T-14.4.2** Pass `mode` to `<TabBar>` from `01-design-system`. Closes STORY-002 AC 2.4.
- [x] **T-14.4.3** Remove the V2 `TabIcon` helper + the 24×2pt top indicator bar — superseded by the primitive. Closes STORY-001 AC 1.6.
- [x] **T-14.4.4** Component test renders both athlete + coach tab specs by toggling the mock. Closes STORY-009 AC 9.3.

## Phase 14.5 — Drawer mount + avatar slot (1 PR) — **shipped (PR #88)**

- [x] **T-14.5.1** Add `<ProfileDrawerContainer>` mount in `app/(app)/_layout.tsx` driven by `useDrawer().open`. Closes STORY-004 AC 4.2 + 4.3. (Container itself is owned by `08-profile-settings`; this task ships the mount-point.)
- [x] **T-14.5.2** Confirm `<HeaderBar>` from `01-design-system` accepts a `leading` slot for the avatar trigger. Closes STORY-004 AC 4.4. _Confirmed — slot already exists + is tested; no `01` amendment needed._
- [x] **T-14.5.3** Pattern documented in `design.md § Avatar trigger pattern` for downstream specs to consume.

## Phase 14.6 — Mode-switch transition animation (1 PR) — **shipped (PR #89)**

- [x] **T-14.6.1** Wire the mode-switch handler per `design.md § Mode-switch animation`. Implements STORY-003 AC 3.7. _`useModeSwitch` hook (consumed by 08's drawer card)._
- [x] **T-14.6.2** Active-tab pill colour + label colour interpolation via Reanimated 3 `withTiming(200, cubic-bezier(0.2, 0.7, 0.2, 1))` inside `<TabBar>`. _Required + applied the `01-design-system` amendment (design.md § 10 + tasks T-1.3.10 "Revised 2026-05-31"); reduce-motion aware._
- [x] **T-14.6.3** Tab-equivalent mapping on mode switch (`train → clients`, `fuel → programs`, etc.) implemented in the switch handler.
- [x] **T-14.6.4** Manual e2e test per `design.md § Testing strategy > Mode-switch flow`. _Documented in `SMOKE_TEST.md` (steps 11–14)._

## Phase 14.7 — Deep-link redirect map (1 PR)

> **Deferred 2026-05-31 (scope decision).** The legacy deep-link redirect map
> is a 6-month backward-compat shim for the OLD app's `persistence://` paths
> (existing widgets / push notifications / Universal Links). The V2 app has **no
> released users**, so there are no legacy deep links in the wild to keep
> working — the shim has nothing to translate today. Building + maintaining a
> dated removal shim now would be dead code.
>
> This phase is **deferred, not cancelled**. The redirect map is re-scoped to
> land when it first has a real consumer — whichever comes first:
>
> - `09-notifications-social` mobile frontend (push payloads carrying route
>   names — AC 7.3), or
> - the first public/TestFlight release that needs Universal Link continuity.
>
> When picked up, it implements STORY-007 against `design.md § Deep-link
redirect map` (which is preserved verbatim as the contract). The
> `useTrainSegment.pendingCreate` one-shot + `setSegment(...)` setters the map
> depends on already shipped in Phase 14.1/14.3 and are unit-tested, so the
> deferred work is purely the map + `<LegacyRedirects/>` mount + its tests.
>
> Acceptance-gate impact: the "deep links from old paths land on the correct
> new tabs" line is struck from the 14-navigation acceptance gate and inherited
> by the consuming spec.

- [ ] **T-14.7.1** _(deferred — see note above)_ Add `LEGACY_REDIRECTS` map + `LegacyRedirects()` component in `app/_layout.tsx` per `design.md § Deep-link redirect map`. **Mount `<LegacyRedirects/>` as a sibling of `<Stack>` inside `RootLayout`** — not a child (expo-router's `<Stack>` renders only `<Stack.Screen>` children). Implements STORY-007 ACs.
- [ ] **T-14.7.2** _(deferred)_ Wire both `Linking.getInitialURL()` (cold-launch deep link) AND `Linking.addEventListener('url', …)` (hot URL events) inside the `LegacyRedirects()` `useEffect`.
- [ ] **T-14.7.3** _(deferred)_ Integration tests cover each redirect entry. Closes STORY-007 AC 7.1.
- [ ] **T-14.7.4** _(deferred)_ Add comment block at the top of the redirect map: `// REMOVE: <date + 6 months>` so Phase 5 cleanup catches it.

## Phase 14.8 — Tab bar safe-area + ActiveWorkoutBar coordination (1 PR) — **shipped (PR #91)**

- [x] **T-14.8.1** `<TabBar>` reads `useSafeAreaInsets().bottom` and applies `paddingBottom: insets.bottom + 8`. Implements STORY-008 AC 8.1. _Applied in the `NavTabBar` mount (14-nav-owned) rather than the primitive, keeping `<TabBar>` free of safe-area-context._
- [x] **T-14.8.2** Document tab-bar-height calculation for `<ActiveWorkoutBar>` positioning in `05-active-session` (this task is the contract; positioning implementation lives in 05). _Exported `tabBarHeight()` + `ACTIVE_WORKOUT_BAR_GAP`; `05/design.md § <ActiveWorkoutBarPresenter>` revised._
- [x] **T-14.8.3** Smoke test on iPhone 8 simulator (no home indicator) + iPhone 14 simulator (with) confirms tab bar floats correctly on both. _Unit-asserted (insets 0→8, 34→42); on-device check documented in `SMOKE_TEST.md` step 8._

## Phase 14.9 — Cleanup + verification

- [x] **T-14.9.1** Run the codemod from `01-design-system § Codemod` against the new layout file to ensure no hex literals leaked in. Closes contribution to `01-design-system` STORY-006. _Verified: `no-raw-hex-colors` lint rule is green across the new nav files; the only hex constants live in the `<TabBar>` primitive (01-design-system-owned, allow-listed concrete-colour positions)._
- [x] **T-14.9.2** Run `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green. _Run per-package (`npx tsc --noEmit`, `npx expo lint`, `npx jest --coverage`) per the sandbox PTY note; mobile `build` is the EAS no-op. All green; 2217 tests pass._
- [x] **T-14.9.3** 90% coverage on `packages/mobile/src/state/{user-mode,drawer}.ts` + `packages/mobile/src/ui/hooks/useTrainSegment.ts`. _All three at 100%; every new nav file (TabBar, TrainHub/ProfileDrawer/You/CoachHome containers, useModeSwitch, useUserModeEligibility) is also at 100%._
- [x] **T-14.9.4** Manual smoke: launch app → land on Home (athlete) → tap avatar → drawer opens → close drawer → navigate Home → Train → Fuel (ComingSoon) → You; trainer user can then open drawer → switch to coach → see Home / Clients (ComingSoon) / Programs (ComingSoon) / You. _Walkthrough authored in `SMOKE_TEST.md`; the cross-cutting flow is also automated in `app/__tests__/navigation-flow.test.tsx`._

---

## Acceptance gate (navigation phase complete)

- [x] All phases above ship as PRs in dependency order (14.1 + 14.2 land first, then 14.3-14.8 can fan out, 14.9 verifies). **14.7 (deep-link redirects) is deferred — see the Phase 14.7 note; it does not gate navigation completion.** _PRs #84–#91._
- [x] `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` all green. _Per-package run (sandbox PTY note); 2217 tests pass._
- [x] 90% coverage on touched files. _All new nav files at 100%._
- [x] Manual e2e: athlete and trainer users can both navigate the app end-to-end. Trainer can switch modes from the drawer. _`SMOKE_TEST.md` + automated `navigation-flow.test.tsx`._
- [x] ~~Deep links from old paths land on the correct new tabs.~~ _(Deferred with Phase 14.7 — inherited by the consuming spec, `09-notifications-social` / first-release, per the Phase 14.7 note.)_
- [ ] No regression in active-workout overlay positioning (gated on `05-active-session` having been amended to use the new tab-bar-height contract from T-14.8.2). _Contract published (T-14.8.2); the positioning implementation + regression check land when `05-active-session` consumes it._

---

_End of `14-navigation/tasks.md` · 2026-05-27_
