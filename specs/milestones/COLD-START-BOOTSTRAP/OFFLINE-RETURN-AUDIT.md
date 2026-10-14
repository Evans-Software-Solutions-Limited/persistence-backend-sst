# Offline returning-user audit — 14 October 2026

Brad's question: a user opens the app for the first time in weeks with no
internet. Their access token has expired and cannot be refreshed. SQLite caches
exist but are past their TTLs; the React Query cache is empty. What do they
see, and is the coach view reachable? Traced from source at main `0ce69dbb`
plus PR #498; read-only, no device run (the simulator cannot be put into
airplane mode from the command line). Spot-checked against the code before
publishing.

## Timing that drives most of it

- Expired token, offline: supabase-js retries the refresh with backoff for about
  25 s, then keeps the stored session.
- Every API request offline costs about 6 s before it fails with `network`:
  the token provider waits 3 s for `getSession`, finds the token expired,
  waits about 3 s more, then sends the expired token anyway
  (`supabase.adapter.ts` 714–748).
- The subscription query offline: about 6 s, one React Query retry, about 6 s
  again, then `isError` with `network`. About 13 s in total.

## Holds up offline

- **Auth.** The stored session counts as signed in; `getSession` failing falls
  back to it; only `SIGNED_OUT` clears it; a 401 never signs the user out or
  clears caches (`useAuth.tsx` 69–147, `sst-api.adapter.ts` 3144).
- **Update gate.** Cached policy plus the built-in floor; 3 s abort; never fails
  closed (`AppUpdateGate.tsx` 53–74).
- **Cold-start bootstrap.** No request offline; the gate settles at once; a 401
  online also settles it (`useBootstrap.ts` 50–66).
- **Onboarding with a cache.** Read synchronously; a failed refresh keeps it.
- **Cache-first tabs.** Home, Workouts, Exercises (with a "synced X ago" strip),
  You, Profile (banner), Notifications list, Programs, Coach You, Client detail.
- **Together.** Credentials last at most 24 h offline, so weeks later the hub
  shows "We couldn't verify your Together access. Your personal workout remains
  available." with Retry. Honest and recoverable.
- **Coach mode on a plain network error** keeps a stored coach mode: the
  watchdog only demotes on a non-network error (`useUserModeEligibility.tsx`
  71–78).

## Breaks or degrades, worst first

| #   | Finding                                                                                                                                                                                                        | Where                                                                                    | Fix                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Offline writes can be dropped.** Transport deferrals are free only 12 times at 5 s spacing, then the 3-attempt budget is spent and the entry turns terminal; an optimistically created workout is discarded. | `sync.command.ts` 256, 272–303, 1269–1274                                                | Do not count transport deferrals toward the budget; skip the drain while NetInfo reports offline.                               |
| 2   | **Paid Loadout and Mealprint users look unentitled offline**, and an in-progress Loadout session is hidden on relaunch. The gates treat an errored subscription query as resolved with no subscription.        | `useLoadoutGate.ts` 218, `useMealprintGate.ts` 218, `useActiveWorkoutRehydration.ts` 130 | Persist the last good `MySubscription` (SQLite or a React Query persister); treat `network`/`timeout` as unknown, not resolved. |
| 3   | **Coach Clients tab: 13 s spinner, then the trainer paywall.** The cached roster is never shown.                                                                                                               | `ClientsContainer.tsx` 228–243                                                           | Gate on the persisted subscription; on a network error render the cached roster.                                                |
| 4   | **Coach Home shows a full-screen error despite a cached roster** because it checks `error` before data.                                                                                                        | `CoachHomePresenter.tsx` 109                                                             | Show the error only when there is no cached data, as the other presenters do.                                                   |
| 5   | **A 401 permanently demotes a coach to athlete** and writes the demotion to disk.                                                                                                                              | `useUserModeEligibility.tsx` 71–78, `user-mode.ts` 81–84                                 | Treat `unauthorized` like `network`: leave eligibility unknown.                                                                 |
| 6   | **Fuel tab errors on a new day** because the day cache is keyed by date and today has no row; quick-add is unreachable from the tab.                                                                           | `useGetFuelToday.ts`                                                                     | Fall back to an empty day with the cached target, as `nutrition.command.ts` 61–70 already does.                                 |
| 7   | **No onboarding cache plus a 401 blocks the whole app** behind "Persistence is temporarily unavailable".                                                                                                       | `app/_layout.tsx` 386–406                                                                | Fail open to the tabs when the profile or home cache shows an established account.                                              |
| 8   | **A trainer cannot enter coach mode offline**, nor use the drawer to leave it, because the switch needs `isTrainerEligible`.                                                                                   | `ProfileDrawerPresenter.tsx` 317, `useModeSwitch.ts` 78                                  | Allow the switch when the stored subscription says trainer, or eligibility is unknown and the stored mode was coach.            |
| 9   | **Two waits have no cap:** `useBootstrapSettled` (subscription and tier queries) and the sync `fetch`. On a half-open connection the subscription query stays disabled.                                        | `useBootstrapSettled.ts`, `sync.command.ts` 872                                          | Cap `useBootstrapSettled` at `BOOTSTRAP_WAIT_MS`; give the sync fetch an abort timeout.                                         |
| 10  | **Every request waits about 6 s offline before failing.**                                                                                                                                                      | `supabase.adapter.ts` 727–748                                                            | Short-circuit with `network` when NetInfo is offline and the stored token is expired.                                           |
| 11  | **Unread badge shows 0 offline**: the initial read runs before `userId` is known and is never re-read.                                                                                                         | `useUnreadNotificationCount.tsx` 21–33                                                   | Re-read the cached count when `userId` changes.                                                                                 |
| 12  | **Home shows weeks-old "today" rings as today** with no indicator; the payload carries no date.                                                                                                                | `useGetHome.ts`, `HomePresenter.tsx` 161                                                 | Add a "last synced" strip like Exercises; blank day-scoped rings when the cache is from another day.                            |
| 13  | **Already-onboarded user with no onboarding cache replays onboarding offline.**                                                                                                                                | `OnboardingProvider.tsx` 270                                                             | Skip the replay when other caches show an established account.                                                                  |
| 14  | **A captive portal can sign the user out**: supabase-js treats a non-JSON non-2xx refresh response as non-retryable and wipes the session.                                                                     | upstream `auth-js` fetch                                                                 | Wrap the supabase `fetch` so non-JSON non-2xx responses become retryable.                                                       |

## The coach question, answered

Offline with an expired token, a trainer who closed the app in coach mode
reopens in coach mode (the network error leaves eligibility unknown), but the
Clients tab spins for about 13 s and then shows the trainer paywall, and Coach
Home shows a full-screen error even though the roster is cached (#3, #4). A
trainer who closed the app in athlete mode cannot switch to coach at all (#8).
If any request returns a 401 instead, the app demotes them to athlete and
persists it (#5). The fix is one change in shape: persist the last good
subscription and treat network and 401 errors as "unknown", then let the
cache-first presenters render.

## Suggested grouping for the work

- **Slice A, data loss and entitlement (1, 2, 5, 9):** sync budget, persisted
  subscription, 401 handling, the two caps. Adapter and hook work with tests.
- **Slice B, coach offline (3, 4, 8):** three presenter/container changes on
  top of A.
- **Slice C, offline polish (6, 7, 10, 11, 12, 13, 14):** mostly small; #10
  removes the 6 s stall everywhere and is the one users feel most.
