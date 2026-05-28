# Design Port Audit — Nav + Home + Workouts + Session + Progress

**Date:** 2026-05-27 (v2 — rewrite)
**Scope:** Per-screen recommendation: port legacy 1:1, or adopt the new design system?
**Source-of-truth ordering:** `~/Downloads/handoff/CLAUDE_CODE_MIGRATION_PLAN.md` Phase 0 → Phase 5.
**Output:** Recommendation only — no code changes.

This audit triangulates three sources for each in-scope surface:

| Source         | Where                                                                     | Role                                                                |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Legacy**     | `../persistence-mobile/` (sibling repo)                                   | V1 app — source of truth for behaviour + flows.                     |
| **V2**         | `packages/mobile/` (this repo)                                            | Port-in-progress — container/presenter, SST-backed, SQLite offline. |
| **New design** | `~/Downloads/handoff/` (design package + interactive prototype, May 2026) | High-fidelity prototype + design system intended to land in V2.     |

The CLAUDE.md project instruction is firm: **Mobile V2 is a port, not a redesign — no UI deviation from legacy without explicit go-ahead.** Treat this document as the structured go-ahead request: it surfaces, per surface, where the new design is materially better and where legacy parity is still the right call.

---

## Navigation + profile drawer — confirmed from the prototype (Option 3)

`design-source/prototype-hubs.jsx` line 1: _"Persistence — Interactive Prototype root (Option 3: 4-tab consolidated hubs)"_. This is the canonical IA. The prototype ships **four** nav options as exploration artefacts, but Option 3 is the one wired into the prototype itself, and the ProfileDrawer is explicitly noted as _"the primary pattern for Options 1, 3 and 4"_ in `design-source/screens/extra.jsx`.

### Tab bar — 4 tabs, mode-aware

|     | Athlete mode                                    | Coach mode                               |
| --- | ----------------------------------------------- | ---------------------------------------- |
| 1   | **Home**                                        | **Home**                                 |
| 2   | **Train** (segmented `Workouts` \| `Exercises`) | **Clients** (with attention-badge count) |
| 3   | **Fuel**                                        | **Programs**                             |
| 4   | **You**                                         | **You**                                  |

Tab bar visual contract (from `design-source/tab-bar.jsx`):

- Glass-blurred dark surface, floats above content (margin 12pt, blur 24px + saturate 140%).
- Active tab shows a 30 × 4pt pill above the icon + accent-tinted glow.
- Accent shifts: `cyan ($primary)` in athlete mode, `violet ($trainer)` in coach mode.
- "COACH" chrome dot (3pt × 8pt × 9.5pt eyebrow text) floats above the tab bar centre when mode is coach.
- Tab labels: 10pt display, letter-spacing 0.02em, weight 500 unfocused / 600 focused.

### ProfileDrawer — bottom-sheet, opened from avatar tap

From `design-source/screens/extra.jsx`:

- 88% max height, slides up from bottom, dark backdrop with 6px blur, tap-to-dismiss.
- Drag handle (40 × 4pt rounded).
- **Identity block** — Avatar (56pt, `COACH` badge if mode=coach), full name, email, subscription pills (`PREMIUM`, `TRIAL`), close IconBtn.
- **Mode-switch card** (only if `isTrainerEligible`) — Athlete view shows `Trainer Mode / Switch to manage your clients / [Switch]`; Coach view shows `Coaching 8 clients / Athletes feel like normal users / [↔ Athlete]`. Card background gradients to violet-tinted in coach mode.
- **Account** section — Profile details, Achievements (gold pill count), Health & integrations (success dot).
- **Subscription** section — single card with tier pill + expiry + Manage chevron.
- **Preferences** section — Notifications, Settings.
- **Sign out** — full-width outline error-tinted button at the bottom.

Mode-toggle behaviour: tapping the switch button flips a Zustand-style `mode` state at the root, which re-renders the tab bar with the alternate tab spec + accent + chrome dot. Identity, subscription, and route history persist across modes.

**This single decision cascades everywhere:** Workouts and Exercises consolidate into a Train hub, Progress folds into "You", Profile leaves the tab bar entirely, Clients tab gating flips from subscription-tier-static (current V2) to runtime mode-state (new design — coach users still see athlete tabs when in athlete mode), and a new Fuel tab is reserved for M9.

### Migration impact at a glance

| Today (V2)                                                       | New design                                                         | Notes                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 6 tabs (Home, Progress, Workouts, Exercises, Clients\*, Profile) | 4 tabs (mode-aware)                                                | Net delete: Exercises tab (folds into Train), Profile tab (becomes drawer). Net add: Fuel tab (M9 placeholder, gated until M9 ships). |
| `Workouts` tab → list screen                                     | `Train` tab → hub with `Segmented` between Workouts and Exercises  | Same workout-list + exercise-list content; new chrome (eyebrow `TRAIN`, contextual right-action by segment).                          |
| `Profile` tab → full screen                                      | ProfileDrawer bottom-sheet                                         | Avatar tap opens drawer; routes nested under `(app)/profile/*` keep working via push-nav from drawer rows.                            |
| Clients tab gated on `isTrainerTier` subscription                | Clients + Programs tabs surface only in **coach mode**             | Subscription gates ELIGIBILITY for coach mode; mode-state gates VISIBILITY of coach tabs. Two-layer gate.                             |
| No mode switching                                                | Mode is runtime state (athlete ↔ coach), accent + IA shift on flip | Zustand `mode` slice + AsyncStorage rehydration. M8 trainer features land cleanly on this state machine.                              |
| Static accent (`$primary500` cyan)                               | Mode-aware accent (`$primary` athlete / `$trainer` coach)          | Token-level: $accentTrainer = `#A78BFA`. Affects tab bar, Active session banner, headers, IconBtn tones.                              |

---

## TL;DR — per-surface call (final)

| #   | Surface                                                             | Recommendation                                                                                   | Migration plan phase                                               | Effort |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------ |
| 1   | **Navigation (4-tab Option 3 + ProfileDrawer + mode-aware accent)** | **ADOPT NEW**                                                                                    | Phase 2 (tab restructure) + Phase 3 (ProfileDrawer)                | L      |
| 2   | **Home**                                                            | **ADOPT NEW** (TodayHero 3-ring / habits / quick log / weekly volume / PR carousel)              | Phase 2 (adjust legacy screen)                                     | L–XL   |
| 3   | **Workouts list**                                                   | **PORT LEGACY 1:1 + token refresh** (design package explicitly says "preserve current patterns") | Phase 2                                                            | S      |
| 4   | **Workouts detail**                                                 | **PORT LEGACY 1:1 + token refresh**                                                              | Phase 2                                                            | S      |
| 5   | **Workouts create**                                                 | **PORT LEGACY 1:1 + token refresh**                                                              | Phase 2                                                            | S      |
| 6   | **Workouts edit**                                                   | **PORT LEGACY 1:1 + token refresh**                                                              | Phase 2                                                            | S      |
| 7   | **Active session**                                                  | **ADOPT NEW** (minimise overlay, set-row grid, end-confirm modal, trainer banner slot)           | Phase 2 (adjust legacy) + Phase 3 (overlay/bar)                    | L      |
| 8   | **Session summary**                                                 | **PORT LEGACY 1:1 + token refresh**                                                              | Phase 2                                                            | S      |
| 9   | **Workout rating**                                                  | **PORT LEGACY 1:1 + token refresh** (keep the semicircle slider — signature)                     | Phase 2                                                            | S      |
| 10  | **Progress**                                                        | **ADOPT NEW** (streak hero / milestones / body sparklines / volume by muscle / PR history)       | Phase 3 (presenter + mock container, then Phase 4 wires real data) | L      |

\* V2's `Clients` tab is currently gated by `href: null` on subscription tier. Under the new design it gates on `mode === 'coach'`.

---

## Migration plan phase ordering — applied to in-scope surfaces

This section is the actionable sequence. It follows `~/Downloads/handoff/CLAUDE_CODE_MIGRATION_PLAN.md` Phase 0 → Phase 5 verbatim, and maps each phase to concrete deliverables for the surfaces in this audit.

### Phase 0 — Audit & branch

1. **This document is the Phase 0 deliverable** (per the migration plan's `docs/design-port-audit.md` requirement).
2. Brad confirms the open decisions at the bottom of this doc (tab naming, brand cyan shift, Geist + bundle size, etc.).
3. Create branch `feat/design-system-port` off `main`.

### Phase 1 — Foundation (no per-screen work)

Cross-cutting prerequisite. Lands as its own stack of PRs before any screen touches.

#### 1.1 Tokens

Replace V2's existing Tamagui token export with `~/Downloads/handoff/tokens.tamagui.ts`. Codemod hard-coded colour strings to token references across the codebase:

- `#00D4FF` → `$primary` (note: new design's `$primary` = `#22D3EE`, a slight aqua-deepening — flag for Brad)
- `#FFFFFF` → `$text`
- `#FFD700` → `$gold`
- `#0A0A0F` / `#0A0B12` → `$bg`
- `rgba(0,212,255,*)` → `$primaryDim` / `$primaryGlow`
- All trainer-mode colour references → `$trainer` family (new token slot, no legacy hex to replace)

V2 currently ships **four `*LegacyTheme` files** (`homeLegacyTheme`, `workoutsLegacyTheme`, `subscriptionLegacyTheme`, `profileLegacyTheme`). These stay imported during Phases 2–4 — the codemod just shifts their internals to token references. Deletion is Phase 5 cleanup.

#### 1.2 Fonts

Bundle Geist + Geist Mono via `expo-font` + `@expo-google-fonts/geist` + `@expo-google-fonts/geist-mono`. Configure Tamagui's `fonts` block. Ship a `<Text variant="stat-lg">` helper that auto-applies the mono + `tnum` + `zero` font-feature recipe so screen authors can't forget. **Mandatory for any numeric display** — timers, weights, reps, calories. Without `tnum` numbers will bounce on update (the current V2 `MyProgressSection` + `ActiveSession` + timer surfaces all do this today).

#### 1.3 Primitives — port order (one PR each)

Per the migration plan §1.3:

```
Card → Btn → Pill → IconBtn → Avatar → Bar → Ring/MultiRing →
  Stat → Segmented → TabBar → HeaderBar → BottomSheet
```

These are the universal building blocks that Phase 2 + Phase 3 ports compose against. Each one ships as a standalone PR with a smoke-test render route or Storybook story; the design system standalone HTML is the visual oracle. Icons migrate from inline SVG / Ionicons → `lucide-react-native` per the mapping table in the migration plan §"Lucide icon mapping".

**Deliverable for Phase 1:** All 12 primitives merged, tokens + fonts wired, existing screens still rendering (because they compose against the primitives that now exist).

### Phase 2 — Adjust legacy screens

Touch only surfaces that **already exist** in V2 or legacy. **No new features.** The workflow per surface:

1. Open the prototype reference.
2. Diff against the live V2 screen.
3. Update layout, typography, colour usage, spacing to match.

#### 2.1 Tab restructure → Option 3

Rewrite `app/(app)/(tabs)/_layout.tsx`:

- Drop the `exercises` tab (folds into Train hub via `Segmented`).
- Drop the `profile` tab (becomes a root-mounted `ProfileDrawer`).
- Rename `workouts` route to `train` (or keep the path and rename the label; the prototype calls the tab **Train**).
- Add a `fuel` placeholder tab (M9 — gated to show "Coming soon" until that milestone ships).
- Rename `progress` route to `you` (or keep route, rename label — see open question #3).
- Replace the static `tabBarActiveTintColor: colorPalette.primary500` with a mode-aware selector (`useUserMode()` Zustand hook).
- Add the "COACH" chrome dot above the tab bar when `mode === 'coach'`.
- Mount `<ProfileDrawer/>` at `app/(app)/_layout.tsx` (one level up from the tabs group) so it can overlay the entire tab tree.

Mode-state primitive (new — lands in Phase 2 prep):

```ts
// src/state/user-mode.ts
type UserMode = 'athlete' | 'coach';
export const useUserMode = create<{
  mode: UserMode;
  isTrainerEligible: boolean;
  switchTo: (next: UserMode) => void;
}>(...);
```

Rehydrates from AsyncStorage on app launch (similar to the active-workout state machine the migration plan calls out).

#### 2.2 Home → ADOPT NEW

Rebuild `HomePresenter` with the new section order (see `design-source/screens/home.jsx`):

1. **HomeHeader** — eyebrow date + "Good morning, {name}" with primary-tinted name + bell IconBtn + Avatar (**tapping the avatar opens ProfileDrawer**).
2. **TodayHero** — 3-ring `MultiRing` (Move / Train / Fuel) with TODAY % in centre, ring legend stack, 4-up MicroPill row (streak / water / strain / sleep). Rings degrade gracefully: Move ring works with steps from HealthKit (already wired), Train ring lands with M4 (volume), Fuel ring lands with M9 (calories).
3. **Workout carousel** — _preserved verbatim from legacy_, only chrome refreshed.
4. **Habits grid** — TrueCoach-style daily check grid (M4 streaks).
5. **Quick log strip** — Weigh in / Log meal / Water / Mood (4 buttons; meal opens M9 Fuel, others no-op until milestones land).
6. **Weekly volume bar** — 7-day bar chart with comparison vs last week (M4).
7. **Recent PRs carousel** — gold-tinted cards with medal halo (M4).
8. **CoachQuickPeek** (optional) — only renders when `mode === 'coach'`, shows "8 clients · 3 need attention" with Open CTA (M8).

Container layer (`HomeContainer`) keeps the existing `useGetHome` + `useHealthData` + `useGetUserSubscription` shape. New sections degrade to empty / skeleton states until their backing data lands.

#### 2.3 Train hub → ADOPT NEW (tab restructure) + PORT LEGACY 1:1 (content)

New container `TrainHubContainer` wraps a `Segmented` control. The two segment contents are:

- `Workouts` segment → existing `WorkoutsListPresenter` (1:1 port + token refresh — design package says preserve)
- `Exercises` segment → existing `ExerciseListPresenter` (1:1 port + token refresh)

Top-right contextual action: search IconBtn for Workouts, "Create" IconBtn for Exercises (Brad's earlier feedback per migration plan §2).

Segment state persists to AsyncStorage so users land on whichever they used last.

Net change: just the chrome above the existing list views. The data hooks (`useGetMyWorkouts`, `useGetExercises`) are untouched.

#### 2.4 Workouts detail → PORT LEGACY 1:1 + token refresh

V2 already promoted this to a full-screen modal route (`/(app)/workouts/[id]`) in PR #41. Sticky safe-area header, exercise rows, Start CTA — keep this structure. Token codemod from Phase 1.1 handles the colour shift. Use `<Pill>` for the superset badge when the primitive lands.

#### 2.5 Workouts create + edit → PORT LEGACY 1:1 + token refresh

V2 already 1:1 ported. Token codemod from Phase 1.1 handles the colour shift. ExerciseConfigCard + AddExercisePopover stay as-is.

#### 2.6 Active session → ADOPT NEW

Rebuild `ActiveSessionPresenter` to match `design-source/screens/active-workout.jsx`:

- **Header row**: chevron-down minimise IconBtn (left, 36×36 round) + centred name with tabular timer beneath + "End" pill (right, behind confirm). Replaces the current `SessionHeader` (started-at + name only).
- **Training-with-client banner** (new) — `withClient` + `retroactive` props on the presenter; renders violet-tinted banner with "TRAINING LIVE WITH {client}" / "LOGGING SESSION FOR" + LIVE / RETRO pill. M8 wires the props; until then they default to undefined and the banner doesn't render.
- **Per-exercise card**: 28pt rounded icon + name + "{N} sets × {min}–{max} reps" caption + Swap IconBtn.
- **Set rows as a 5-column grid** (`SET · PREV · REPS · KG · ×`) with mono numerics + `tnum`. Replaces the current `SetLogger` inline layout. The grid pattern matches Strong / Hevy.
- **"+ Add Set" / "60s Rest" inline links** below each exercise's set table.
- **End-confirmation as a centred dialog** (replaces `Alert.alert`) — "Keep going" outline / "End" filled error.
- **Sticky floating "Finish Workout" CTA** at the bottom.

Companion (Phase 3 deliverable — see 3.1 below): `ActiveWorkoutBar` minimised overlay.

Container layer (`ActiveSessionContainer` with bulk-record flush, rest-timer command, superset commands) does **not** change. This is a presenter swap. Test rewrite scope: ~456 LOC presenter + ~269 LOC presenter tests.

#### 2.7 Session summary → PORT LEGACY 1:1 + token refresh

V2 already strong. Token codemod handles colour shift. Reuse the new gold PR card primitive (lands for Home / Progress) for the PR cards here.

#### 2.8 Workout rating → PORT LEGACY 1:1 + token refresh

Keep the SemiCircleSlider — it's signature. Per-band colours map cleanly to new tokens (`success` / `info` / `warning` / `warning-dark` / `error`).

### Phase 3 — New presenter screens with mock data containers

**Container / presenter split is mandatory here.** Every new screen ships as `*Presenter` (pure, takes props) + `*Container` (supplies mock data). When backend lands, swap the container body to `useQuery(...)`. The presenter stays untouched.

#### 3.1 ActiveWorkoutOverlay + ActiveWorkoutBar (minimise-to-bar pattern)

Net new infrastructure to support Active Session's chevron-down minimise:

```ts
// src/state/active-workout.ts
type ActiveWorkoutState = {
  workout: Workout | null;
  expanded: boolean;
  elapsedSeconds: number;
  start, minimize, expand, end, tick: ...;
};
```

Mount `<ActiveWorkoutOverlay/>` at `app/_layout.tsx`. Renders the full `ActiveSessionScreen` when `expanded === true`, the minimised `ActiveWorkoutBar` when `expanded === false`, nothing when `workout === null`. Tab navigation continues normally underneath the bar.

Persistence: write `workout` + `elapsedSeconds` to AsyncStorage on every state change. Rehydrate on mount; if `workout` exists on app launch, start in minimised state.

`ActiveWorkoutBar` visual contract (`design-source/screens/active-workout.jsx` lines 142-181): pulsing dot + "WORKOUT IN PROGRESS" eyebrow + workout name + timer + chevron-right, glowing cyan border, sits at `bottom: tabBarHeight + 12`, taps to expand.

This is a Phase 3 deliverable because it's net new infrastructure. M8's coach-initiated session features land cleanly on top of this state machine.

#### 3.2 ProfileDrawer

Author `ProfileDrawerPresenter` + `ProfileDrawerContainer` from `design-source/screens/extra.jsx` (lines 7-108).

Mock data: identity (from `useGetUserProfile`), subscription (from `useGetUserSubscription`), `isTrainerEligible` (from `useGetUserSubscription` — same source as current V2 trainer gating), `mode` (from `useUserMode` — the new state slice). Existing routes under `(app)/profile/*` (edit, privacy, help, contact, terms) keep working as push-nav targets from drawer rows.

Mode-switch button calls `useUserMode().switchTo('coach' | 'athlete')`. The tab layout re-reads `mode` and re-renders with the alternate tab spec + accent.

#### 3.3 Progress (athlete) / You

Author `YouPresenter` + `YouContainer` from `design-source/screens/progress.jsx`:

1. **HeaderBar** — eyebrow "LIFETIME · N WORKOUTS" + calendar IconBtn.
2. **StreakHero** — gradient ember card with flame icon + "23 days" + longest streak + freeze tokens row (M4).
3. **MilestonesRow** — 5 badge tiers (1w / 2w / 4w / 2mo / 3mo) earned vs locked (M4).
4. **BodyTrend** — weight sparkline + body-fat bar chart (M4; data already partly available via `useHealthData`).
5. **VolumeStats** — workouts / volume tonnes / adherence % strip + volume-by-muscle horizontal bar chart (M4).
6. **PRHistory** — gold-tinted PR cards with medal icon + strikethrough previous + delta in success-green (M4 — same primitive as Home's PRCarousel).

Mock containers ship first; M4 backend brief implementation wires real data in Phase 4.

V2's current `progress.tsx` is a `<ComingSoon/>` stub — replacing it is a clean greenfield play.

#### 3.4 Coach Home + Clients + Programs (out of scope for this audit, but called out here)

The Option 3 coach mode introduces Coach Home, Clients list, Client detail, and Programs list as net-new screens. These are M8 deliverables and have their own briefs. The audit doesn't recommend on them — but the navigation restructure in Phase 2 reserves their tab slots, and the mode-state primitive from Phase 2 lights them up at runtime.

### Phase 4 — Wire real data

Replace mock containers with real data fetching as backend dependencies land. Per the migration plan §Phase 4:

```
1. Workouts API     — already partially built → Home, Train hub, Workout detail, Active session
2. Exercises API    — already partially built → Train hub > Exercises, Create Exercise
3. Goals + Streaks  — M4 backend → You/Progress, Home habits + streak hero
4. Health data      — already partially built via HealthKit → Home TodayHero Move ring + Body trends
5. Fuel logging     — M9 backend → Fuel tab + Home Fuel ring + Home Quick log meal CTA
6. Coach features   — M8 backend → Coach Home, Clients, Client detail, Programs, Active session trainer banner
```

Presenters stay untouched. Each container PR notes which presenter screens it unlocks.

### Phase 5 — Polish, a11y, cleanup

1. **Retire `*LegacyTheme` files** — delete `homeLegacyTheme`, `workoutsLegacyTheme`, `subscriptionLegacyTheme`, `profileLegacyTheme` and any imports.
2. **A11y audit pass** — every Btn / IconBtn / pressable has `accessibilityLabel`. Touch targets ≥44pt. Tab bar respects safe-area inset.
3. **Reduced motion** — `useReducedMotion()` skips ring fill animation + snap (not slide) bottom sheets.
4. **Performance** — FlashList on Clients / Exercises / Recipes / PR History.
5. **Deep links** — preserve `persistence://workouts` → `/(app)/train` redirect for 6 months.

---

## Per-surface analysis — what's there today, what changes

The summary above is enough to act on. This section is the deeper read for each in-scope surface.

### 1. Navigation — ADOPT NEW (Option 3, 4-tab consolidated hubs)

| Layer      | What's there                                                                                                                                                                                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy     | 5 tabs: Home / Progress / Workouts / Clients (conditional on trainer tier) / Profile. Static cyan accent.                                                                                                                                                                                                                                |
| V2 today   | **6 tabs** — Home / Progress / Workouts / Exercises / Clients (conditional on trainer tier via `href: null`) / Profile. Static cyan accent. Active-tab top indicator bar (2pt × 24pt). Safe-area-aware tab bar height.                                                                                                                   |
| New design | **4 tabs, mode-aware.** Athlete: Home / Train / Fuel / You. Coach: Home / Clients / Programs / You. Profile becomes a bottom-sheet drawer mounted at the root; mode-switch lives inside the drawer with violet trainer accent. Tab bar accent shifts cyan ↔ violet based on mode; "COACH" chrome dot floats above the bar in coach mode. |

**Why adopt:** the prototype's `prototype-hubs.jsx` line 1 explicitly identifies Option 3 as the canonical IA. V2's current 6-tab layout is the most fragmented of the three sources, and dropping Profile + Exercises off the tab bar frees room for Fuel (M9) without bloating to 7 tabs. The mode-switch-in-drawer pattern is the cleanest way to express trainer-mode IA changes; subscription tier gates ELIGIBILITY, runtime mode gates VISIBILITY.

**Effort:** L. Splits across Phase 2 (tab layout rewrite, drop Exercises + Profile tabs) and Phase 3 (ProfileDrawer presenter/container + mode-state Zustand slice + ActiveWorkoutOverlay).

### 2. Home — ADOPT NEW

| Layer      | What's there                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy     | HomePresenter (Greeting → Goals → Workouts → MyProgress → RecentActivity) wired to `useGetHome` + `useHealthData`.                                               |
| V2 today   | 1:1 port of legacy. `homeLegacyTheme`. Animated section stagger. Strong cache-empty + refresh-fail error handling (blocking ErrorState or inline banner).        |
| New design | TodayHero 3-ring (Move/Train/Fuel) with status-first framing, workout carousel preserved verbatim, habits grid, quick log strip, weekly volume bar, PR carousel. |

**Why adopt:** Home is the highest-leverage first-impression surface. The status-first 3-ring pattern (Whoop / Apple Fitness / Future) is materially better than the current task-list framing. Net new sections degrade gracefully — Move ring works today with HealthKit steps; Train + Fuel rings light up as M4 + M9 ship.

**Effort:** L–XL. Net new components: MultiRing (Reanimated 3 SVG worklet), HabitsGrid, QuickLogStrip, WeeklyVolume bar chart, PRCarousel. Most reusable on the You/Progress screen.

### 3. Workouts list (Train > Workouts) — PORT LEGACY 1:1 + token refresh

| Layer                                            | What's there                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy                                           | SearchBar + QuickActions + WorkoutLimitIndicator + My Workouts section + Example Workouts section + WorkoutPopover overlay.           |
| V2 today                                         | 1:1 port. `workoutsLegacyTheme`. RefreshControl. Detail-as-popover replaced with detail-as-modal-route.                               |
| New design (`design-source/screens/library.jsx`) | Self-labels as "REFERENCE — preserving current patterns. User has these settled; we only refresh chrome/colors to match new palette." |

**Why port:** the design package itself says preserve. Chrome refresh comes for free from Phase 1.1 tokens + Phase 1.3 primitives.

**Effort:** S.

### 4. Workouts detail — PORT LEGACY 1:1 + token refresh

| Layer      | What's there                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy     | `WorkoutPopover` overlay over Workouts list. Description + metadata + exercise list + Start CTA.                                                                     |
| V2 today   | Promoted to full-screen modal route at `/(app)/workouts/[id]` (PR #41). Sticky safe-area header, deep-linkable, exercise rows tappable into `/(app)/exercises/[id]`. |
| New design | No dedicated detail screen in `design-source/screens/`.                                                                                                              |

**Why port:** no new-design equivalent exists; V2's current shape (full-screen modal with sticky header) is correct.

**Effort:** S.

### 5–6. Workouts create + edit — PORT LEGACY 1:1 + token refresh

| Layer      | What's there                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| Legacy     | `workout-creator.tsx` / `workout-editor.tsx` — form + exercise config cards + AddExercisePopover + Save. |
| V2 today   | 1:1 ports using `useWorkoutForm` hook + `ExerciseConfigCard` + `AddExercisePopover`.                     |
| New design | No dedicated create / edit screen in `design-source/screens/`.                                           |

**Why port:** no design package equivalent. The forms will benefit from new primitives (`<Card>`, etc.) once they land, but the structure is correct.

**Effort:** S each.

### 7. Active session — ADOPT NEW

| Layer                                                   | What's there                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy                                                  | `ActiveWorkoutScreen` — name + giant stopwatch icon header, vertical exercise stack, full-width SetLogger inputs, +Add Exercise link, Discard/Complete bottom buttons.                                                                                                                                           |
| V2 today                                                | 1:1 port (`ActiveSessionPresenter`, 456 LOC). `SessionHeader` + `SessionExerciseCard` + `ActiveSupersetRow` + `RestTimerDisplay`. Solid foundation; visually unchanged from legacy.                                                                                                                              |
| New design (`design-source/screens/active-workout.jsx`) | Major rebuild — chevron-down minimise + centred name + timer + End pill header. Coach banner ("TRAINING LIVE WITH {client}"). 5-column set grid (SET · PREV · REPS · KG · ×). Inline +Add Set / 60s Rest links. Centred end-confirm dialog. Sticky Finish CTA. Companion `ActiveWorkoutBar` for minimised state. |

**Why adopt:** the second-widest design gap in the audit after Home. Solves the minimise-to-bar problem (which M8 needs anyway). Tabular set grid reads tighter mid-set. Trainer banner slot is the M8 coach-session hook. End-confirm as a dialog is on-brand vs platform Alert.

**Effort:** L. Net new infrastructure (Zustand store + `<ActiveWorkoutOverlay/>` + AsyncStorage hydration) plus presenter rebuild. Container layer (bulk-record flush, rest-timer command, superset commands) untouched.

### 8. Session summary — PORT LEGACY 1:1 + token refresh

| Layer      | What's there                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Legacy     | `WorkoutSummaryScreen` — "Workout Complete!" + 3-stat strip + PR cards + Continue.                                        |
| V2 today   | 1:1 port (`SessionSummaryPresenter`). Brad's "Total Volume" tile swap from PR #61. PR card supports null `previousValue`. |
| New design | No explicit session summary screen. PR card visual reused in Home `PRCarousel` and You/Progress `PRHistory`.              |

**Why port:** V2's current summary is already strong. Reuse the new gold PR card primitive when it lands.

**Effort:** S.

### 9. Workout rating — PORT LEGACY 1:1 + token refresh

| Layer      | What's there                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Legacy     | `WorkoutRatingScreen` — bespoke top-semicircle SVG slider (1–10) + difficulty band + notes + Submit. |
| V2 today   | 1:1 port (`WorkoutRatingPresenter` + `SemiCircleSlider`).                                            |
| New design | No explicit rating screen in `design-source/screens/`.                                               |

**Why port:** the semicircle slider is the most distinctive interaction in the app. Per-band colours map to new tokens.

**Effort:** S.

### 10. Progress / You — ADOPT NEW

| Layer                                             | What's there                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Legacy                                            | Inline screen with Progress Overview card + Quick Stats + PRs + Body Measurements + Recent Workouts. Functional but plain. |
| V2 today                                          | `<ComingSoon/>` stub.                                                                                                      |
| New design (`design-source/screens/progress.jsx`) | Full rebuild: streak hero / milestones grid / body sparklines / volume-by-muscle / PR history.                             |

**Why adopt:** greenfield in V2 — no port-vs-redesign tension. Maps directly to M4 spec sections (PR #77 merged the spec extensions for habits / streaks / freeze tokens / achievements).

**Effort:** L. Author as Phase 3 presenter + mock container; M4 backend wires in Phase 4.

---

## Risk + dependency notes

| Risk                                                      | Detail                                                                                                                                                                          | Mitigation                                                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brand colour shift**                                    | New `$primary #22D3EE` is ~5° deeper than legacy `#00D4FF`. Visible side-by-side.                                                                                               | Surface to Brad before Phase 1.1. Override the token back to `#00D4FF` if he prefers — nothing else in the system breaks.                                                                         |
| **Font bundling weight**                                  | Geist + Geist Mono add ~250KB to the bundle.                                                                                                                                    | Measure cold-start post-Phase 1.2. Variable-font slim build if material.                                                                                                                          |
| **Container layer is stable across "adopt new" surfaces** | Home, Active, Progress all keep their containers / hooks / commands.                                                                                                            | Presenter-only swaps. Behaviour parity achievable. Carry over presenter test suites.                                                                                                              |
| **Active-session minimise overlay is new infrastructure** | Zustand store + root-mounted overlay + AsyncStorage rehydration.                                                                                                                | M8 coach features need this anyway. Build as a coherent unit in Phase 3.1.                                                                                                                        |
| **Mode-state is also new infrastructure**                 | `useUserMode` Zustand slice + AsyncStorage rehydration. Drives tab bar accent, tab spec, ProfileDrawer mode-switch card, Active session trainer banner, CoachQuickPeek on Home. | Single source of truth in `src/state/user-mode.ts`. Container layer can subscribe via `useUserMode()`.                                                                                            |
| **Subscription gating vs mode visibility**                | Subscription tier gates ELIGIBILITY to switch to coach mode; runtime `mode` state gates VISIBILITY of coach tabs / coach features.                                              | Make `isTrainerEligible` a derived value from `useGetUserSubscription`, exposed through `useUserMode()`. If a user's subscription expires while in coach mode, force a fall-back to athlete mode. |
| **Fuel tab placeholder before M9**                        | Tab restructure in Phase 2 reserves the slot, but M9 isn't shipping until later.                                                                                                | Tab renders `<ComingSoon/>` until M9 lands — same pattern as V2's current `progress.tsx`. Avoids tab-bar churn between phase 2 and M9.                                                            |
| **Progress is greenfield AND blocked on M4 backend**      | Presenter can ship with mock data per Phase 3 — but the user can't interact with real progress until M4 ships.                                                                  | Author with mock containers; design review decoupled from backend readiness.                                                                                                                      |

---

## Open questions for Brad

1. **Brand cyan shift confirmed?** Move to `#22D3EE`, or override the token back to `#00D4FF` to preserve exact legacy hex? (Recommendation: move to `#22D3EE` — the design package's accessibility ramp is tuned for it.)
2. **Geist licence + ~250KB bundle weight OK?** (`@expo-google-fonts/geist` is free.)
3. **Tab label names** — keep "Workouts → Train" and "Profile → You" per the prototype, or keep current V2 names for continuity? (Recommendation: adopt prototype names — "Train" + "You" are tighter and the prototype's design rationale is built around them.)
4. **Include the Active Session trainer-banner slot now (props default undefined) or wait until M8?** (Recommendation: include now — 20 LOC, makes M8 a pure container change.)
5. **Author the Progress mock container now (Phase 3) or wait until M4 frontend brief implementation starts?** (Recommendation: author now — design review decouples from backend.)
6. **OK to plan retiring all four `*LegacyTheme` files in Phase 5?** (Recommendation: yes — they were always interim.)
7. **Mode-state location** — Zustand slice in `src/state/user-mode.ts` is the recommendation. Confirm before Phase 2.1 starts.
8. **Fuel tab placeholder** — render `<ComingSoon/>` immediately when the tab restructure lands in Phase 2.1, or hide the tab until M9 ships? (Recommendation: render placeholder — keeps the IA stable through the M4/M7 → M8/M9 transition.)

---

_End of audit v2 · 2026-05-27 · No code changes._
