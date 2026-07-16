# Accessibility audit results — spec-12.7 (STORY-002 code-level portion)

An a11y audit of `packages/mobile` identified a set of icon-only interactive
elements with no accessible name (Category A) and touch targets under the
44pt guideline on a handful of icon buttons. This PR is the code-level fix
for both. It does **not** include a device-level VoiceOver/TalkBack
walkthrough — that remains Brad's, as the manual verification step for
STORY-002.

## Category A — missing accessible names (21 elements fixed)

Every element below was an icon-only `Pressable`/`TouchableOpacity` with no
`accessibilityLabel`. Each now has `accessibilityLabel` +
`accessibilityRole="button"` (or `"switch"` for the billing-cycle toggles).
No other element in these files was touched — elements that already had an
accessible name (via visible text, an existing `accessibilityLabel`, etc.)
were deliberately left alone; bulk-adding labels to already-labelled
elements double-announces on screen readers and was explicitly out of
scope.

| File                                                                                | Element                 | Label applied                                                  |
| ----------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------- |
| `components/workouts/AddExercisePopover/AddExercisePopover.tsx`                     | back-to-list            | "Back to list"                                                 |
| `components/workouts/AddExercisePopover/AddExercisePopover.tsx`                     | close/arrow-back        | "Close"                                                        |
| `components/workouts/AddExercisePopover/AddExercisePopover.tsx`                     | clear-search            | "Clear search"                                                 |
| `components/workouts/SwapExercisePopover/SwapExercisePopover.tsx`                   | back-to-list            | "Back to list"                                                 |
| `components/workouts/SwapExercisePopover/SwapExercisePopover.tsx`                   | close                   | "Close"                                                        |
| `components/workouts/SwapExercisePopover/SwapExercisePopover.tsx`                   | clear-search            | "Clear search"                                                 |
| `components/workouts/AddExerciseToSupersetPopover/AddExerciseToSupersetPopover.tsx` | back-to-list            | "Back to list"                                                 |
| `components/workouts/AddExerciseToSupersetPopover/AddExerciseToSupersetPopover.tsx` | close                   | "Close"                                                        |
| `components/workouts/AddExerciseToSupersetPopover/AddExerciseToSupersetPopover.tsx` | clear-search            | "Clear search"                                                 |
| `presenters/WorkoutDetailPresenter.tsx`                                             | close/arrow-back        | "Close"                                                        |
| `presenters/WorkoutDetailPresenter.tsx`                                             | edit                    | "Edit workout"                                                 |
| `presenters/IOSPurchaseFlowPresenter.tsx`                                           | back                    | "Go back"                                                      |
| `presenters/IOSPurchaseFlowPresenter.tsx`                                           | billing-cycle toggle    | "Billing cycle" (`role="switch"`, `checked` = yearly selected) |
| `presenters/SubscriptionSelectionPresenter.tsx`                                     | back                    | "Go back"                                                      |
| `presenters/SubscriptionSelectionPresenter.tsx`                                     | billing-cycle toggle    | "Billing cycle" (`role="switch"`, `checked` = yearly selected) |
| `presenters/ProfilePresenter.tsx`                                                   | profile-picture press   | "Change profile picture"                                       |
| `components/home/WorkoutCard.tsx`                                                   | start button            | "Start workout"                                                |
| `presenters/coach/CoachWorkoutLibraryPresenter.tsx`                                 | back                    | "Go back"                                                      |
| `components/session/ExerciseNotesPopover/ExerciseNotesPopover.tsx`                  | header cancel/close (X) | "Close"                                                        |
| `components/workouts/AddExercisePopover/AddExerciseListItem.tsx`                    | info button             | "Exercise details"                                             |
| `components/Popover.tsx`                                                            | close                   | "Close"                                                        |

That's 21 elements across 12 files. The two billing-cycle toggles
(`IOSPurchaseFlowPresenter`, `SubscriptionSelectionPresenter`) were a
distinct sub-case: a bare `<View>` thumb with no semantics at all, so they
also picked up `accessibilityRole="switch"` and `accessibilityState={{
checked }}` rather than just a label — a screen reader needs to announce
"Billing cycle, switch, on/off", not just a name.

`ProfilePresenter.tsx`'s profile-picture button was fixed to match the
already-correct pattern in `EditProfilePresenter.tsx` (~L277-281), which
already had `accessibilityRole="button"` +
`accessibilityLabel="Change profile picture"` on the equivalent avatar
`Pressable` — `ProfilePresenter` was the one screen missing it.

## Shared pressable primitives — already covered

The shared `Btn`/`IconBtn` primitives in `src/ui/components/` are already
covered by the existing a11y regression suite at
`src/ui/components/__tests__/a11y-audit.test.tsx`. This PR does not
duplicate that coverage — it only touches the screen/feature-level
icon-only elements the audit found were built directly on raw
`Pressable`/`TouchableOpacity` rather than through those primitives.

## Category B — already labelled (left untouched)

The audit found roughly 60 additional interactive elements across the app
that already carry an accessible name — either visible `Text` content next
to/inside the pressable, an existing `accessibilityLabel`, or a
`testID`-only element that VoiceOver still announces via its text content
(e.g. menu rows with a label + chevron, CTA buttons with a text child).
These were deliberately **left untouched**: adding an explicit
`accessibilityLabel` on top of an element whose accessible name is already
derived from visible text would cause the screen reader to announce the
label twice (once from the explicit label, once from the auto-derived
name), which is a regression, not a fix.

## Touch targets — `hitSlop` additions

Four icon buttons had a footprint under the 44pt guideline. Rather than
changing their visual size (out of scope — this port must stay 1:1 with
legacy), each got `hitSlop={8}`, which expands the _touch_ area ~8px on
every side without any visual change:

- `components/home/WorkoutCard.tsx` — start button (`styles.startButton`,
  40×40).
- `presenters/WorkoutDetailPresenter.tsx` — close + edit icon buttons
  (`styles.iconButton`, ~40pt).
- `components/Popover.tsx` — close button (`styles.closeButton`, ~40pt).

No width/height/padding was changed on any of these.

## Other findings

Only one file in the codebase used `accessibilityHint` prior to this PR.
No existing `accessibilityHint` usage was touched by this change.

## Tests

Each Category-A file that already had a test file got one lightweight
assertion added, following that file's existing query style (RNTL,
predominantly `testID`-based) but querying the new elements by their
accessible name via `getByLabelText`/`findByLabelText` — proving the label
is now present and queryable, without re-testing behaviour the file's
existing tests already cover:

- `components/workouts/__tests__/AddExercisePopover.test.tsx`
- `components/workouts/SwapExercisePopover/__tests__/SwapExercisePopover.test.tsx`
- `components/workouts/AddExerciseToSupersetPopover/__tests__/AddExerciseToSupersetPopover.test.tsx`
- `presenters/__tests__/WorkoutDetailPresenter.test.tsx`
- `presenters/__tests__/IOSPurchaseFlowPresenter.test.tsx`
- `presenters/__tests__/SubscriptionSelectionPresenter.test.tsx`
- `presenters/__tests__/ProfilePresenter.test.tsx`
- `components/home/__tests__/WorkoutCard.test.tsx`
- `components/session/ExerciseNotesPopover/__tests__/ExerciseNotesPopover.test.tsx`

Three Category-A files had no existing test file, and none was created
purely for this a11y pass (per the brief — no test-file-for-test's-sake):

- `presenters/coach/CoachWorkoutLibraryPresenter.tsx`
- `components/workouts/AddExercisePopover/AddExerciseListItem.tsx`
- `components/Popover.tsx`

## What's NOT in this PR

The manual VoiceOver (iOS) / TalkBack (Android) device walkthrough — actually
turning on a screen reader and swiping through these flows on a real device
— remains Brad's to do. This PR is the code-level portion of STORY-002 only.
