# 14 — Navigation: Requirements

> **New spec, authored 2026-05-27** as part of the May 2026 design-package port. Owns the navigation tree, the `useUserMode` runtime slice, and the integration of `<TabBar>` + `<ProfileDrawer>` mount-points. Composition of the drawer's content + the per-screen content lives in their owning specs (`08-profile-settings`, `04-workout-management`, `06-progress-goals`, etc.).

---

## Overview

Restructure the app's navigation tree to the prototype's **Option 3 — 4-tab consolidated hubs** with runtime mode-switching between athlete and coach. Replace the current static 6-tab layout (Home / Progress / Workouts / Exercises / Clients¹ / Profile) with a mode-aware 4-tab tree:

| Mode    | Tabs                                                        |
| ------- | ----------------------------------------------------------- |
| Athlete | Home · Train (segmented Workouts \| Exercises) · Fuel · You |
| Coach   | Home · Clients · Programs · You                             |

¹ The current V2 `Clients` tab uses `href: null` to hide for non-trainer-tier users while keeping the route registered. Under the new design, subscription tier gates ELIGIBILITY to switch into coach mode; runtime mode-state gates VISIBILITY of the Clients/Programs tabs.

Profile leaves the tab bar entirely and becomes a bottom-sheet drawer mounted at the `(app)` layout level, opened by tapping the user avatar from any screen header. The drawer holds the mode-switch card. Composition of the drawer is owned by `08-profile-settings`; mount-point + open-state management lives here.

Authoritative references:

1. `~/Downloads/handoff/design-source/prototype-hubs.jsx` line 1 — _"Persistence — Interactive Prototype root (Option 3: 4-tab consolidated hubs)"_
2. `~/Downloads/handoff/design-source/tab-bar.jsx` — `TabBar` visual contract + `TAB_SPECS` enumerations
3. `~/Downloads/handoff/design-source/phone.jsx` lines 79–90 — `option3_athlete` + `option3_coach` tab specs
4. `~/Downloads/handoff/design-source/screens/extra.jsx` lines 7–108 — `ProfileDrawer` (drawer that mounts at root, opened by avatar tap)
5. `~/Downloads/handoff/CLAUDE_CODE_MIGRATION_PLAN.md` § "Active workout specifically — minimize/restore pattern" — same root-mount + Zustand-slice pattern reused for the drawer
6. `docs/design-port-audit.md` § "Navigation — confirmed from the prototype (Option 3)"

The prototype is gospel for visual + IA decisions. `01-design-system`'s `<TabBar>` primitive supplies the rendered tab bar; this spec composes the navigation tree around it.

---

## Locked decisions

| #   | Decision                | Locked value                                                                                                                                                                                                                   |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Tab spec (athlete mode) | `Home · Train · Fuel · You`                                                                                                                                                                                                    |
| 2   | Tab spec (coach mode)   | `Home · Clients · Programs · You`                                                                                                                                                                                              |
| 3   | Tab label naming        | `Train` (replaces `Workouts`) + `You` (replaces `Progress` + absorbs `Profile`) — per requirements.md STORY-001 of `01-design-system` locked decision #3                                                                       |
| 4   | Fuel placeholder        | Render `<ComingSoon/>` from the moment the tab restructure lands; M9 (`13-nutrition-tracking`) replaces the placeholder when its frontend ships                                                                                |
| 5   | Profile location        | Bottom-sheet drawer mounted at `(app)/_layout.tsx`. Avatar in every screen header opens it. **No Profile tab** in either mode.                                                                                                 |
| 6   | Mode-state primitive    | `useUserMode` Zustand slice at `packages/mobile/src/state/user-mode.ts` with AsyncStorage rehydration                                                                                                                          |
| 7   | Mode-eligibility source | `useGetUserSubscription` → `isTrainerTier` boolean (existing V2 hook). Trainer tier ⇒ `isTrainerEligible: true`. If subscription drops out of trainer tier while in coach mode, force fall-back to athlete mode on next mount. |
| 8   | Tab bar accent          | `$primary` (athlete) / `$accentTrainer` (coach) — driven by `useUserMode().mode`                                                                                                                                               |
| 9   | COACH chrome dot        | Visible above the tab bar centre when `mode === 'coach'`, hidden otherwise (uses the `mode` prop on `<TabBar>` from `01-design-system`)                                                                                        |
| 10  | Deep-link redirect      | `persistence://workouts` → `/(app)/(tabs)/train?segment=workouts` redirect preserved for 6 months per migration plan §"Phase 5 — Polish, a11y, cleanup"                                                                        |

---

## User stories

### STORY-001: As an athlete user, I want a 4-tab bottom navigation with Home / Train / Fuel / You so the navigation matches the prototype IA

**Acceptance Criteria:**

- 1.1 [ ] `packages/mobile/app/(app)/(tabs)/_layout.tsx` exposes exactly four `<Tabs.Screen>` entries when `useUserMode().mode === 'athlete'`: `index` (Home), `train`, `fuel`, `you`.
- 1.2 [ ] The legacy 6-tab layout — `progress`, `workouts`, `exercises`, `clients`, `profile` — is removed. `progress` folds into `you` (see `06-progress-goals`), `workouts` + `exercises` fold into `train`, `clients` moves to coach-mode only, `profile` becomes the drawer.
- 1.3 [ ] Each tab renders a Lucide icon from `~/ui/components/icons` (per `01-design-system` STORY-008): `IconHome`, `IconDumbbell`, `IconApple`, `IconChart` for athlete mode.
- 1.4 [ ] Tab labels are `Home`, `Train`, `Fuel`, `You` — using the prototype names per locked decision #3.
- 1.5 [ ] Tab bar uses the `<TabBar>` foundation primitive (from `01-design-system`) with `mode="athlete"`. Static `Tabs.Screen` config in Expo Router supplies the route registration; the visual rendering is the new primitive.
- 1.6 [ ] Active-tab visual is the `<TabBar>` primitive's pill + accent glow — not the existing 24×2pt top indicator bar in V2. The V2 `TabIcon` helper is removed.

### STORY-002: As a coach-tier user in coach mode, I want a 4-tab navigation with Home / Clients / Programs / You so I can manage my clients without athlete-mode clutter

**Acceptance Criteria:**

- 2.1 [ ] When `useUserMode().mode === 'coach'`, the four `<Tabs.Screen>` entries are: `index` (Coach Home — see `10-trainer-features`), `clients`, `programs`, `you`.
- 2.2 [ ] Each coach-mode tab renders Lucide icons: `IconHome`, `IconUsers`, `IconLayers`, `IconChart`.
- 2.3 [ ] The Clients tab shows a numeric badge for `attentionCount` (clients needing attention) when `attentionCount > 0`. Badge data source: existing `useTrainerClients` hook (M8 — `10-trainer-features`). Until M8 ships, the badge defaults to `undefined` and isn't rendered.
- 2.4 [ ] Tab bar accent shifts to `$accentTrainer` and the COACH chrome dot floats above the centre — both driven by passing `mode="coach"` to `<TabBar>`.
- 2.5 [ ] Fuel tab is NOT visible in coach mode (per prototype `option3_coach` in `phone.jsx:85`).
- 2.6 [ ] Routes `(app)/(tabs)/clients` and `(app)/(tabs)/programs` are registered and resolve. Until M8 ships the Coach Home, Clients screen, and Programs screen, their tab targets render `<ComingSoon/>`.

### STORY-003: As a coach-tier user, I want to toggle between athlete and coach mode from the profile drawer so I can experience the app as my clients do without losing access to coach tools

**Acceptance Criteria:**

- 3.1 [ ] `useUserMode` Zustand slice exposes `{ mode: 'athlete' | 'coach', isTrainerEligible: boolean, switchTo(next): void, rehydrate(): Promise<void> }`.
- 3.2 [ ] Slice rehydrates from AsyncStorage key `persistence.userMode` on app launch. If key is missing or invalid, default to `mode: 'athlete'`.
- 3.3 [ ] `isTrainerEligible` is a derived value from `useGetUserSubscription().data?.isTrainerTier`. When `isTrainerEligible === false`, `switchTo('coach')` is a no-op + logs a warning.
- 3.4 [ ] `switchTo('coach' | 'athlete')` writes the new value to AsyncStorage and triggers a re-render of `<TabsLayout>`, which re-reads `mode` and swaps the tab spec.
- 3.5 [ ] When the subscription cache transitions from `isTrainerTier === true` to `false` while `mode === 'coach'` (e.g. subscription downgrade), the slice forces `mode → 'athlete'` on the next app foreground.
- 3.6 [ ] The mode-switch UI (the card inside `<ProfileDrawer>`) lives in `08-profile-settings`. This spec ships only the slice + the tab layout that reacts to it.
- 3.7 [ ] Tab restructure happens atomically: the user taps "Switch to Coach" → drawer closes → tab bar accent fades cyan → violet (200ms `withTiming`) → tab spec swaps → user lands on Coach Home. No flash of the wrong tabs.

### STORY-004: As any user, I want my profile drawer accessible from any screen by tapping my avatar so I can switch modes / manage account without losing my place

**Acceptance Criteria:**

- 4.1 [ ] `useDrawer` Zustand slice at `packages/mobile/src/state/drawer.ts` exposes `{ open: boolean, openDrawer(): void, closeDrawer(): void }`.
- 4.2 [ ] `<ProfileDrawer>` is mounted at `packages/mobile/app/(app)/_layout.tsx` (one level above the `(tabs)` group) so it can overlay the tab tree.
- 4.3 [ ] When `useDrawer().open === true`, the drawer renders over the active tab content with a backdrop blur per `extra.jsx:11` (`rgba(0,0,0,0.55)` + `backdropFilter: blur(6px)`). Backdrop tap closes the drawer.
- 4.4 [ ] Every screen header that uses `<HeaderBar>` from `01-design-system` accepts a `leading={<Avatar onPress={openDrawer}/>}` slot. The avatar opens the drawer. Per-screen avatar wiring lives in each screen's owning spec; this spec ensures the slot + the open hook are available.
- 4.5 [ ] Drawer open state is NOT persisted across app launches — relaunching the app always starts with the drawer closed.

### STORY-005: As a user, I want the Train hub to consolidate the Workouts list and Exercises library under one tab with a two-segment switcher so the IA matches the prototype

**Acceptance Criteria:**

- 5.1 [ ] Route `(app)/(tabs)/train.tsx` renders a `<TrainHubContainer>` that wraps a `<Segmented>` (from `01-design-system`) with options `['Workouts', 'Exercises']`.
- 5.2 [ ] The active segment is persisted to AsyncStorage key `persistence.train.segment` so users land on whichever they used last. Default: `'Workouts'`.
- 5.3 [ ] When `segment === 'Workouts'`, the hub renders the workouts list (composition owned by `04-workout-management`). When `segment === 'Exercises'`, the hub renders the exercises list (also owned by `04-workout-management`).
- 5.4 [ ] Top-right contextual action: `<IconSearch>` IconBtn for Workouts, `<IconPlus>` "Create" Btn for Exercises (per `prototype-hubs.jsx:20–32`). The handler for each is provided by the owning content.
- 5.5 [ ] Eyebrow above the segmented control: `TRAIN` (uppercase, `$text3`). Per `prototype-hubs.jsx:17`.
- 5.6 [ ] Page title shifts with segment: `Workouts` when `segment === 'Workouts'`, `Exercises` when `segment === 'Exercises'`. Per `prototype-hubs.jsx:18`.

### STORY-006: As a user, I want a Fuel tab placeholder from the moment the navigation restructures so the IA is stable through M9 development

**Acceptance Criteria:**

- 6.1 [ ] Route `(app)/(tabs)/fuel.tsx` renders `<ComingSoon/>` (existing V2 component at `packages/mobile/app/(app)/coming-soon.tsx`) until M9 (`13-nutrition-tracking`) ships its frontend.
- 6.2 [ ] When `13-nutrition-tracking` replaces the placeholder, this spec is updated with a "**Revised YYYY-MM-DD:**" append noting the integration.
- 6.3 [ ] In coach mode, the Fuel tab is not rendered (per locked decision #1 + 2 + STORY-002 AC 2.5).

### STORY-007: As a user, I want deep links from the legacy app to land on the right new route so my existing widgets / notifications / Universal Links keep working

**Acceptance Criteria:**

- 7.1 [ ] Deep-link redirect map added to `packages/mobile/app/_layout.tsx`:
  - `persistence://workouts` → `/(app)/(tabs)/train?segment=workouts`
  - `persistence://exercises` → `/(app)/(tabs)/train?segment=exercises`
  - `persistence://progress` → `/(app)/(tabs)/you`
  - `persistence://profile` → opens the ProfileDrawer (drawer state) and routes to `/(app)/(tabs)/you` underneath
- 7.2 [ ] The redirect map is honoured for 6 months (Phase 5 cleanup window per migration plan).
- 7.3 [ ] Notification payloads emitted by `09-notifications-social` with the old route names are auto-translated by the same redirect map (no separate handler).
- 7.4 [ ] `train?segment=workouts` query-string handling sets the segment AsyncStorage value as a side-effect, so the user lands on the right segment AND the next launch defaults to that segment.

### STORY-008: As a user, I want the tab bar to respect the safe-area inset so it doesn't sit behind the home indicator on devices that have one

**Acceptance Criteria:**

- 8.1 [ ] `<TabBar>` mount-point reads `useSafeAreaInsets().bottom` and applies `paddingBottom: insets.bottom + 8`. Tab bar floats 12pt from the screen edge regardless of device.
- 8.2 [ ] Scroll content respects the tab bar height + safe area — `paddingBottom: $bottomPadding (140)` on scroll containers per the design package's standard (per `tokens.tamagui.ts:100`).
- 8.3 [ ] On devices without a home indicator (iPhone SE, Android), the tab bar pads naturally without artificially inflating. Tested on iPhone 8 simulator + Pixel 5 emulator.

### STORY-009: As a developer, I want the navigation primitives + mode-state slice testable in isolation so changes don't require running the full app

**Acceptance Criteria:**

- 9.1 [ ] `useUserMode` slice has unit tests covering: default state, `switchTo('coach')` when eligible, `switchTo('coach')` when not eligible (no-op + warning), AsyncStorage rehydration, force-fallback-to-athlete on eligibility loss.
- 9.2 [ ] `useDrawer` slice has unit tests covering: default state, `openDrawer()`, `closeDrawer()`, no AsyncStorage persistence.
- 9.3 [ ] `<TabsLayout>` component test renders both athlete and coach tab specs by toggling the `useUserMode` mock; verifies exactly four tabs visible in each mode and the right Lucide icons render.
- 9.4 [ ] Integration test for the segmented Train hub: mount `<TrainHubContainer>`, change segment, verify AsyncStorage is written and the appropriate child renders.

---

## Out of scope

- **ProfileDrawer content composition** (identity card, mode-switch card body, account/subscription/preferences sections, sign-out button) — owned by `08-profile-settings`. This spec ships the mount-point + open-state hook + the drawer's slot in the layout tree.
- **Coach Home / Clients / Programs screen content** — owned by `10-trainer-features`. This spec reserves the route slots and renders `<ComingSoon/>` until M8 ships.
- **Fuel screen content** — owned by `13-nutrition-tracking`. Placeholder only.
- **Workouts + Exercises content** — owned by `04-workout-management`. This spec composes them under the Train hub via the Segmented switcher.
- **You / Progress content + Home screen** — owned by `06-progress-goals`. This spec reserves the route slots; the screens are authored there.
- **Active workout overlay state machine + minimised bar** — owned by `05-active-session`. The bar floats above the tab bar; the tab bar accommodates by adding `paddingBottom` when the overlay is in minimised state, but the state machine itself lives in 05.
- **Adoption sweep of `_layout.tsx`** — the layout rewrite is significant enough that it's owned by THIS spec's tasks, not the `01-design-system` adoption sweep. STORY-007 sweep in `01-design-system` deliberately skips `app/**` Expo Router files.

---

## Dependencies and what this spec unlocks

**Depends on:**

| Spec               | What's consumed                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-design-system` | `<TabBar>` primitive (mode-aware), `<Segmented>` primitive, `<Avatar>` primitive, `<BottomSheet>` primitive (drawer mount), `<ComingSoon>` (V2's existing component), Lucide icons, tokens |

**Unlocks:**

| Downstream spec         | What it can do once 14 lands                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `04-workout-management` | Workouts list + Exercises list mount under the Train hub via Segmented                                                     |
| `05-active-session`     | ActiveWorkoutOverlay's minimised bar can position relative to the new tab bar height                                       |
| `06-progress-goals`     | Home + You/Progress screens mount under their tab slots; CoachQuickPeek on Home reads `useUserMode().mode === 'coach'`     |
| `08-profile-settings`   | ProfileDrawer mounts in the drawer slot exposed here; mode-switch card calls `useUserMode().switchTo()`                    |
| `10-trainer-features`   | Coach Home, Clients, Programs mount under their coach-mode tab slots; the Clients tab badge reads from `useTrainerClients` |
| `13-nutrition-tracking` | Fuel screen replaces the `<ComingSoon/>` placeholder                                                                       |

---

## Open questions

None. All 10 navigation decisions are locked at the top. Open questions discovered during implementation are surfaced as "**Revised YYYY-MM-DD:**" appends.

---

_End of `14-navigation/requirements.md` · 2026-05-27_
