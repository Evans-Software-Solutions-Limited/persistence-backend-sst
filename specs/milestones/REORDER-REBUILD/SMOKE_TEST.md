# SMOKE TEST — Exercise reorder rebuild

**Physical device, release-ish build. This document is the acceptance gate for
`BRIEF.md` — the jest suite cannot prove any of it (drag, Reanimated and
Gesture Handler are all mocked).**

Record device + OS version. Every box must be ticked by a human.

---

## A. Active session (`session/index`)

Set up: start a session with **8+ exercises**, including one superset, so the
list is longer than the viewport.

- [ ] A1 — Hold a grip. The rows collapse to compact rows **under your
      finger**, without you lifting it. No button was tapped to get here.
- [ ] A1b — Keep holding and drag. The row follows your finger.
- [ ] A1c — Release. The drop commits AND the full cards come back. Nothing to
      tap, in or out.
- [ ] A2 — Drag it down 3 positions and release. It lands where dropped.
- [ ] A3 — Drag it back up 3 positions. It lands where dropped.
- [ ] A4 — **Drag to the bottom edge of the screen. The list auto-scrolls.**
      Keep holding until the last row is reached.
- [ ] A5 — **Drag to the top edge. The list auto-scrolls back up.**
- [ ] A5b — With the keyboard open from a reps field, hold a grip and drag to
      the bottom edge. It still auto-scrolls.
- [ ] A6 — Drag a **superset** block. The whole block is ONE compact row, moves
      together, and stays contiguous.
- [ ] A7 — A superset containing a cardio or plyometric exercise still renders
      as individual cards at rest, and still moves as one block.
- [ ] A8 — Lift a row and release it in its own slot. Nothing reorders, and the
      cards come back.
- [ ] A8b — **Tap** a grip without holding. The rows may flash compact, and
      must come straight back — you are never left in compact with nothing to
      undo it.
- [ ] A8c — Start a **scroll swipe** on a grip. It scrolls, does not reorder,
      and does not leave the list compact.
- [ ] A9 — Background the app mid-drag, then return. The row settles, the cards
      are back, and the list is still draggable and scrollable.
- [ ] A10 — Scroll the list normally (short swipe on a card, no hold). It
      scrolls and does **not** start a drag.
- [ ] A11 — Log a set, then reorder, then log another. Set data follows the
      right exercise.
- [ ] A12 — Reorder, Finish the workout, reopen it from history. The saved
      order matches what was on screen.
- [ ] A13 — Reorder while offline (airplane mode), then Finish. Order survives.
- [ ] A14 — Cards are evenly spaced at rest: no overlap, and no wide dead gaps
      between them. (Both were real bugs — the rows are measured, and a
      mis-measured list shows up exactly here.)

## B. Workout editor (`workouts/[id]/edit`)

Set up: open an existing workout with **8+ exercises**.

- [ ] B1 — A1–A8c and A14 all hold here too (one gesture, drop accuracy both
      directions, **both auto-scroll edges**, superset as a block, even
      spacing).
- [ ] B2 — The form fields (name, description, visibility, owner toggle) sit
      above the cards, are editable, and **scroll with them as one surface**.
      They stay put while the rows are collapsed.
- [ ] B3 — Focus the name field so the keyboard is open, dismiss it, then drag.
      Auto-scroll still works.
- [ ] B3b — With the keyboard STILL OPEN, hold a grip to collapse. Auto-scroll
      to the bottom still works. (The list is measured as it mounts, so a
      keyboard-shrunk first measurement used to stick for the whole mode.)
- [ ] B3c — Focus a Sets field, type a new number, then hold a grip WITHOUT
      tapping elsewhere and complete a drag. The new number is still there
      afterwards. (Those fields commit on blur, and unmounting a focused input
      never delivers one — they commit on unmount instead.)
- [ ] B4 — Trigger the name validation error, then drag. The drag frame is not
      offset by the error text appearing.
- [ ] B5 — Reorder, Save, reopen. The new order persisted.
- [ ] B6 — Reorder, then leave without saving. The order is **not** persisted.
- [ ] B7 — Swipe-back / navigate away mid-drag. No crash, no stuck row.

## C. Workout creator (`workouts/create`)

- [ ] C1 — B1 holds (same shared body — confirm it was not special-cased).
- [ ] C2 — Add exercises, reorder them, Save. Order persists on the new workout.

## D. Accessibility (must be unchanged)

Enable VoiceOver (iOS) or TalkBack (Android).

- [ ] D1 — Focus a grip on a card. "Move up" / "Move down" actions are
      offered. They are withheld on the COMPACT rows on purpose — a move
      arriving from outside a drag would desync the sortable's position map.
- [ ] D2 — Both actually move the exercise.
- [ ] D3 — The new position is announced.
- [ ] D4 — On a superset lead, the whole block moves.

## E. Regression sweep on the ported cards

- [ ] E1 — Session exercise cards render identically to before this change
      (spacing, superset grouping, set rows, rest timer).
- [ ] E2 — Editor exercise config cards render identically to before.
- [ ] E3 — Coach program editor still reorders via its move-up/down buttons.

---

## Sign-off

- Device / OS:
- Build (branch + short sha):
- Result: PASS / FAIL
- Notes:

Any FAIL blocks the PR. Do not record a partial pass as a pass.
