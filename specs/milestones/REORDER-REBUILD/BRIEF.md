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

Not yet spiked, still to verify during the port: mid-drag app backgrounding,
and dynamic (non-uniform) item heights — needed because real exercise cards
are not uniform, see § 5.3.

## 4. WP2 — Rip out

Delete outright (exclusive to the current reorder):

- `src/ui/presenters/session/compactReorderLayout.ts` + its test
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
