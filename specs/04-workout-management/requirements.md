# 04 — Workout Management: Requirements

> **Spec rewritten from scratch on 2026-05-27** to absorb the May 2026 design package. Prior version preserved in git history.

---

## Overview

Workout templates and the exercise library — the read/write/browse layer that feeds the Active session. Under the new Option 3 navigation (per `14-navigation`), both surfaces live under the **Train** tab via a `<Segmented>` switcher: `Workouts` and `Exercises`. The data architecture is unchanged from V2 — same containers, same hooks, same SST endpoints, same offline-first SQLite cache + sync queue. The presentation layer adopts the new design package tokens + primitives.

Authoritative references:

1. `~/Downloads/handoff/design-source/screens/library.jsx` — workouts list + exercises list visual patterns (self-described as "REFERENCE — preserving current patterns, only refresh chrome/colors to match new palette")
2. `~/Downloads/handoff/design-source/screens/create-exercise.jsx` — Create Exercise as a `<BottomSheet>` (V2 currently has it as a full-screen route — this is a change)
3. `~/Downloads/handoff/design-source/prototype-hubs.jsx` lines 9–147 — Train hub composition with `<Segmented>` switcher
4. `docs/design-port-audit.md` § "Workouts list / detail / create / edit"

Legacy reference (V1 behavioural source of truth per `_agent.md`): `../persistence-mobile/app/(tabs)/workouts.tsx`, `workout-creator.tsx`, `workout-editor.tsx`, `exercises.tsx`, `exercise-creator.tsx`, `exercise-editor.tsx`, `exercise-details/[id].tsx`.

---

## Locked decisions

| #   | Decision                | Locked value                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Workouts list location  | Inside Train hub, `<Segmented>` value `'Workouts'`. The standalone `/workouts` route is removed (per `14-navigation` route migration table).                                                                                                                                                                                                                                                                                                                            |
| 2   | Exercises list location | Inside Train hub, `<Segmented>` value `'Exercises'`. The standalone `/exercises` tab route is removed.                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | Workout detail          | Full-screen route at `(app)/workouts/[id]/index.tsx` (V2's current shape, PR #41) — preserved.                                                                                                                                                                                                                                                                                                                                                                          |
| 4   | Workout create + edit   | Full-screen routes at `(app)/workouts/create.tsx` and `(app)/workouts/[id]/edit.tsx` (V2's current shape) — preserved with token + primitive refresh.                                                                                                                                                                                                                                                                                                                   |
| 5   | Exercise detail         | Full-screen route at `(app)/exercises/[id].tsx` (V2's current shape) — preserved with token + primitive refresh.                                                                                                                                                                                                                                                                                                                                                        |
| 6   | Exercise create         | **Full-screen route** at `(app)/exercises/create.tsx`, pushed from the Train > Exercises `+ Create` action + the empty-state CTA. Form content per `design-source/screens/create-exercise.jsx`. _(Revised 2026-06-03: the design package specced a `<BottomSheet>`, but the long form needed reliable scroll/keyboard handling the gorhom sheet fought on device — full-screen matches the legacy creator + the 04.6 editor. Brad signed off. See STORY-006 revision.)_ |
| 7   | Exercise edit           | Stays as full-screen route at `(app)/exercises/[id]/edit.tsx` (no equivalent sheet pattern in the prototype).                                                                                                                                                                                                                                                                                                                                                           |
| 8   | Workout row pattern     | Per `library.jsx:64–82` — 40×40 toned icon tile + name + meta + tone-accented badge + 32pt Play IconBtn on the right.                                                                                                                                                                                                                                                                                                                                                   |
| 9   | Exercise card pattern   | Per `library.jsx:145–165` — `<Card>` with 3pt left-border in `$primary`, name + level Pill (size xs, tone derived from level: Beginner→success, Intermediate→gold, Advanced→error), description body, primary muscle Pill + neutral Pills for tags.                                                                                                                                                                                                                     |
| 10  | Quick actions           | The current V2 `QuickActions` row on the standalone `/workouts` screen is replaced by the contextual right-action in the Train hub header (per `14-navigation` STORY-005 AC 5.4): `<IconSearch>` for Workouts segment, `+ Create` Btn for Exercises segment.                                                                                                                                                                                                            |
| 11  | Offline-first           | All reads + writes go through the existing V2 cache + sync queue. No backend changes in this spec.                                                                                                                                                                                                                                                                                                                                                                      |

---

## User stories

### STORY-001: As a user, I want to see my workouts under the Train tab's Workouts segment so I can pick one to run

**Acceptance Criteria:**

- 1.1 [ ] Train > Workouts renders three sections (per legacy V2 behaviour): **Mine** (`createdBy = me`), **Assigned** (PT-assigned via `workout_assignments`), **Default** (`visibility = public` and not mine). Per legacy `(tabs)/workouts.tsx`.
- 1.2 [ ] Each row uses the `<WorkoutRow>` pattern from `library.jsx:64–82` — 40×40 toned icon tile (`<IconDumbbell>`) + name + meta line (`{mins}m · {ex} exercises · {badge}`) + 32pt `<IconBtn>` with `<IconPlay>` on the right.
- 1.3 [ ] Section grouping uses `<Section>` composite from `01-design-system` STORY-004 with `title` + `sub` (e.g. "My Workouts" / "4 created · 2 assigned").
- 1.4 [ ] Sections are expandable / collapsible; collapse state is local to the screen instance.
- 1.5 [ ] Tap-to-detail: row tap navigates to `(app)/workouts/[id]/index.tsx`. The `<IconPlay>` button starts the session directly (calls `useStartSession()` — existing V2 hook).
- 1.6 [ ] Long-press on row (owner only): shows context menu with Edit + Delete (matches legacy). For non-owners: no context menu.
- 1.7 [ ] Loading from local cache first, background API refresh; cache TTL 5 min per `_agent.md § Offline-First Architecture` — unchanged from V2.
- 1.8 [ ] Empty state per section: "No workouts yet" copy with a "Create your first workout" CTA on the Mine section. Uses new `<Btn>` + `<EmptyState>` primitives.
- 1.9 [ ] Pull-to-refresh refetches all three section calls in parallel; bypasses TTL — unchanged from V2.
- 1.10 [ ] Quota indicator: when `useGetUserSubscription().data.workoutLimit !== null`, renders `<WorkoutLimitIndicator>` with `used / limit`; tap routes to subscription upgrade (`(app)/coming-soon` until M10 ships subscription management surface — currently shipped, point to `/(app)/subscription-management`).

### STORY-002: As a user, I want to create a new workout

**Acceptance Criteria:**

- 2.1 [ ] Top of Train > Workouts renders a primary `<Btn variant="filled" tone="primary" size="lg" full icon={<IconPlus/>}>Create Workout</Btn>` per `library.jsx:12`.
- 2.2 [ ] Tap navigates to `(app)/workouts/create.tsx` (full-screen modal stack).
- 2.3 [ ] Form fields per V2 legacy + locked decisions: name (required, non-empty after trim), description (optional), estimated duration (number, default 30, editable).
- 2.4 [ ] Add exercises via `<AddExercisePopover>` bottom sheet — preserved from V2. Searches the exercise library (data: `useGetExercises`).
- 2.5 [ ] Picker has two action CTAs: **Add as exercises** (each selected exercise added with its own `supersetGroup = null`) and **Add as superset** (all selected exercises share a new `supersetGroup`, requires ≥ 2 selections). Preserved from V2.
- 2.6 [ ] Exercises in the form render as `<ExerciseConfigCard>`s with editable `targetSets`, `targetRepsMin`–`targetRepsMax`, `restSeconds`. Superset peers visually disabled and mirror the lead exercise's values.
- 2.7 [ ] Editing `targetSets` or `restSeconds` on the lead exercise of a superset propagates to all peers (`propagateSupersetSharedFields` pure function — preserved).
- 2.8 [ ] Validation on submit: name required + non-empty; ≥ 1 exercise; `targetRepsMin <= targetRepsMax`; `targetSets >= 1` when set.
- 2.9 [ ] Submit posts a single `POST /workouts` with the full nested `exercises[]`; backend transaction guarantees atomic create.
- 2.10 [ ] **Offline support:** if offline at submit, the mutation queues in the sync queue (existing V2 pattern). Local cache updated optimistically with a tombstoned row; sync engine commits when connectivity resumes.
- 2.11 [ ] On success, navigates back to Train > Workouts (`router.back()`) and the new workout appears under Mine; cache is updated optimistically with the server-returned row.
- 2.12 [ ] Dirty-form back-navigation prompts a "Discard changes?" confirmation; clean-form back-nav navigates without prompt.

### STORY-003: As a user, I want to view a workout's details before I start a session

**Acceptance Criteria:**

- 3.1 [ ] Route `(app)/workouts/[id]/index.tsx` renders the workout detail. Sticky safe-area header with `<HeaderBar>` carrying the workout name + Edit IconBtn (owner only) + close IconBtn.
- 3.2 [ ] Body shows: description (if present), exercise list (each row = `<ExerciseRow>` with set count + target rep range + rest), Start CTA at the bottom.
- 3.3 [ ] Each exercise row taps through to `(app)/exercises/[id].tsx`.
- 3.4 [ ] Start CTA calls `useStartSession({ workoutId })` (existing V2 hook) and navigates to `(app)/session/index.tsx` — owned by `05-active-session`.
- 3.5 [ ] Read uses local cache first (`useGetWorkoutById(id)`) — same offline behaviour as V2.
- 3.6 [ ] Superset groups render as a connected visual cluster — bracket on the left side of grouped exercise rows.

### STORY-004: As a user, I want to edit a workout I own

**Acceptance Criteria:**

- 4.1 [ ] Route `(app)/workouts/[id]/edit.tsx` renders the same form shape as create (STORY-002), pre-populated.
- 4.2 [ ] Submit posts `PUT /workouts/:id` with the full nested representation. Server replaces the nested `exercises[]` atomically.
- 4.3 [ ] Offline: mutation queues, optimistic local update, sync on reconnect.
- 4.4 [ ] Owner-only — non-owners get a 403 + read-only banner; Edit IconBtn doesn't render for non-owners.
- 4.5 [ ] Delete action available in the header overflow menu (owner only) — confirmation modal → `DELETE /workouts/:id` → `router.back()` → workout disappears from Mine section.

### STORY-005: As a user, I want to browse my exercise library under the Train tab's Exercises segment

**Acceptance Criteria:**

- 5.1 [ ] Train > Exercises renders a `<SearchBar>` (`01-design-system` composite) + horizontally-scrolling filter chip row + vertical list of `<ExerciseCard>`s.
- 5.2 [ ] Filter chips per `library.jsx:107–113`: filter IconBtn + `All` (default active) + `My Exercises` + `System` + `Beginner` + `Chest` + `Back` + … Tap toggles the active filter.
- 5.3 [ ] Filter sub-routes at `(app)/exercises/filters/{index,muscles,equipment,created-by,difficulty}.tsx` (V2's existing filter route tree) are preserved. The filter IconBtn opens the filter index modal.
- 5.4 [ ] Search field filters by exercise name (case-insensitive substring) live as the user types.
- 5.5 [ ] Each exercise card uses the new visual contract from `library.jsx:145–165`: `<Card>` with 3pt left-border in tone derived from primary muscle (or `$primary` as default), name + level `<Pill size="xs" tone={…}>` (Beginner→success, Intermediate→gold, Advanced→error), description body, primary muscle Pill + neutral Pills for tags.
- 5.6 [ ] Tap on card → `(app)/exercises/[id].tsx`.
- 5.7 [ ] Reads via `useGetExercises()` (existing V2 hook) with 5-min TTL cache; pull-to-refresh bypasses TTL.

### STORY-006: As a user, I want to create a new exercise from a bottom-sheet sheet inside the Train hub

**Acceptance Criteria:**

- 6.1 [ ] The `+ Create` contextual action in the Train hub header (when on Exercises segment) opens a `<BottomSheet>` at 88% height titled "New exercise" / eyebrow "MY EXERCISES" / accent "primary". Per `create-exercise.jsx:50`.
- 6.2 [ ] Sheet content per `create-exercise.jsx:51–203`:
  - Name (text input, required, autoFocus)
  - Optional photo / video link upload area (aspect ratio 16:7, dashed border, `<IconCamera>` 22pt + label)
  - Primary muscle (radio chips: Chest, Back, Legs, Shoulders, Arms, Core, Cardio — `$primary` active, `$primaryDim` background when active)
  - Secondary muscles (multi-select chips: all muscles except the primary, `$primary` border + `$primaryDim` bg when selected, `<IconCheck>` 10pt prefix)
  - Equipment (radio chips: Barbell, Dumbbell, Machine, Cable, Bodyweight, Kettlebell, Band — gold tone when selected)
  - Level (radio 3-column grid: Beginner → success, Intermediate → gold, Advanced → error)
  - Notes & instructions (multiline textarea, min 88pt height, optional)
  - Preview chip (gradient `$primaryDim` to `$surface2`, shows the live preview with PRIMARY + EQUIPMENT + LEVEL + first 2 secondary pills + `+N` overflow pill)
  - Footer: Cancel (outline) + Save (filled, disabled until name is non-empty) — flex 1 / flex 2
- 6.3 [ ] Save submits via `POST /exercises` (existing V2 endpoint). Body shape matches the V2 mutation type.
- 6.4 [ ] Offline: mutation queues, optimistic local cache write, sync on reconnect.
- 6.5 [ ] On success, sheet closes with a 700ms "Saved ✓" affirmation per `create-exercise.jsx:43–47`, and the new exercise appears at the top of the Mine filter on the Exercises segment.
- 6.6 [ ] The full-screen `(app)/exercises/create.tsx` route is **DELETED** — the sheet replaces it. Deep links pointing to `/exercises/create` redirect to opening the sheet over the current segment.

> **Revised 2026-06-03 (Phase 04.3 — full-screen, not a sheet):** STORY-006's "bottom-sheet" framing (title + ACs 6.1, 6.2, 6.5, 6.6) is **superseded** — create is a **full-screen route** (`(app)/exercises/create.tsx`), not a `<BottomSheet>`. Why: the 8-section form needs reliable scrolling + keyboard handling, which the gorhom sheet kept fighting on device (multiple fix attempts failed); full-screen matches the legacy creator + the 04.6 editor and reuses the same `<ExerciseFormFields>`. Brad signed off the design-package deviation (2026-06-03). Concretely: AC 6.1 → the `+ Create` action (and the empty-state CTA) `router.push` the full-screen route with a `<HeaderBar>` (close + "New exercise"), a scrolling body, and a sticky Cancel/Save footer. AC 6.5 → on success the Save button shows "Saved ✓" for 700ms then the route pops. AC 6.6 → `create.tsx` is a real route again (no redirect stub / no deep-link 404 concern; the `useCreateExerciseSheet` open-state store + the root-layout mount introduced for the sheet are removed).
>
> **Revised 2026-06-02 (Phase 04.3 — Cardio dropped):** The prototype lists `Cardio` in the PRIMARY MUSCLE radio set (AC 6.2), but V2's `validateExerciseInput` requires ≥1 primary muscle group and there is no `cardio`/`full-body` entry in the `MuscleGroup` enum, so the design's `Cardio → []` conversion fails validation on Save. The picker ships with the six remaining muscles (Chest, Back, Legs, Shoulders, Arms, Core); `category` is always `strength`. Treating Cardio as a first-class _category_ (its own muscle-optional path) is a larger, dedicated future slice — deferred per Brad's call (2026-06-02).

### STORY-007: As a user, I want to view an exercise's full detail

**Acceptance Criteria:**

- 7.1 [ ] Route `(app)/exercises/[id].tsx` renders the exercise detail. Header with name + level pill + Edit IconBtn (owner only).
- 7.2 [ ] Body: optional photo/video, description, primary muscle + secondary muscles list, equipment, instructions, related-exercises section.
- 7.3 [ ] Owner-only Edit IconBtn opens `(app)/exercises/[id]/edit.tsx` (full-screen route, V2's current shape).

### STORY-008: As a user, I want to edit an exercise I created

**Acceptance Criteria:**

- 8.1 [ ] Route `(app)/exercises/[id]/edit.tsx` renders the same form fields as the Create Exercise sheet (STORY-006) — but as a full-screen route, not a sheet (per locked decision #7).
- 8.2 [ ] Submit via `PUT /exercises/:id` (existing V2 endpoint).
- 8.3 [ ] Offline: mutation queues + optimistic.
- 8.4 [ ] Owner-only — non-owners get a 403 + read-only banner.

### STORY-009: As a developer, I want the data layer unchanged so the existing 90% coverage holds and the sync engine doesn't regress

**Acceptance Criteria:**

- 9.1 [ ] No SST routes added or modified. Existing endpoints: `GET /workouts`, `GET /workouts/:id`, `POST /workouts`, `PUT /workouts/:id`, `DELETE /workouts/:id`, `GET /exercises`, `GET /exercises/:id`, `POST /exercises`, `PUT /exercises/:id`, `DELETE /exercises/:id` — all consumed as-is.
- 9.2 [ ] No Drizzle migrations.
- 9.3 [ ] No changes to `domain/ports/api.port.ts` or the sync-queue handlers.
- 9.4 [ ] The existing 90% coverage on `packages/mobile/src/application/workouts/**` + `application/exercises/**` is preserved — no behavioural changes to the application layer.

---

## Out of scope

- **Train hub composition** — owned by `14-navigation`. This spec ships the segment content; the hub shell (Segmented control + header) lives there.
- **Active session execution** — owned by `05-active-session`. This spec hands off via `useStartSession({ workoutId })`.
- **PT workout assignment + on-behalf logging** — owned by `10-trainer-features`. Workout-assignment reads consumed here (`Assigned` section); assignment mutations live in 10.
- **Workout streaks + PR detection** — owned by `06-progress-goals`. This spec doesn't compute or render streak / PR data; consumers do.
- **Backend additions** — none. Pure presentation refresh + new sheet pattern.
- **Existing `<WorkoutCard>` rename** — V2's existing list-row `<WorkoutCard>` at `packages/mobile/src/ui/components/workouts/WorkoutCard/` stays. The Home carousel uses the separate `<WorkoutCarouselCard>` (per `01-design-system` locked decision discussion).
  - **Revised 2026-06-01 (Phase 04.1):** the list-row `<WorkoutCard>` (and the now-orphaned `<QuickActions>`) are **deleted** — Phase 04.1 replaces the workouts list rows with the new `<WorkoutRow>` composite and the inline Create/Browse CTAs, leaving both components with no importers. They were only ever exercised transitively by the old `WorkoutsListPresenter` tests, so keeping them would be untested dead code. `<WorkoutCarouselCard>` (Home carousel) and `components/home/WorkoutCard.tsx` are unaffected.

---

## Dependencies and what this spec unlocks

**Depends on:**

| Spec               | What's consumed                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `01-design-system` | `<Card>`, `<Btn>`, `<Pill>`, `<IconBtn>`, `<BottomSheet>`, `<HeaderBar>`, `<Segmented>`, `<SearchBar>`, `<Section>`, Lucide icons, tokens |
| `14-navigation`    | Train hub shell + Segmented switcher + AsyncStorage segment persistence                                                                   |

**Unlocks:**

| Downstream spec       | What it can do once 04 lands                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `05-active-session`   | `useStartSession({ workoutId })` resolves; workout detail screen has consistent visual chrome          |
| `06-progress-goals`   | Workout cards in Home carousel reuse `<WorkoutCarouselCard>`; PR tracking reads from session data      |
| `10-trainer-features` | PT can browse client's workouts via the same hub; assignment mutations populate the `Assigned` section |

---

## Open questions

None. All 11 locked decisions captured at the top. Any discovered ambiguity surfaces as a "**Revised YYYY-MM-DD:**" append.

---

---

## Revised 2026-06-01 (Phase 04.1 — prototype fidelity)

Phase 04.1 was built against the **canonical Train-hub composition** in `~/Downloads/handoff/design-source/prototype-hubs.jsx` (`TrainWorkoutsContent`, lines 44–92), which is the authoritative Option-3 IA per `docs/design-port-audit.md`. The earlier ACs leaned on the standalone `library.jsx` "reference" screen, which differs. The prototype-faithful structure (signed off by owner) supersedes these ACs:

- **Two sections, not three** (overrides AC 1.1): `MY WORKOUTS · {N} SAVED` (mine **+** assigned combined) and `TEMPLATES · {N}` (public defaults). No standalone "Assigned" section.
- **Eyebrow labels, not title+sub** (overrides AC 1.3): sections use the `<Section eyebrow>` uppercase label (`p-eyebrow`), e.g. `MY WORKOUTS · 4 SAVED` / `TEMPLATES · 3` — not a large title with a subtitle.
- **Row variants**: My-Workouts rows = Dumbbell tile + Play `<IconBtn>` (start); Template rows = Book tile + chevron (open only — templates aren't started directly from the row).
- **No "Browse Exercises" button** — the prototype's `TrainWorkoutsContent` has none (the Segmented switcher is the exercises entry point). Only the full-width **Create Workout** CTA at the top (prototype line 47) is kept.
- **Empty My-Workouts state** carries no Create CTA — the top Create Workout button is the single create path.
- **Colored tile + split badge** (`PUSH`/`PULL`/`LEGS`/`UPPER`/`LOWER`/`FULL`/`CORE`/`MOB`/`CARDIO`): the prototype's per-row tone + badge are hand-assigned mock values (the V2 `Workout` carries no split field, and the trimmed `WorkoutExerciseRef` no muscle groups). The split is therefore **derived client-side** by `classifyWorkoutSplit` (`domain/services/workoutSplit.ts`) — joining each exercise's `exerciseId` against the **cached exercise library** for muscle groups, plus the exercise `category` for the cardio/mobility override. PPL specifics (`push`/`pull`/`legs`/`core`) take priority over `upper`/`lower`, then `full`. Tone follows the split (push→primary, pull→gold, legs/lower/full→ember, upper/core→trainer, mobility→success, cardio→error). Workouts whose exercises aren't cached yet (cold start) fall back to a neutral `primary` tile with **no** badge — no invented data. No backend change (the more-robust muscle aggregation on the workout response remains the `TODO(M4)`).

_End of `04-workout-management/requirements.md` · 2026-05-27 (rewritten from scratch) · revised 2026-06-01 (Phase 04.1 prototype fidelity)_
