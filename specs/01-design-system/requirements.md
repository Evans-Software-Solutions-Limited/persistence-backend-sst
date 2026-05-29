# 01 — Design System: Requirements

> **Spec rewritten from scratch on 2026-05-27** to absorb the May 2026 design package (`~/Downloads/handoff/`). The prior version is preserved in git history. Append-only intent (`_agent.md` rule 7) waived for this rewrite by explicit owner authorisation; future amendments use the "**Revised YYYY-MM-DD:**" append pattern.

---

## Overview

The design system foundation: tokens, fonts, twenty-two primitive components, the icon vocabulary, the codemod that retires hard-coded styling, and the adoption sweep that swaps ad-hoc components in existing V2 screens for the new primitives. **No screen-level layout work in this spec** — but existing V2 screens _will_ be modified by the adoption sweep (STORY-007) to consume the new primitives, even if they look transitionally clunky until their owning spec finishes the port.

Every downstream spec (`04-workout-management`, `05-active-session`, `06-progress-goals`, `08-profile-settings`, `10-trainer-features`, `13-nutrition-tracking`, `14-navigation`) composes against the primitives + tokens this spec ships.

Authoritative references (gospel order):

1. `~/Downloads/handoff/Persistence - Prototype (Standalone).html` — interactive prototype, visual oracle for primitive states + states-in-context.
2. `~/Downloads/handoff/Persistence - Design System (Standalone).html` — every token + primitive on one page.
3. `~/Downloads/handoff/tokens.tamagui.ts` — drop-in token export; this spec's `design.md` mirrors the file's structure exactly.
4. `~/Downloads/handoff/components.handoff.ts` — foundation primitive prop contracts (composite primitives are defined in this spec's `design.md`, sourced from `design-source/*.jsx`).
5. `~/Downloads/handoff/CLAUDE_CODE_MIGRATION_PLAN.md` Phase 1 — port order + integration sequencing.
6. `~/Downloads/handoff/design-source/ui.jsx`, `tab-bar.jsx`, `icons.jsx`, `screens/home.jsx`, `screens/progress.jsx`, `screens/active-workout.jsx`, `screens/extra.jsx` — reference implementations to port from.

If a downstream spec, brief, or PR ever ambiguates against the prototype, the prototype wins.

---

## Locked decisions

| #   | Decision               | Locked value                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Brand cyan             | `$primary = #22D3EE` (deepened from legacy `#00D4FF`)                                                                                                                                                                                                                                                                                              |
| 2   | Display + body font    | Geist via `@expo-google-fonts/geist` (bundle weight accepted)                                                                                                                                                                                                                                                                                      |
| 3   | Numeric font           | Geist Mono via `@expo-google-fonts/geist-mono` with `tnum` + `zero` font-features baked in                                                                                                                                                                                                                                                         |
| 4   | Icon library           | `lucide-react-native` per the mapping table in `CLAUDE_CODE_MIGRATION_PLAN.md` § "Lucide icon mapping"                                                                                                                                                                                                                                             |
| 5   | Touch-target floor     | 44pt (Apple HIG) — enforced by `$size.touchTarget` token + primitive defaults                                                                                                                                                                                                                                                                      |
| 6   | Theme mode             | Dark-only (V2 is dark-only; light theme is post-launch consideration)                                                                                                                                                                                                                                                                              |
| 7   | Coach-mode accent      | `$accentTrainer = #A78BFA` violet family — used by primitives when `mode === 'coach'`                                                                                                                                                                                                                                                              |
| 8   | Legacy theme files     | The four `*LegacyTheme` files (`homeLegacyTheme`, `workoutsLegacyTheme`, `subscriptionLegacyTheme`, `profileLegacyTheme`) stay in-tree during this spec; codemodded to token references but not deleted. Deletion is M11 Polish cleanup, captured in `12-production-readiness`.                                                                    |
| 9   | Segmented option count | **2–5 options supported**. Deviates from `components.handoff.ts`'s "two-option max" mandate per owner decision 2026-05-27. Keeps the primitive flexible for confirmed three-option needs (e.g. `10-trainer-features` Clients screen `Active \| All \| Archive`) and any future segmenting without a follow-up primitive PR.                        |
| 10  | No deferred primitives | Every reusable composite identified in the prototype source is shipped in this spec. Per owner decision 2026-05-27: deferred-to-later is how things get missed. If a downstream spec discovers a missing primitive, the resolution is a spec amendment here (revised-date append) followed by a new primitive PR, before the screen work proceeds. |

---

## User stories

### STORY-001: As a developer authoring any V2 screen, I want a single canonical token export so all colour / spacing / radius / font / shadow / z-index values trace to one source

**Acceptance Criteria:**

- 1.1 [ ] `packages/mobile/src/ui/theme/tokens.ts` exports the full token surface from `~/Downloads/handoff/tokens.tamagui.ts` verbatim (colour, space, size, radius, zIndex, fonts, shadow).
- 1.2 [ ] Tamagui's `createTamagui({ tokens, ... })` config consumes the export; running `bun run typecheck` confirms every token referenced by primitive code compiles.
- 1.3 [ ] No hard-coded hex strings remain in `packages/mobile/src/ui/` after the codemod in STORY-006 lands. (CI lint rule added: regex `#[0-9A-Fa-f]{3,8}` fails outside `theme/` and migration-fixture paths.)
- 1.4 [ ] All semantic tokens documented in `design.md` § "Token reference" with their WCAG contrast ratio on `$bg #0A0B12` (mirroring the inline notes in `tokens.tamagui.ts`).
- 1.5 [ ] Coach-mode accent family (`$accentTrainer`, `$accentTrainerBright`, `$accentTrainer7`, `$accentTrainerGlow`, `$accentTrainerDim`, `$accentTrainerInk`) is exported alongside `$primary` family. No primitive uses `$primary` and `$accentTrainer` at the same time — the running mode picks one or the other (see `14-navigation` for the mode-state contract).

### STORY-002: As a user, I want stat displays (timer, weights, reps, calories, volume) to render in a tabular numeric font so numbers don't visually bounce when they update

**Acceptance Criteria:**

- 2.1 [ ] Geist + Geist Mono load on iOS + Android via `expo-font` + `@expo-google-fonts/geist` + `@expo-google-fonts/geist-mono`; verified on cold start of `bun run dev`.
- 2.2 [ ] Tamagui `fonts` config exposes three families: `$display` (Geist 400–800 + letter-spacing scale), `$body` (Geist 400–600), `$mono` (Geist Mono 400–600 with `font-feature-settings: 'tnum', 'zero'` baked in).
- 2.3 [ ] A `<Stat>` primitive (STORY-003) and a `<Text variant="stat-lg">` helper both auto-apply `$mono` + `tnum` so screen authors cannot accidentally render a numeric value in proportional figures.
- 2.4 [ ] Active session timer (current V2 surface), set-row weight/reps cells, Home `TodayHero` ring centre, Progress streak count, and Workout summary stat tiles all use `$mono` after the downstream specs port — verified by visual diff against the prototype.
- 2.5 [ ] Geist Mono `zero` feature renders slashed-zero (visible on `0`, `00`, `000` strings); a smoke-test render route demonstrates this.

### STORY-003: As a developer, I want twelve **foundation primitives** with the prop contracts defined in `components.handoff.ts` so screen work composes against a stable library

**Acceptance Criteria:**

- 3.1 [ ] All twelve foundation primitives ship under `packages/mobile/src/ui/components/`: `Card`, `Btn`, `Pill`, `IconBtn`, `Avatar`, `Bar`, `Ring` + `MultiRing` (single file), `Stat`, `Segmented`, `TabBar`, `HeaderBar`, `BottomSheet`. One PR per primitive per the migration plan.
- 3.2 [ ] Each primitive's prop signature matches `~/Downloads/handoff/components.handoff.ts` 1:1: `Card` exposes `surface | pad | radius | glow | accent`; `Btn` exposes `variant ('filled' | 'outline' | 'ghost' | 'soft') × tone ('primary' | 'gold' | 'trainer' | 'ember' | 'success' | 'error') × size ('sm' | 'md' | 'lg')` plus `icon` + `full` + `onPress`; etc. The full per-primitive matrix is in `design.md`.
- 3.3 [ ] Every primitive defaults `minHeight: $touchTarget` (44) for interactive variants. `Btn size='sm'` is 36px; renders only inside dense rows where the parent itself meets 44pt.
- 3.4 [ ] `IconBtn` and `Avatar` render as `<View>` (non-pressable) when no `onPress` is supplied — safe to nest inside row-level pressables without nested-button warnings.
- 3.5 [ ] `Ring` and `MultiRing` animate the fill via `react-native-reanimated` 3 worklet on `strokeDasharray` (800ms cubic-bezier `0.2, 0.7, 0.2, 1`). Animation respects `useReducedMotion()` — when reduced, the fill jumps to final state with no transition.
- 3.6 [ ] `BottomSheet` uses `@gorhom/bottom-sheet` v4 (snap points, gestures, backdrop). Default 78% height; `peek` prop drops to 60%. `accent` prop tints the eyebrow + drag-handle.
- 3.7 [ ] `Segmented` supports **2–5 options** (per locked decision #9). Default visual contract from `tab-bar.jsx` lines 88–115 — segments are equal-width inline-flex with active state showing `$surface4` fill + accent shadow ring. With more than 3 options on narrow viewports (< 360pt), Segmented auto-scrolls horizontally rather than truncating labels.
- 3.8 [ ] `TabBar` accepts a `mode` prop (`'athlete' | 'coach'`) that recolors the active-tab pill + label between `$primary` and `$accentTrainer`. When `mode === 'coach'` the "COACH" chrome dot (3pt × 8pt rounded, `$accentTrainer` background, 9.5pt eyebrow text) floats above the centre of the bar. Detailed composition is in `14-navigation`.
- 3.9 [ ] Each primitive ships with: a unit test suite (props → render assertions), a smoke-test render route at `/dev/primitives/<name>` (gated behind `__DEV__`), and at least one usage example in the test file that matches the prototype's rendering.
- 3.10 [ ] Storybook is **not** introduced in this spec — the `/dev/primitives/` route is sufficient (avoids a tool-introduction PR in the foundation phase).

### STORY-004: As a developer composing screens, I want ten **composite primitives** for repeated UI patterns identified in the prototype so I don't end up reimplementing the same shape inline per screen

**Acceptance Criteria:**

- 4.1 [ ] All ten composite primitives ship under `packages/mobile/src/ui/components/`. Each composes the foundation primitives from STORY-003. Source line references to the prototype JSX live in `design.md`.

| Composite               | Compose from                       | Used by (downstream)                                                                                                                                                                                                                                                                                  | Source                                                                   |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `<Section>`             | nothing — semantic wrapper         | every screen with `EYEBROW + Title + action + children` shape                                                                                                                                                                                                                                         | `home.jsx` line 155 (`Section`), `progress.jsx` line 61 (`SectionTitle`) |
| `<DrawerRow>`           | `IconBtn` chevron                  | `ProfileDrawer` rows + `ProfileScreen` rows                                                                                                                                                                                                                                                           | `extra.jsx` line 119                                                     |
| `<MicroPill>`           | `Pill`                             | `TodayHero` 4-up row + Active session header chips                                                                                                                                                                                                                                                    | `home.jsx` line 137                                                      |
| `<RingLegend>`          | nothing — labelled colour dot      | `TodayHero` legend + any other ring usage                                                                                                                                                                                                                                                             | `home.jsx` line 122                                                      |
| `<PRCard>`              | `Card`, `Pill`                     | Home `PRCarousel` + Progress `PRHistory` + Session `Summary`                                                                                                                                                                                                                                          | `home.jsx` line 341 + `progress.jsx` line 227                            |
| `<SummaryChip>`         | nothing — toned counter chip       | Trainer Clients summary + any "N waiting" / "N missed" surface                                                                                                                                                                                                                                        | `extra.jsx` line 243                                                     |
| `<ClientRow>`           | `Avatar`, `Pill`, `Bar`, `IconBtn` | Trainer Clients list + Client detail headers                                                                                                                                                                                                                                                          | `extra.jsx` line 257                                                     |
| `<WorkoutCarouselCard>` | `Card`, `Pill`, `IconBtn`          | Home `WorkoutCarousel` only — 260pt fixed-width horizontal-scroll card with optional `primary` gradient highlight. Distinct from V2's existing list-row `<WorkoutCard>` at `packages/mobile/src/ui/components/workouts/WorkoutCard/`, which is owned by `04-workout-management` and remains in place. | `home.jsx` line 197                                                      |
| `<HabitTile>`           | nothing — daily check cell         | Home `HabitsGrid` + Progress habits surface                                                                                                                                                                                                                                                           | `home.jsx` line 227 (within `HabitsGrid`)                                |
| `<SearchBar>`           | nothing — h40 input + icon         | Train hub Exercises tab + Trainer Clients screen + any future search                                                                                                                                                                                                                                  | `prototype-hubs.jsx` (Exercises) + `extra.jsx` (Clients)                 |

- 4.2 [ ] Each composite primitive ships in its own PR; same test + smoke-route discipline as foundation primitives (STORY-003 AC 3.9).
- 4.3 [ ] Composites do NOT replicate prop contracts already exposed by foundation primitives — e.g. `<WorkoutCard>` accepts `onPress`, not a separately-named `onClick`, matching the foundation `Btn` API.
- 4.4 [ ] Each composite declares its `accentMode` prop (`'primary' | 'gold' | 'trainer' | 'ember' | 'success' | 'error'`) where the prototype uses tone-shifted variants. `<WorkoutCarouselCard>` uses the boolean `primary` prop (matching the prototype) for the gradient-highlight first-of-list variant, rather than the `accentMode` enum — the carousel card's "promoted" state is binary, not toned.
- 4.5 [ ] `<Section>` consolidates Home's `Section` + Progress's `SectionTitle` patterns into one primitive: props `eyebrow?: string; title?: string; action?: ReactNode; hideHr?: boolean; children: ReactNode`. Both `eyebrow` and `title` are optional so the Progress-style "eyebrow + title + action with no body" usage is covered by passing `children={null}` and `hideHr`.
- 4.6 [ ] `<DrawerRow>` accepts a `loading` prop that swaps the title/sub text for skeleton blocks — supports the offline-first cache-loading state mandated in `_agent.md § Offline-First Architecture`. Same skeleton prop is added to `<ClientRow>`, `<WorkoutCarouselCard>`, `<PRCard>`.
- 4.7 [ ] If implementation discovers a primitive that should exist but isn't in the table above, work pauses; a "**Revised YYYY-MM-DD:**" append block is added to this spec describing the new primitive + its source line; a new PR ships the primitive; only then does the consuming screen work resume. Per locked decision #10, no primitives are deferred to a follow-up spec.

### STORY-005: As a user, I want every interactive element to meet WCAG AA contrast + the 44pt touch-target floor

**Acceptance Criteria:**

- 5.1 [ ] Every colour token in `tokens.ts` has its measured contrast ratio against `$bg #0A0B12` documented inline (per `tokens.tamagui.ts` annotations). `$text` 17.8:1, `$text2` 9.4:1, `$text3` 4.8:1 (AA floor for text), `$primary` 10.1:1 (AAA), `$accentTrainer` 7.4:1 (AAA), `$gold` 11.2:1, `$success` 10.3:1.
- 5.2 [ ] `$text4` and `$text5` (sub-AA values, used only for disabled / hairline contexts) are not used for any rendered text in the twenty-two primitives — enforced by visual review against the prototype.
- 5.3 [ ] All interactive primitives (foundation + composite where pressable) default `minHeight: 44` (or `minHeight: 36` only when the parent is an explicit dense row + the parent itself meets 44). The `<HabitTile>` cell uses `36×36` since the entire grid is the touch surface for parents.
- 5.4 [ ] Each primitive accepts and forwards `accessibilityLabel`, `accessibilityRole`, `accessibilityState` to its underlying `Pressable`. A11y props are surfaced in the prop signature, not hidden behind `...rest`.
- 5.5 [ ] An automated a11y smoke check (`@testing-library/react-native` + jest-axe-equivalent or a custom assertion) verifies every primitive's pressable variants render with `accessibilityLabel` defined or fail loudly.

### STORY-006: As a developer, I want hard-coded colour / radius / font / spacing strings codemodded to token references so future screen work cannot proliferate magic values

**Acceptance Criteria:**

- 6.1 [ ] Codemod script committed at `scripts/codemod-tokens.ts`. Idempotent, dry-run mode by default. Operates on `packages/mobile/src/**` excluding `theme/**` and `__tests__/fixtures/**`.
- 6.2 [ ] Colour-string replacement table baked into the codemod, matching the migration plan:
  - `#00D4FF` → `$primary`
  - `#FFFFFF` → `$text`
  - `#FFD700` → `$gold`
  - `#0A0A0F` and `#0A0B12` → `$bg`
  - `rgba(0,212,255,*)` → `$primaryDim` / `$primaryGlow` (heuristic on alpha < 0.20 → Dim, ≥ 0.20 → Glow)
- 6.3 [ ] The four `*LegacyTheme` files have their internal hex literals codemodded to token references — they continue to export the same named exports, but their values now resolve through the token system. Existing screens that import from `*LegacyTheme` keep working unchanged.
- 6.4 [ ] CI lint rule introduced: any new hex literal outside `theme/` or `__tests__/fixtures/` fails. The four `*LegacyTheme` files are allow-listed until M11 Polish deletes them.
- 6.5 [ ] Codemod run output committed as a single sweep PR with a count of replacements per file. No semantic changes in the same PR.

### STORY-007: As a developer, I want ad-hoc component shells in existing V2 screens swapped for the new primitives so screens benefit from the new design system as it lands — accepting that screens will look transitionally clunky until their owning spec finishes the port

**Acceptance Criteria:**

- 7.1 [ ] An "adoption sweep" PR (or per-screen sequence of PRs) visits every file in `packages/mobile/src/ui/presenters/**` and `packages/mobile/src/ui/components/**` (excluding the new primitives themselves) and swaps the following 1:1 shell replacements where the prop surface fits:
  - `<TouchableOpacity onPress={…}>` containing a single `<Text>` with manual font/colour → `<Btn>` with the matching variant/tone inferred from the legacy style
  - Inline `<View>` cards with manual padding + border + radius → `<Card>` with the matching surface/pad/radius
  - Manual badge `<View>` + `<Text>` → `<Pill>` with the matching tone
  - Circle `<View>` initials → `<Avatar>`
  - Custom Ionicons / `<Svg>` icon usage → Lucide icons (per STORY-008)
- 7.2 [ ] **Layout shape is preserved.** The sweep changes component types and prop surfaces; it does NOT restructure how a screen lays out its content. (Example: legacy `HomePresenter` keeps its `Greeting → Goals → Workouts → MyProgress → RecentActivity` section order; the Goals card becomes a `<Card>` instead of a styled `<View>`, but the content inside is unchanged.) Screen-level rebuilds happen in their owning spec.
- 7.3 [ ] **Composite primitives are NOT introduced in the adoption sweep.** Only foundation primitives (STORY-003) are swapped in. Composite primitives (`<PRCard>`, `<ClientRow>`, etc.) land when the consuming screen is touched by its owning spec — they exist in the library from STORY-004 but aren't force-fed into screens during the sweep.
- 7.4 [ ] The transitional clunky appearance — e.g. a screen with a mix of `<Card>` primitives and bespoke older containers — is an accepted outcome. A note is added to each touched file: `// [01-design-system adoption sweep 2026-MM-DD] - shells swapped to primitives; owning spec finishes the port.`
- 7.5 [ ] Each adoption-sweep PR includes screenshots of the affected screens before + after, confirming no layout regression. Visual review verifies "still functional, possibly mismatched".
- 7.6 [ ] If a screen's existing component cannot map cleanly to a primitive prop surface, the swap is skipped for that occurrence and a `TODO(01-design-system)` comment is left in place. The owning spec is responsible for resolving these during its port.

### STORY-008: As a developer, I want Lucide icons replacing inline SVG and Ionicons so the icon vocabulary matches the prototype

**Acceptance Criteria:**

- 8.1 [ ] `lucide-react-native` added as a dependency.
- 8.2 [ ] Icon mapping table from `CLAUDE_CODE_MIGRATION_PLAN.md` (lines 460–513) implemented as `packages/mobile/src/ui/components/icons.ts` — re-exports the Lucide components under the prototype's IconXxx names for one-line-swap migration.
- 8.3 [ ] Every existing Ionicons import in `packages/mobile/src/ui/` migrated to the new icon module via the adoption sweep (STORY-007). Inline `<Svg>` icon components removed where a Lucide equivalent exists.
- 8.4 [ ] Default stroke width: 1.5 for unselected states, 2 for selected/emphasised states (per the prototype's visual weight). Default colour: `currentColor` so primitives can pass `color={$primary}` / `color={$accentTrainer}` through.
- 8.5 [ ] Icon sizes standardised at 14, 16, 18, 20, 22, 24 (matching the prototype's `<Ico size={...}>` usage). No free-floating icon size values in primitive code.

### STORY-009: As a developer, I want every primitive's render shape verifiable against the prototype so visual regressions are caught before downstream specs adopt them

**Acceptance Criteria:**

- 9.1 [ ] Each primitive PR (foundation + composite) includes screenshots of every documented variant against the prototype's matching states-in-context.
- 9.2 [ ] The `/dev/primitives/<name>` route renders an inventory grid of all variants: e.g. for `<Btn>`, all variant × tone × size combinations on one screen. Used for visual review and a11y testing.
- 9.3 [ ] A reviewer can open `/dev/primitives/Btn` on the device + the design system standalone HTML side-by-side and confirm 1:1 visual parity (allowing for native platform deviations: iOS native press scaling, Android ripple).
- 9.4 [ ] A second smoke-test route `/dev/primitives/composites` renders one usage example of each composite primitive from STORY-004 to verify they all instantiate and look right with default-ish props.

---

## Out of scope

- **Screen-level layout work.** Home, Active session, Workouts list/detail/create/edit, Progress/You, ProfileDrawer composition, Train hub composition — all owned by their respective specs. This spec ships the primitives + adoption-sweep shell replacement; full screen rebuilds happen in the owning specs.
- **Tab bar IA + mode-state slice.** `<TabBar>` primitive ships here as a prop-driven component; the navigation tree, the `useUserMode` Zustand slice, the COACH chrome dot composition with `safe-area-inset-bottom`, and the deep-link redirect for legacy paths are all owned by `14-navigation`.
- **ProfileDrawer screen composition.** `<BottomSheet>` + `<DrawerRow>` + `<Avatar>` + `<Pill>` ship here; the drawer's identity card, mode-switch card, account/subscription/preferences sections, and sign-out are owned by `08-profile-settings`.
- **Active-workout overlay state machine.** The Zustand store + root-mount + AsyncStorage rehydration for the minimise-to-bar pattern are owned by `05-active-session`.
- **Chart libraries.** `<WeeklyVolumeBar>` / muscle-volume / sparkline-style data viz beyond the prototype's hand-rolled SVG approach is owned by `06-progress-goals` if/when a library evaluation is warranted. The composite primitives in STORY-004 deliberately cover only the visual patterns the prototype actually ships.
- **Light theme.** V2 is dark-only. A future spec authors the light surface ramp + verifies trainer/gold/ember tones pass AA on light backgrounds.
- **Deletion of the four `*LegacyTheme` files.** Codemod replaces their internals with token refs; deletion is M11 Polish (`12-production-readiness`).

---

## Dependencies and what this spec unlocks

**Depends on:** nothing in-tree. The handoff package + `_shared/cross-cuts.md` are the only inbound references. This is the bottom of the dependency stack.

**Unlocks:**

| Downstream spec                  | What it composes from here                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `04-workout-management`          | `Card`, `Btn`, `Pill`, `IconBtn`, `Segmented`, `BottomSheet`, `SearchBar`, `Section`; mono stats on duration / exercise counts. **Does NOT consume `<WorkoutCarouselCard>`** — V2's existing list-row `<WorkoutCard>` (at `packages/mobile/src/ui/components/workouts/WorkoutCard/`) remains canonical for the Train hub Workouts list; the carousel card is Home-only. |
| `05-active-session`              | `Card`, `Btn`, `Pill`, `IconBtn`, `HeaderBar`, `MicroPill`, `Section`, `PRCard` (Summary screen); mono on timer / weight / reps / RPE; end-confirm dialog using `BottomSheet`                                                                                                                                                                                           |
| `06-progress-goals` (incl. Home) | `Card`, `Pill`, `Bar`, `Ring` / `MultiRing`, `Stat`, `RingLegend`, `MicroPill`, `PRCard`, `HabitTile`, `WorkoutCarouselCard`, `Section`; mono on streak counters / PR weight / volume                                                                                                                                                                                   |
| `08-profile-settings`            | `Avatar`, `Card`, `Btn`, `IconBtn`, `Pill`, `BottomSheet`, `DrawerRow`, `Section`; mono on subscription expiry / personal stats                                                                                                                                                                                                                                         |
| `10-trainer-features`            | All of the above + `$accentTrainer` family, COACH `Avatar badge`, `Segmented` (3-option Active/All/Archive), `SummaryChip`, `ClientRow`                                                                                                                                                                                                                                 |
| `13-nutrition-tracking`          | `Card`, `Pill`, `Bar`, `Ring`, `Stat`, `BottomSheet`, `MicroPill`, `Section`; mono on calories / macros                                                                                                                                                                                                                                                                 |
| `14-navigation`                  | `TabBar` (mode-aware), `IconBtn` (avatar trigger), Lucide icons, `$accentTrainer` for accent shift, `BottomSheet` (drawer mount point)                                                                                                                                                                                                                                  |

---

## Open questions

None. All ten foundation decisions are locked at the top of this spec. Open questions discovered during implementation should be surfaced as spec amendments (revised-date append blocks), not held in a deferred-decisions list.

---

## Revised 2026-05-29: token-export coexistence during the foundation phase

**Context.** AC 1.1 mandates `tokens.ts` export the full handoff token surface "verbatim". T-1.1.1 phrases this as a verbatim drop-in. Implementation surfaced an ordering conflict against the quality-gate rule that the app must keep rendering and the gate must stay green at every step:

- The pre-existing `tokens.ts` also exports a `colorPalette` const (numbered scale: `primary500`, `neutral1000`, …) consumed as plain JavaScript by six in-tree files (`ErrorBoundary`, `PLogoDrawLoader`, `HomePresenter`, `ActiveSessionBanner`, `homeLegacyTheme`, `themes.ts`) and the existing `space`/`size`/`radius`/`zIndex` numeric scales the current components reference (`$base`, `$md`, `$lg`, `$full`, …).
- The handoff `tokens.tamagui.ts` does **not** define `colorPalette`, omits the legacy `$full`/`$0`/`true` keys, and redefines `size.md` (44 → 12 via `...space`).
- The codemod that retires those legacy references (STORY-006 / Phase 1.6) lands *after* the token PR (Phase 1.1). A pure replace-in-place would red the gate between 1.1 and 1.6.

**Decision (owner rule "LegacyTheme files stay — codemod their internals; deletion is 12-production-readiness", applied to the token export).** `tokens.ts` carries the **handoff token surface verbatim** as the canonical export (`color`, `space`, `size`, `radius`, `zIndex`, `fonts`, `shadow` — values + inline contrast notes copied exactly from `~/Downloads/handoff/tokens.tamagui.ts`). The legacy `colorPalette` const and the legacy numeric `space`/`size`/`radius` keys are **preserved additively** in the same module (merged into the `createTokens` call) until the codemod + adoption sweep retire their consumers. Net effect:

- Every handoff token (`$bg`, `$surface`–`$surface5`, `$text`–`$text5`, `$border`–`$border3`, `$primary` family, `$gold` family, `$accentTrainer` family, `$ember`, `$success`, `$warning`, `$error`, `$info`, the touch-target / tab-bar / header sizes, the radius + z-index ramps) resolves exactly as the prototype intends.
- Legacy `colorPalette` + legacy numeric keys keep resolving so existing screens render unchanged.
- The six colliding **theme** keys (`primary`, `surface`, `success`, `warning`, `error`, `info`) in `themes.ts` are re-pointed to the new palette values — this *is* the intended "token refresh" (e.g. `$primary` shifts `#00D4FF` → `#22D3EE`), applied at the theme layer so no screen edit is required.

Deletion of `colorPalette` and the legacy numeric keys is folded into the same M11 Polish cleanup as the `*LegacyTheme` files (`12-production-readiness`), once the codemod + adoption sweep have removed every consumer.

`createTokens` empirically strips the leading `$` from token keys (verified against `@tamagui/core` 2.0.0-rc): a key authored as `$base` resolves under lookup key `base` and Tamagui reference `$base`. The handoff file's `$`-prefixed keys are therefore reference-compatible with the existing bare-key components — no component edit required for the additive merge.

---

_End of `01-design-system/requirements.md` · 2026-05-27 (rewritten from scratch) · revised 2026-05-29 (token coexistence)_
