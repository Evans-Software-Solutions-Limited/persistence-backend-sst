# BRIEF — Exercise reorder: strip out and rebuild

**Status:** authored 2026-09-07, not started.
**Scope:** `packages/mobile` only. No backend, no migrations, no API change.
**Branch base:** `fix/onboarding-calorie-target-redirect` (carries the compact-mode
commits this brief reverses) or `main` after it lands.

---

## 1. Why this exists

Reorder has been rebuilt twice and is worse each time. Brad's report from the
production build:

> Drag handle and reordering is even more fucked than it was before. The
> holding of it sets it into a reordering mode and doesn't exit off drag, the
> drag also did not work. It would not let me move the items in order. Trying
> to drag to bottom of list when list goes past bottom of page doesn't scroll
> the screen. These feel like fundamentals that should be in the application.

Four symptoms, four distinct causes — all confirmed in code:

| Symptom                                          | Cause                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long-press enters a mode that won't exit on drop | Deliberate. `c80b5a0c` made reorder a sticky `useState`; `onDragEnd` never clears it. Exit is an explicit Done button only.                                                                                                                                                                                                                                                                                                                                 |
| Drag "did not work" / items won't move           | Reorder now needs **two** long-presses — one to enter the mode, a second on the compact row to actually drag. Nothing communicates this.                                                                                                                                                                                                                                                                                                                    |
| No auto-scroll past the bottom of the page       | Real bug, editor/creator only. `NestableDraggableFlatList` inside RNDFL's own `NestableScrollContainer`, bridged by a **one-shot async `measureLayout`**. Entering the mode changes every height above and inside the list; that measure does not reliably re-fire, so `listVerticalOffset` goes stale and the whole edge-detection frame shifts. RNDFL also disables the outer scroll during a drag, so that one hook is the _only_ thing that can scroll. |
| "Fundamentals that should just work"             | **No test in this repo can prove a drag works.** `react-native-draggable-flatlist`, Reanimated and Gesture Handler are all jest-mocked (`__tests__/setup.ts:655`, `:17`, `:78`). The mock hard-codes `isActive: false` and ignores `getItemLayout`, `autoscrollThreshold` and virtualization. No Detox/Maestro. Both commits say so: _"⚠ Verified by test, not on device."_                                                                                 |

**The root cause of the repetition is the last row, not the package.** Every
previous attempt shipped on green gates that were structurally incapable of
failing. Fix that or this recurs a third time.

### 1.1 Reorder is NOT a legacy port — read this before invoking fidelity rules

`grep -rn "reorder" -i` over `../persistence-mobile/` returns **zero matches**.
No drag dependency, no move buttons, no grip icon. Legacy's active workout is a
plain `ScrollView` + `.map()` (`ActiveWorkoutScreen.tsx:116-196`); `sort_order`
is an append counter (`workout-editor.tsx:76`) never mutated after add/remove.

So CLAUDE.md's "UI must match legacy 1:1" rule **gives no answer here** and must
not be used to justify any particular design. The authority is
`specs/31-onboarding-and-experience-polish/requirements.md:229-245`
(STORY-012, "Exercise ordering").

⚠ **Contradiction to resolve before coding:**
`specs/milestones/WORKOUT-AUTHORING-V2/requirements.md:215` says _"No
drag-and-drop beyond the legacy reorder already present"_ — and legacy has
none. Flag to Brad; do not silently pick a reading.

Also note STORY-012's own justification — _"Gesture Handler, Reanimated, and
the root gesture host are already shipped, so this is JS-only and
OTA-compatible"_ — is what motivated adding RNDFL. That premise is now false
(see §2).

---

## 2. Decisions locked by Brad (2026-09-07) — do not re-litigate

1. **Inline drag, done properly.** Drag stays in place on the session and
   editor screens. Not a dedicated reorder route, not move-buttons-only.
2. **Swap the package.** Out: `react-native-draggable-flatlist@4.0.3`. In:
   `react-native-reanimated-dnd@2.0.0`.
3. **Acceptance is a human device pass, stated explicitly.** Green gates do not
   land this PR. See §6.

### Why the package swap

`react-native-draggable-flatlist@4.0.3` was last built against **React 17 / RN
0.64 / Reanimated 2.8** (that is literally its devDependency set). Its peer
range `reanimated >=2.8.0` _admits_ 4.x but was never validated there. It drives
auto-scroll through `measure` (×3) and `scrollTo` (×8) against a
`createAnimatedComponent`-wrapped FlatList — precisely the code path that
changed under the New Architecture, which Expo 55 + Reanimated 4 mandates.

`react-native-reanimated-dnd@2.0.0` (published 2026-03-16) declares
`reanimated >=4.2.0`, `worklets >=0.7.0`, `gesture-handler >=2.28.0`,
`react-native >=0.80`, and was developed against React 19.2.0 / RN 0.83.2 /
Reanimated 4.2.1. **Verified against this repo — every peer is already
satisfied, nothing else needs upgrading:**

| Peer                         | Required | We have |
| ---------------------------- | -------- | ------- |
| react                        | ≥18.0.0  | 19.2.0  |
| react-native                 | ≥0.80.0  | 0.83.4  |
| react-native-reanimated      | ≥4.2.0   | 4.2.1   |
| react-native-worklets        | ≥0.7.0   | 0.7.2   |
| react-native-gesture-handler | ≥2.28.0  | 2.31.1  |

It ships `Sortable` / `useSortableList` with **edge auto-scroll as a
first-class documented feature** — the thing we currently hand-tune with two
different sets of magic numbers.

---

## 3. WP1 — Device spike: DONE, verdict GO (2026-09-07)

Run on the iPhone 17 Pro Max simulator against the live dev build, 20 rows of
72pt inside a scroller carrying a 220pt header. Results:

| Check                                | Result                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| Long-press + drag moves a row        | **PASS** — one continuous gesture, no mode, no second press                       |
| Drop lands where released            | **PASS** — 3-row and 2-row drags both landed exactly                              |
| Auto-scroll at the bottom edge       | **PASS** — held at the edge, list scrolled to the end and carried the row to last |
| Auto-scroll at the top edge          | **PASS** — scrolled back to the top                                               |
| Consistent across consecutive drags  | **PASS** — two drags in a row, committed order matched the screen both times      |
| Header above the list skews the drop | **NO** — the 220pt header did not affect drop accuracy                            |

Four integration rules the spike established. **These are not optional; each
one was a bug before it was fixed:**

1. **`onDrop` is the commit hook, NOT `onMove`.** `onMove` fires per item as
   rows shuffle _mid-drag_ (`useSortable` guards it with `!movingSV.value`, so
   it fires for the items being displaced, not the one being dragged). Treating
   it as "apply this move" corrupted the order immediately — the spike's first
   run produced `4,1,6,3,8,…` against a screen showing `2,3,4,1,…`. Use
   `onDrop(id, position, allPositions)` from `onFinalize` and rebuild the order
   by sorting on `allPositions`.
2. **Pass `containerHeight` explicitly.** `useSortable` defaults it to **500**
   and captures it once in a `useRef`; the library's own `Sortable` wrapper
   never passes it. Left at the default, the auto-scroll trigger edge sits
   ~200pt above the real bottom of the list on a tall phone. Measure the
   viewport with `onLayout` and pass it.
3. **Do NOT use the `Sortable` wrapper component.** Its scroll view hardcodes
   `backgroundColor: "white"` (glaring on this dark theme), it has no header
   slot, it cannot pass `containerHeight`, and it force-remounts on every data
   change via `key={dataHash(data)}` — which resets scroll position after every
   drop. Compose `useSortableList` + `SortableItem` instead.
4. **`positions` is initialised once and never re-synced to `data`.** That is
   why the wrapper force-remounts. Composing the hooks directly, a remount is
   NOT needed for a reorder: `positions` is keyed by id, so once the committed
   array is re-sorted the two agree (verified over consecutive drags). But the
   id **set** changing (add/remove an exercise) WILL desync it — key the
   component on a hash of the _sorted_ ids so add/remove remounts and a plain
   reorder does not.

5. **Non-uniform heights: pass `itemHeight` as a RESOLVER, never
   `enableDynamicHeights`.** Real exercise cards and superset blocks are not
   uniform, so this matters. `enableDynamicHeights: true` is the _async
   measurement_ path and it is **broken** — spiked with rows of 96/168/240pt,
   it rendered rows overlapping each other and left `contentHeight` stuck at
   the estimate (20 x 72 = 1440) because measured heights never converged.
   Passing `itemHeight` as a function instead gives known heights with no
   measurement at all (`needsMeasurement` is gated on `enableDynamicHeights`
   alone): `contentHeight` came out at the exact sum (3120), rows laid out at
   their true heights, and a drag across differently-sized rows dropped
   precisely. Supply the resolver from heights the app measures itself with a
   plain `onLayout` on each row, and give it a fresh identity when those
   heights change so the hook's effect recomputes.
6. **Drag is already a single gesture, and a `Handle` confines it.** The pan is
   `Gesture.Pan().activateAfterLongPress(200)`, so a normal swipe still scrolls
   and a 200ms hold starts the drag — no mode, no second gesture, which is
   exactly the requested model. It is also `.enabled(!hasHandle)`: registering
   a `SortableItem.Handle` disables the whole-item pan and drags only from the
   handle. **Use the Handle** — session cards contain weight/reps `TextInput`s
   and a whole-card pan would fight them.

Not yet spiked, still to verify during the port: mid-drag app backgrounding.

## 4. WP2 — Rip out

Delete outright (exclusive to the current reorder):

- `src/ui/components/workouts/CompactReorderRow.tsx`
- `src/ui/navigation/reorderModalOptions.ts` + its test, and the three spreads
  at `app/(app)/_layout.tsx:183, 197, 208`
- the `jest.mock("react-native-draggable-flatlist", …)` block,
  `__tests__/setup.ts:655-720`
- `react-native-draggable-flatlist` from `packages/mobile/package.json`

Surgery (reorder is entangled with unrelated code — read before cutting):

- `ActiveSessionPresenter.tsx` — 262, 311-313, 329-354, 476-508, 509-526,
  541-558, 603, 635, 650-662, and `styles.dragBlock` / `dragPlaceholder`
  (712, 763). Also clears the four dead imports currently warned by lint
  (`useEffect`, `AppState`, `SharedValue`, `COMPACT_REORDER_ROW_HEIGHT`).
- `WorkoutFormBody.tsx` — 12-18, 185-213, 244/728, 468-608, 622-676.
  ⚠ The `NestableScrollContainer` at 244 is load-bearing for the **entire
  form**, not just the list. See §5.2.
- `SessionExerciseCard.tsx:120-133`, `ActiveSupersetRow.tsx:138-150`,
  `ExerciseConfigCard.tsx:175-184` — the `onMove` / `onDrag` /
  `reorderPosition` / `reorderTotal` / `isDragging` prop quintet.

**Keep — do not rewrite (all surface-agnostic, tested, and the a11y path
depends on them):**

- `reorderExercises` — `src/domain/services/workout.service.ts:167-205`
- `reorderSessionExercisesCommand` —
  `src/application/commands/session/reorder-exercises.command.ts`
- `useWorkoutForm` reducer cases `moveExercise` / `reorderExercise` —
  `src/ui/hooks/useWorkoutForm.tsx:157-200`
- `ExerciseReorderHandle.tsx` — keep the component, but see §5.4: its
  a11y increment/decrement actions are the **only** reorder route currently
  proven by tests and must survive unchanged.

---

## 5. WP3 — Rebuild

### 5.1 One shared component, not three

Today three surfaces share ~60% of the code and reimplement the other 40%
twice, with different list components, different grouping code, different gaps
(10 vs 16) and different autoscroll tuning (`threshold` 48 vs 72, `speed` 60 vs
80, `activationDistance` 20 vs 6). Build **one** `ReorderableExerciseList` and
have the session, editor and creator all consume it. Tuning constants live in
that one module. No per-surface numbers.

### 5.2 Un-nest the editor — the single most important change

The editor's nesting is the auto-scroll bug. Do not try to fix
`measureLayout`; **remove the nesting**:

> The draggable list becomes the editor's only scroller. The name field,
> description, visibility chips and owner toggle move into its
> `ListHeaderComponent`; the footer buttons into `ListFooterComponent`.

This is exactly the shape the **session** surface already has — the one surface
whose auto-scroll is not broken. After this there is no outer scroll container
to fight, no `listVerticalOffset`, and no nested-autoscroll hook.

### 5.3 One gesture, and no sticky mode

Long-press a row's grip → it lifts and drags in the **same** continuous
gesture. Release drops it. There is no separate "reorder mode", no second
long-press, and no Done button. Delete the compact-mode state from both
presenters.

The compact mode existed to dodge a measurement race
(`c80b5a0c`: collapsing-then-`drag()` raced an async `measureLayout`). Removing
the nesting per §5.2 removes that race, and `reanimated-dnd` owns its own
measurement. If rows must shrink while dragging, use the library's own
active-item styling — never a re-layout of the list mid-gesture.

### 5.4 Keep the a11y route exactly as it is

`ExerciseReorderHandle.tsx:43-54` exposes VoiceOver/TalkBack
increment/decrement → `onMove(±1)` → the existing command/reducer. It has no
gesture dependency and is the only reorder path genuinely proven by tests.
It must keep working, unchanged, with identical position announcements.

### 5.5 Collapse the two index spaces

The unit of reordering is a **block** (a superset moves as one), and the block
grouping is currently derived independently in four places:
`reorder-exercises.command.ts:30-47`, `useWorkoutForm.tsx:166-192`,
`ActiveSessionPresenter.tsx:218-251`, `WorkoutFormBody.tsx:187-199`.

Worse, `to` from `onDragEnd` is read as a **block** index
(`reorder-exercises.command.ts:44-47`) while `sourceIndex` is an **exercise**
index (`:25-29`). It works only because of a lookup in between.

Extract **one** exported block-derivation function, use it everywhere, and make
the drag callback speak block indices end to end. Preserve these existing
behaviours (they are deliberate):

- Grouping is by `supersetGroup` value, **not** contiguity
  (`workout.service.ts:178-192`).
- A superset of one renders as a plain card.
- A superset containing any `cardio`/`plyometric` exercise is broken out and
  rendered as individual items (`ActiveSessionPresenter.tsx:225-237`) — which
  is why the session's block list can legitimately differ from the command's.
- Only the lead exercise of a block is draggable.

### 5.6 Persistence is unchanged

Do not touch either path. Session → `reorderSessionExercisesCommand` → local
active-session cache only; order reaches the server in the bulk flush at
Finish (`complete-session.command.ts:189`). Editor/creator → `useWorkoutForm`
reducer, dense `sort_order` renumber from 0, persisted by the normal Save.
No new endpoint, no sync-queue change.

### 5.7 Out of scope

Set-level reordering. `api.port.ts:2286` records it as M11 polish and the
backend ignores `setNumber` on PATCH. The coach program editor
(`ProgramEditorPresenter`) keeps its move-up/down buttons — migrating it to
drag is a follow-up, not this brief.

---

## 6. Acceptance — device pass is the gate

**The jest suite cannot prove any of this. Green gates do not land this PR.**

Standard gates still run and must be clean (prettier, typecheck, lint, build,
`bun run test:unit`), and unit tests must still cover the block-derivation
function, the reducer and the command. But they are a regression net for
arithmetic, not evidence of behaviour.

**The PR does not land until Brad has run `SMOKE_TEST.md` on a physical device
and said it passes.** The PR body must state which device and OS version, and
must not claim verification the agent did not do. If the agent cannot run it,
the PR says "⚠ awaiting device pass" and stops there.

---

## 7. Risks

- **The replacement package fails too.** Mitigated by the WP1 spike gate.
- **§5.2 is a real layout change to the editor form.** Moving fields into
  `ListHeaderComponent` can shift keyboard behaviour and the `nameError` layout.
  Check keyboard-open dragging explicitly.
- **A `Sortable` rewrite touches the superset render path**, which is a genuine
  1:1 legacy port (`ActiveSessionPresenter.tsx:218-251` credits legacy
  `ActiveWorkoutScreen` 83-113). Reordering may change; **rendering must not**.
- **Scope creep into "improving" these screens.** Reorder is V2-original, but
  the cards it reorders are ported. Do not redesign them.

---

## 8. What actually shipped (2026-09-08)

Reorder is **one gesture**: hold a card's grip → the rows collapse to uniform
`CompactReorderRow`s under your finger → the same finger drags → the drop
commits and the cards come back. No button in, no button out, no tap-out, no
timer, no second hold.

§ 5.3's "one gesture, no sticky mode" is therefore met, and the compact view
Brad asked for is kept. Getting both took three attempts, and the reasons the
first two failed are the useful part of this document.

**Attempt 1 — collapse during the drag.** The library seeds the dragged row's
anchor when the pan activates, so collapsing after that left it anchored to
heights that no longer existed. Predicting the shrink (summing what each row
above would lose) under-shot whenever a row had never been laid out, and drifted
worse the further down the list you grabbed.

**Attempt 2 — collapse as a mode, drag as a second gesture.** Correct, and
rejected: two holds to move one row. Brad's words, twice.

**Attempt 3 — collapse BEFORE the drag activates.** `ReorderableList` composes
its own `Gesture.LongPress` at 90ms `Gesture.Simultaneous` with the sortable's
pan, which activates at 200ms. The rows are compact and their heights published
before the library measures anything, so there is nothing to compensate for. Two
things make it work:

- **The drag target lives outside the row's body.** A touch goes to the view the
  finger landed on, so a target inside the body would unmount when the body
  swaps and take the gesture with it. `ReorderableList` puts an invisible 56×56
  Gesture Handler target over the row's top-left corner — where all three
  layouts draw their grip — and swaps only the body beneath it. The cards keep
  drawing their own grip and keep its accessibility.
- **Compact heights need no measurement.** They are uniform and known, so the
  new geometry is published synchronously; a measured height could not land in
  the 110ms available.

**The `itemHeight` claim in earlier versions of this brief was wrong.** The
library is not limited to uniform rows: `enableDynamicHeights` and a per-item
height resolver both exist, and the real cards drag fine. The original failure
was passing ONE height for rows that were not that height, so the slot maths and
the row's own offset disagreed and the drag moved nothing.

Heights are measured by `ReorderableList` itself, not the library:

- The library's own `onLayout` measurement did not always fire. When it does
  not, every row is laid out at `index × estimatedItemHeight` — cards
  overlapping in the session, ~50pt of dead space between editor cards.
- **A row's resting top is computed ONCE, at mount**, as
  `index × estimatedItemHeight`, and corrected only when the measured heights
  CHANGE afterwards. So nothing may remount the rows after the heights are
  known, or every row is stranded at the estimate. This is why
  `containerHeight` is taken from the window at mount rather than measured: a
  measured value has to be re-frozen, re-freezing needs a remount, and the
  remount is fatal.

Other findings worth keeping:

- `containerHeight` must be passed AND must never be 0. It is frozen on first
  render, and `0` does not fall back to the library's 500 default — it makes
  the scroll-down edge test unconditionally true, so any list long enough to
  scroll runs to the end and commits the row at the last index.
- **What the library compares against the auto-scroll edges is the dragged
  row's TOP, in a row space whose origin is the first row** — while the scroll
  offset it compares it to is the scroller's own. Anything above the rows (a
  header, content padding) makes those differ, and the edges go with it. The
  rows' wrapper measures its own offset and the offset handed to the rows is
  shifted by it, which is why the session header no longer has to be pinned
  outside the list.
- `onDrop` is the commit hook. `onMove` fires per DISPLACED row mid-drag.
- **Gesture Handler finalizes FAILED and CANCELLED pans too**, and the library
  forwards them as drops. Treating those as drag ends made a tap, or a scroll
  swipe starting on the grip, behave like a mode exit.
- The grip must never be a Pressable: RN's press responder claims the touch
  before Gesture Handler's pan can activate.
- Row spacing must be padding INSIDE the measured row, never margin — the rows
  are absolutely positioned, so only their own height reaches the sortable.
- Inputs that commit on blur (`Stepper`, `RepRange`) lose the edit when the
  body swaps: unmounting a focused `TextInput` delivers no blur, and no timer
  outwaits a native one. They commit on unmount.
- `buildReorderBlocks` is now shared by the command and the session presenter.
  They disagreed: the presenter splits a cardio-bearing superset into separate
  display rows, the command groups purely by `supersetGroup`, and a drop index
  from one space addressed the wrong block in the other.
- `reorderModalOptions` was NOT dead code. It carried
  `presentation: "fullScreenModal"` and `gestureEnabled: false`; the latter is
  what stops the iOS modal dismiss gesture eating a vertical pan.
