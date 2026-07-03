# M13 — Programs smoke test

Run on device/simulator with a trainer account (active, non-AI relationship
to a client account) after all four PRs are merged.

## Coach

1. Coach mode → Programs tab: list renders (empty state first run), "+ New
   programme" opens the creator.
2. Create finite programme: name "Strength 4wk", 4 weeks, 3 days/wk, 3
   workouts ordered A→B→C. Card shows `4 WKS`, DRAFT pill.
3. Create indefinite programme: "Ongoing Cut", Ongoing, 2 days/wk, 2
   workouts. Card shows `ONGOING`, DRAFT.
4. Edit "Strength 4wk": reorder C above B, save, reopen — order persists.
5. Assign "Strength 4wk" to the client (start today, both visibility
   toggles on). Card pill flips to ACTIVE, `1 CLIENT`.
6. Coach You → "Programmes in use" shows Strength 4wk · 1 client.
7. Clients list → client row subtitle shows `Strength 4wk · Wk 1 / 4`;
   adherence bar appears (0% until completion).
8. Client Detail → ProgrammeCard "Week 1 / 4" + progress bar.
9. Ad-hoc: assign a single workout with a due date from Client Detail.

## Client

10. Home shows "Your programme" card (Strength 4wk, Week 1 / 4) and
    "Today's training" listing today's occurrence(s) with trainer badge.
11. Train tab MY WORKOUTS contains the assigned workouts exactly once each
    (deduped), including any coach-private workout — and its detail opens.
12. Start today's workout → finish + record. Session summary normal.

## Loop-back (coach)

13. Clients list adherence % > 0; Coach You avgAdherence moves;
    ProgrammeCard still Week 1 / 4.
14. Unassign "Strength 4wk" → future occurrences gone from client Home;
    completed history remains in client sessions; Clients-list programLabel
    reverts to null; programme card back to DRAFT (no other clients).

## Visibility flags

15. Re-assign with "Show in workouts library" OFF → workouts appear in plan
    ("Today's training") but NOT in Train MY WORKOUTS.
16. Assign the indefinite programme with "Show in training plan" OFF →
    Home plan card/today hidden for it; workouts DO appear in the library.

## Regression

17. Athlete with no assignments: Home renders with no programme card, no
    errors; Programs tab still hidden in athlete mode.
18. Second trainer account cannot see or edit the first trainer's
    programmes (404 on direct fetch).
