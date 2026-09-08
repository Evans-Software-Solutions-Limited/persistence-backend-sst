# SMOKE TEST — Exercise reorder rebuild

**Physical device, release-ish build. This document is the acceptance gate for
`BRIEF.md` — the jest suite cannot prove any of it (drag, Reanimated and
Gesture Handler are all mocked).**

Record device + OS version. Every box must be ticked by a human.

---

## A. Active session (`session/index`)

Set up: start a session with **8+ exercises**, including one superset, so the
list is longer than the viewport.

- [ ] A1 — Hold a grip. The list collapses to uniform compact rows. **No
      button was tapped to get here**, and no button appears to get out.
- [ ] A1b — Hold a grip on a compact row and drag. The row lifts and follows
      your finger.
- [ ] A1c — Release it. The drop commits AND the full cards come back — you are
      out of compact mode with nothing to tap.
- [ ] A2 — Drag it down 3 positions and release. It lands where dropped.
- [ ] A3 — Drag it back up 3 positions. It lands where dropped.
- [ ] A4 — **Drag to the bottom edge of the screen. The list auto-scrolls.**
      Keep holding until the last row is reached.
- [ ] A5 — **Drag to the top edge. The list auto-scrolls back up.**
- [ ] A5b — With the keyboard open from a reps field, hold a grip to collapse,
      then drag to the bottom edge. It still auto-scrolls.
- [ ] A6 — Drag a **superset** block. The whole block moves together and stays
      contiguous.
- [ ] A7 — A superset containing a cardio or plyometric exercise still renders
      as individual rows (unchanged from before).
- [ ] A8 — Lift a row and release it in its own slot. Nothing reorders, and
      compact mode still exits.
- [ ] A8b — In compact mode, **tap** a grip (no hold) and then **short-swipe**
      to scroll from a grip. Neither exits compact mode — only a real drop
      does. (Gesture Handler finalizes failed pans too, so these used to read
      as drag ends and behave like the tap-out that was rejected.)
- [ ] A9 — Background the app mid-drag, then return. The row settles and the
      list is still draggable and scrollable.
- [ ] A10 — Scroll the full-card list normally (short swipe, no hold). It
      scrolls, does **not** start a drag, and does not collapse.
- [ ] A11 — Log a set, then reorder, then log another. Set data follows the
      right exercise.
- [ ] A12 — Reorder, Finish the workout, reopen it from history. The saved
      order matches what was on screen.
- [ ] A13 — Reorder while offline (airplane mode), then Finish. Order survives.

## B. Workout editor (`workouts/[id]/edit`)

Set up: open an existing workout with **8+ exercises**.

- [ ] B1 — A1–A8b all hold here too (hold-to-collapse with no button,
      hold-and-drag, drop commits and exits, drop accuracy both directions,
      **both auto-scroll edges**, superset as a block).
- [ ] B2 — Idle, the form fields (name, description, visibility, owner toggle)
      are present and editable above the cards. In compact mode the form is
      out of the way and the compact list is the only scroller; it comes back
      on drop.
- [ ] B3 — Focus the name field so the keyboard is open, dismiss it, then drag.
      Auto-scroll still works.
- [ ] B3b — With the keyboard STILL OPEN, hold a grip to collapse. Auto-scroll
      to the bottom still works. (The list is measured as it mounts, so a
      keyboard-shrunk first measurement used to stick for the whole mode.)
- [ ] B3c — Focus a Sets field, type a new number, then hold a grip WITHOUT
      tapping elsewhere. On exit the new number is still there. (Those fields
      commit on blur, and unmounting a focused input never delivers one.)
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

- [ ] D1 — Focus a grip on a FULL card (idle). "Move up" / "Move down" actions
      are offered. They are withheld inside compact mode on purpose — the
      sortable seeds its positions once, so a move from outside a drag would
      desync it.
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
