# Cold-start bootstrap — one request for the app shell (PER-80)

Brad, 12 October 2026: "is it better for us to have one request which surfaces
all of the data? … We want to be offline first mode supported, but firing this
many requests at app opening is inefficient." This brief answers that with a
single bootstrap request and the client changes that make it count.

## Why

A cold start of a signed-in athlete landing on Home fired 29 requests to the
API inside a second (CFNetwork log, simulator Release build, 12 Oct). The
staging edge throttled eight of them with `503 Service Unavailable`, which is
the "could not refresh training partners" banner and the Together gate landing
on "unavailable". PR #496 removed the duplicates (29 → 19, peak concurrent
18 → 6, 503s 8 → 0). The remaining 19 are distinct endpoints, each its own
Lambda invocation, JWT verification and pooled DB connection. The pattern we
want already exists in one place: `GET /users/me/home` composes seventeen
repository reads inside one handler.

## Deliverables

### Backend (microservices/core)

1. **Section loaders extracted from existing handlers, no behaviour change.**
   `loadHome` (from `getHomeHandler`), `loadHabitConfig` (from
   `habitConfigHandler`), `loadVolumeStats` (from `getVolumeStatsHandler`).
   Each takes the repositories it needs and the user id; the routes call them
   and return the same envelope as before. Their side effects stay inside the
   loader (programme materialisation, volume recompute) so the route and the
   bootstrap answer identically.
2. **`GET /users/me/bootstrap?include=a,b,c&ownerLibraryOnly=true`**, authed,
   mounted inside `streaksRoutes` (the root `.use()` chain is at TypeScript's
   instantiation-depth limit; see `streaksRoutes.ts` header). Sections:

   | key                          | source                                                                                                                                          | notes                                                            |
   | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
   | `home`                       | `loadHome`                                                                                                                                      | identical to `/users/me/home`                                    |
   | `profile`                    | `ProfileRepository.getProfilePageData`                                                                                                          | `null` → section error `not_found`                               |
   | `subscription`               | `FoundingGrantService.applyPendingForUser` then `SubscriptionRepository.findForUser`                                                            | same side effect as `/subscriptions/me`                          |
   | `tiers`                      | `SubscriptionTiersRepository.listActive` → `mapTierRowToWire`                                                                                   |                                                                  |
   | `onboarding`                 | `OnboardingStateRepository.get`                                                                                                                 | may be `null`                                                    |
   | `workouts`                   | `assertEntitlement(userId,"loadout")` once, then `WorkoutRepository.list` for `mine` (with `ownerLibraryOnly`), `assigned`, `default`, limit 20 | `{ mine, assigned, default }` each `{ workouts, total, quota? }` |
   | `notifications`              | `countUnread` + `list({ unreadOnly: true, limit: 50 })`                                                                                         | `{ rows, nextCursor, unreadCount }`                              |
   | `habitConfig`                | `loadHabitConfig`                                                                                                                               |                                                                  |
   | `habitCompletions`           | `HabitRepository.list` + derived rows, window 7d                                                                                                | same as `/habit-completions?window=7d&includeDerived=true`       |
   | `streaks`                    | `StreakRepository.getActiveStreaksForUser`                                                                                                      |                                                                  |
   | `achievements`               | `safeReconcileWorkoutStreak` then `HomeReadRepository.getAchievements`                                                                          | same side effect as the route                                    |
   | `volumeStats`                | `loadVolumeStats(window="month")`                                                                                                               |                                                                  |
   | `bodyTrend`                  | `getBodyTrend(30d)`                                                                                                                             |                                                                  |
   | `recentPRs`                  | `getRecentPRs(20)`                                                                                                                              |                                                                  |
   | `muscleGroups` / `equipment` | `ExerciseRepository`                                                                                                                            | snake_case wire shape as the public routes                       |

   Response: `{ data: { generatedAt, sections: { <key>: { ok: true, value } | { ok: false, error } } } }`.
   Sections run through `Promise.allSettled` with at most **three** in flight
   (the DB pool is four connections per container; `loadHome` alone fans out
   seventeen reads, so sections are not all started at once). A section that
   throws becomes `{ ok: false, error }` and never fails the response. Unknown
   `include` keys are a 400. No `include` means every section.

3. **Tests** in the handler pattern (`homeEndpoints.test.ts`): mocked
   repositories, `handler.handle(new Request(...))`, 401 without a token, every
   section present with no `include`, a subset with `include`, a throwing
   section isolated, an unknown key rejected, concurrency bound observed.
   Coverage stays at 90 on the package.

### Mobile (packages/mobile)

4. **`ApiPort.getBootstrap(params)`** → `requestEnvelope("/users/me/bootstrap")`
   with the same per-section transforms the single-endpoint methods apply
   (`normalizePersonalRecord`, `mapSubscriptionTier`, `mapApiNotification`,
   workouts `meta` unwrap, reference-list mapping plus
   `populateReferenceLookup`). In-memory adapter assembles it from the
   existing fixtures.
5. **`bootstrap.command.ts`**: drains the sync queue, asks for the sections
   whose caches are stale, writes each returned section exactly the way its
   hook does today (`cacheHome`, `refreshWorkouts` merge preserving unsynced
   rows, `reconcilePendingProfilePreferences`, `cacheNotifications`,
   `habitConfigFromEntry`, `reconcilePendingBodyMeasurements`,
   `cacheReferenceList` per kind) and seeds the two React Query keys
   (`["user-subscription", userId]`, `["subscription-tiers"]`). Each section's
   write is isolated; a failed section leaves the cache untouched.
6. **A freshness stamp per section** so the hooks that currently hardcode
   `isStale: true` (streaks, achievements, volume stats, body trend, recent
   PRs, habit config, habit completions) can skip their mount-time fetch when
   the bootstrap wrote them inside the TTL. One `StoragePort` method
   (`getCacheAge(kind, userId)`) over the existing `synced_at` columns; the
   hooks keep fetching on pull, focus and explicit reload.
7. **Bootstrap gate.** `useBootstrap` runs once per user in `(app)/_layout`
   before the screen hooks' auto-fetch. The hooks that auto-fetch on mount
   (`useCachedResource`, `useWorkouts`, `useProfilePage`, `useGetHabits`,
   `OnboardingProvider`) await `bootstrapSettled(userId)` first and then
   re-check staleness, so Home renders from SQLite immediately and nothing
   races the single request. If the bootstrap fails or is offline, the gate
   resolves at once and today's per-endpoint behaviour applies unchanged.
8. **Retire `warmOfflineData`'s per-launch eight GETs**: streaks, achievements,
   volume, body trend and PRs come from the bootstrap; nutrition today,
   recipes and meals load when the Fuel tab is opened (they already refresh
   there) or on the existing reconnect path.
9. **Order after the bootstrap settles:** Together provisioning (`trust` /
   `register`) and push registration start after the gate resolves, off the
   critical path.

## Acceptance

- Simulator Release build, signed-in athlete, caches older than their TTL:
  requests to the API in the 5 s after the first ≤ **3** (bootstrap, Together
  trust, push register), down from 19 on #496 and 29 before. Warm relaunch
  inside the TTLs: 0 or 1.
- Home, partners and the Together gate render from cache before the request
  returns; no new spinner.
- Pull to refresh, refocus and foreground behave exactly as before.
- Backend: route tests green, core coverage ≥ 90, the three refactored routes
  return byte-identical bodies for the same mocks (asserted in their existing
  tests).
- Mobile: full suite with the coverage gate, lint 0, typecheck.

## Constraints

- Container/presenter split; no UI change.
- No new native modules, no deps.
- The bootstrap is additive: every single-endpoint route stays and keeps its
  contract. The web client is untouched.
- Section version stamps (server omits unchanged sections) are a follow-up,
  not in this slice.

## Out of scope, named

- Sentry's ~30 launch posts (separate host, no quota impact).
- expo-updates' manifest check (Expo CDN).
- The staging Lambda concurrency quota (AWS, Brad).
