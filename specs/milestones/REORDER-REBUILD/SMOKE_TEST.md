# SMOKE TEST — Exercise reorder mode (PER-67, 10 Nov 2026)

**Physical device, release-ish build. Jest cannot prove any of this (drag,
Reanimated and Gesture Handler are all mocked).**

Record device + OS version. Every box must be ticked by a human.

**The design (Brad, 10 Nov 2026):** a **Reorder** button above the exercises
puts the screen in reorder mode: one compact row per exercise (a superset is
one row), each with a drag handle, under a bar with **Done**. Outside reorder
mode nothing on a card starts a drag. This replaces the hold-the-grip design
that `BRIEF.md` describes, which could leave some cards collapsed and others
not.

---

## A. Active session (`session/index`)

Set up: start a session with **12+ exercises**, including one superset, so the
reorder list is still taller than the screen (rows are ~84 pt).

**PER-67 and the "two sets" report — do these first**

- [ ] A1 — Log reps and weight into two sets of one exercise. Every card stays
      a full card; nothing collapses, nothing shows without its sets.
- [ ] A2 — Delete an exercise (and cancel a delete). The list stays as full
      cards; no reorder rows appear.
- [ ] A3 — Delete the last-but-one exercise: the Reorder button disappears
      (nothing left to reorder).
- [ ] A4 — Scroll the cards with swipes that start anywhere on a card,
      including its top-left corner. It scrolls; nothing drags or collapses.

**Reorder mode**

- [ ] A5 — The Reorder button sits above the first exercise. Tap it: every
      exercise becomes a compact row with a handle, under "Reorder exercises"
      and Done.
- [ ] A6 — Hold a handle, drag down 3 positions, release. It lands where
      dropped and you stay in reorder mode.
- [ ] A7 — Drag it back up 3 positions. It lands where dropped.
- [ ] A8 — **Drag to the bottom edge. The list auto-scrolls**; drop on the last
      row. It commits there, not several rows above.
- [ ] A9 — **Drag to the top edge. The list auto-scrolls back up**; it commits
      where dropped.
- [ ] A10 — Swipe on a row away from its handle: the list scrolls, nothing
      drags.
- [ ] A11 — Tap a handle without holding: nothing moves.
- [ ] A12 — A superset is ONE row and moves as a block; at rest its cards are
      still grouped (a superset with cardio still shows individual cards).
- [ ] A13 — Tap Done: the full cards come back in the new order, with every
      set and value where it was.
- [ ] A14 — Background the app in reorder mode and return: still in reorder
      mode, Done still works.
- [ ] A15 — Reorder, Finish the workout, reopen it from history. The saved
      order matches.
- [ ] A16 — Reorder while offline (airplane mode), then Finish. Order survives.
- [ ] A17 — VoiceOver: Reorder button is announced; in reorder mode each row's
      handle offers Move up / Move down and announces the new position.
- [ ] A18 — Train Together: a partner's tab shows no Reorder button.

## B. Workout editor (`workouts/[id]/edit`) and creator (`workouts/create`)

Set up: a workout with 8+ exercises including a superset.

- [ ] B1 — Edit sets, reps and rest on several cards: nothing collapses or
      drags.
- [ ] B2 — The Reorder button sits beside "Exercises · N". Tap it: compact
      rows with handles, the form fields above are hidden, Done at the top.
- [ ] B3 — Drag a row down and up; each lands where dropped.
- [ ] B4 — Drag a superset row: it moves as one block.
- [ ] B5 — Done: the form and cards return in the new order. Save, reopen: the
      order is saved.
- [ ] B6 — Same in Create workout before the first save.
- [ ] B7 — With one exercise there is no Reorder button.

## C. Weight cap (PERSISTENCE-MOBILE-2)

- [ ] C1 — In a set's weight field type 3 5 5 3 2: the field stops at 3553.
- [ ] C2 — 9999.99 kg is accepted. With lb units, 22045 is accepted and 22050
      is not.
