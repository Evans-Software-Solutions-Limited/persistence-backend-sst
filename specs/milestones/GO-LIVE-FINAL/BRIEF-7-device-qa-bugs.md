# BRIEF-7 — Device-QA bug sweep (pre-production)

**Status:** RECORDED, not started. Fix in a dedicated session (or fan out by
workstream). Every item below is a **go-live concern** — grouped, severity-
tagged, with observed vs expected, a root-cause hypothesis, and likely files.
Hypotheses are from prior-session knowledge + a light file-location sweep; the
execution session must verify each against the code before fixing.

**Captured:** 2026-07-22, on-device (TestFlight, iOS) across athlete + coach
modes, from Brad's testing. Screenshots on file with Brad.

**Severity:** 🔴 blocker (breaks a core flow / data correctness) · 🟠 high (bad
UX, not data-losing) · 🟡 medium (polish / edge).

**Prereqs already merged this cycle (context):** #294 restore/sync, #296 profile
tab stuck-loading, #297 per-tier trial + Activated scroll, #298 RevenueCat
ingestion, #300 delete-account notice. Some bugs below are adjacent to those —
noted inline.

---

## Workstream A — Habits don't auto-complete from logged data 🔴

The habits grid on athlete Home only reflects **manual** check-offs (Water
showed ✓). Habits that should auto-complete from logged data stay as dashed
placeholders even after the underlying data is logged.

- **QA-1 🔴 Calories habit doesn't complete when the calorie target is hit.** Logging meals to/over target does not tick the Calories habit for the day.
- **QA-2 🔴 Sleep habit doesn't update when sleep is logged.**
- **QA-3 🔴 Steps habit doesn't update when the steps goal is hit.**
- **QA-4 🔴 Logging a workout doesn't complete the Gym habit.**

**Expected:** a habit whose source is a logged metric (calories→Fuel,
sleep→Health/log, steps→Health, gym→a completed session) auto-marks the day
complete when that metric meets its goal — same grid the manual habits use.

**Hypothesis:** habit day-completion is computed only from explicit toggle rows
(`useToggleHabitDay`), not derived from the day's logged calories/sleep/steps/
session. The habit-config likely has a `source`/`type` (manual vs derived) that
the completion computation isn't honouring on the read path.

**Likely files:** backend `progress/getHomeHandler.ts`, `repositories/homeReadRepository.ts`, `repositories/dashboardRepository.ts`; mobile `useGetHabits.ts`, `useGetHome.ts`, `domain/models/habit-config.ts`, `domain/models/streak.ts`. Cross-check where a habit's goal is compared to the day's logged value.

---

## Workstream B — Coach habit configuration 🔴/🟠

- **QA-5 🟠 Habits can only be set in certain units.** As a coach, can't set e.g. a Calories habit without also being forced into Water-style units — unit model too rigid per habit.
- **QA-6 🔴 Saving habits as a coach doesn't persist.** Tapping **Save** appears to do nothing — the row just reverts to "set by your coach". No success feedback; change not stored.
- **QA-7 🟠 Client habits and targets clash.** The habit config and the Fuel targets (calories/water) appear to overlap/conflict — same metric configured in two places with different values/semantics. Needs a defined source-of-truth.
- **QA-8 🟡 "Days to hit" control is hard to press.** Tiny hit-target / awkward interaction when setting how many days/week a habit must be hit.

**Likely files:** `useConfigureHabit.ts`, `useGetClientHabitConfig.ts`, `useGetHabitConfig.ts`, `domain/models/habit-config.ts`; the coach habit-config presenter/container; backend habit-config write handler + `homeReadRepository`. QA-6 is the priority (data not saving).

---

## Workstream C — Profile drawer stuck "Loading…" 🔴

- **QA-9 🔴 The profile drawer shows "Loading…" indefinitely after logout → login.** (Screenshot: teal avatar + "Loading…".)

**Root cause (high confidence):** the drawer (`ProfileDrawerContainer`) reads the **same `useProfilePage` hook** the Profile tab does. #296 fixed the *tab's* silent-dead-end by surfacing an error/retry in `ProfileContainer`, but the **drawer** has no equivalent — `ProfileDrawerPresenter` renders "Loading…" whenever `profile` is null, forever. The underlying fragility is the one-shot auto-fetch latch in `useProfilePage` (`autoRefreshedForUserRef`, latches before the fetch, never retries on failure) — flagged as the follow-up in #296.

**Fix approach:** implement the deferred **bounded auto-retry in `useProfilePage`** (self-heals the cold-start/first-fetch failure for BOTH the tab and the drawer), and give `ProfileDrawerPresenter` an error/retry state instead of an infinite "Loading…". Verify the logout→login path re-arms the fetch for the re-authenticated user.

**Likely files:** `ui/hooks/useProfilePage.tsx`, `ui/containers/ProfileDrawerContainer.tsx`, `ui/presenters/ProfileDrawerPresenter.tsx`. Blast radius note: same latch in `useDashboard`/`useWorkouts` (see #296 PR body).

---

## Workstream D — Programme assignment & scheduling 🔴

- **QA-10 🔴 Assigning one programme fires a flood of "New Workout Assigned" notifications** (screenshot: ~7 identical, all "6m"). The client is spammed.
- **QA-11 🔴 "Today's training" lists EVERY scheduled occurrence, not just today** (screenshot: one "Upper Body — SET BY COACH" per future date: Today, 07-26, 07-29, 08-02, 08-05, 08-09, …).

**Expected:** a programme is "**N× per week for X weeks**", not N discrete dated workout assignments. Assigning it should (a) send **one** notification (or a single digest), and (b) surface **today's** session on Home "Today's training", with the rest under a plan/calendar view — not dump the whole schedule into Today.

**Hypothesis:** the assign-programme path **materialises every occurrence as an individual dated workout assignment and fires a notification per occurrence**. Home "Today" then reads all future assignments. Needs a model change: represent the programme cadence, generate/display occurrences lazily, and notify once per assignment.

**Likely files:** backend `repositories/programAssignmentRepository.ts`, `repositories/programRepository.ts`, `repositories/notificationRepository.ts`, the assign-programme handler; mobile "Today's training" container + `getHome`. Cross-ref the unified programmes model (#149/#152). ⚠ This is the largest item — likely a small design decision + backend change + Home read change.

---

## Workstream E — Coach library refresh after create 🔴

- **QA-12 🔴 Creating a workout doesn't refresh the Workouts library** — still shows "No workouts yet" after create (screenshot).
- **QA-13 🔴 Creating a programme opens "Edit programme" and it's unclear it saved / not visible in the list.** The create→edit transition + list don't reflect the new programme.

**Hypothesis:** create mutations don't invalidate/refetch the library query keys (React Query), and/or the create flow routes into the edit screen without persisting first. Mirrors the class of refresh bugs in QA-14.

**Likely files:** mobile create-workout / create-programme hooks + the Programmes/Workouts library containers; verify query-key invalidation on success.

---

## Workstream F — Coach ↔ client 🔴/🟠

- **QA-14 🔴 Active clients list only refreshes after an app restart.** Accepting/adding a client doesn't reactively update the list — must kill+reopen the app. **Recurring issue Brad has flagged before; requires detailed review before live sign-off** (not a one-line invalidation guess — investigate the clients query lifecycle + realtime/refetch-on-focus properly).
- **QA-15 🟠 A client with no name renders blank — coach can't see anything.** Client profile details (at least a name) should be set up on onboarding; for demo, hide/placeholder the empty client gracefully.
- **QA-16 🟠 "Programmes" in the coach "You" section is a dead link** — tapping does nothing.
- **QA-17 🟠 Switching back to athlete mode flashes an error before Home renders.** Transient error on the mode-switch → Home transition.

**Likely files:** `trainers/clients/trainersClientsListHandler.ts` + the Clients list container/hook (QA-14); client onboarding/profile-details (QA-15); coach "You" nav (QA-16); mode-switch (`useModeSwitch` / `state/user-mode`) + Home bootstrap (QA-17).

---

## Workstream G — Adherence 🟠

- **QA-18 🟠 Adherence shows "CRISIS" (0%) for a just-onboarded client** (screenshot: Adherence 0% · CRISIS, "No sessions logged this week yet"). A brand-new client with no history should read as a neutral "just started / not enough data" state, not crisis-red.

**Hypothesis:** the adherence calc treats "no data" as 0% and buckets 0% → crisis, with no "insufficient data / grace window" guard for new relationships.

**Likely files:** `repositories/clientDetail.ts` / `clientDetailRepository.ts`, the adherence computation + threshold buckets; the client-detail adherence card.

---

## Workstream H — Fuel day navigation 🟠

- **QA-19 🟠 The Fuel calendar button does nothing** — should navigate to previous days so the user can view/log for another date.
- **QA-20 🟠 "Add from recents" is a blind addition** — with no day navigation/context, adding from recents gives no sense of which day / what's being added.

**Hypothesis:** Fuel is locked to "today" with no day-picker; the calendar affordance is present but unwired. Relates to the previously-noted "Fuel day-picker needs a spec" (memory `project_m9_fuel_targets_pr144`).

**Likely files:** `ui/containers/FuelContainer.tsx`, `ui/presenters/FuelPresenter.tsx`; the recents/add flow.

---

## Suggested execution order

1. **QA-9 profile drawer** (login UX; also lands the deferred `useProfilePage` auto-retry that de-risks the tab too).
2. **Workstream A habits auto-complete** + **QA-6 coach habit save** (core habit feature is non-functional).
3. **Workstream D programme assignment/notifications** (coach spam + wrong Today list; needs a small design decision first).
4. **QA-12/13/14 coach create + client-list refresh** (investigate the refresh lifecycle properly per Brad — QA-14 is a sign-off gate).
5. **QA-18 adherence**, **QA-15 client name**, **QA-16/17 coach nav/mode-switch**.
6. **Workstream H Fuel day-nav** (may want its own small design pass), **QA-5/7/8 habit-config UX**.

Most are **mobile**; A/B/D/G have a **backend** component. Each fix follows the
standard gate + Inspector Brad + PR flow. Recommend a fresh session per
workstream (or a fan-out) rather than one mega-PR.
