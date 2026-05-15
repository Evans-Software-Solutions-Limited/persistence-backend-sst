# M6 — Profile + Edit Profile — Backend Brief (PR-1 of 2)

**Parent spec:** [`../../08-profile-settings/`](../../08-profile-settings/) — STORY-001 (view profile), STORY-003 (account actions), STORY-005 (offline cache).
**Companion brief:** Frontend follows in PR-2 once this lands.
**Pattern:** Mirrors M3 Phase 3b PR-1 (backend additions land first; frontend PR cites this PR's endpoint and wires UI on top).

## Goal

Replace the legacy mobile profile screen's _three separate Supabase calls_ (`useGetProfile`, `useGetUserSubscription`, `useGetProfilePicture`) with a **single dedicated aggregation endpoint** the frontend can call once on screen mount, cache to SQLite, and re-render from on subsequent opens.

The legacy stitched the screen together from N round-trips. The new design uses the same pattern `GET /dashboard` already follows on the Home tab — one envelope, one cache slot, deterministic shape.

## Endpoint

`GET /profile/page`

- **Auth:** required (`requireAuth`). 401 when no Bearer.
- **Path param:** none — always scoped to the authenticated `sub` from the JWT.
- **Query params:** none in v1.
- **Response shape:** double envelope `{ data: ProfilePageData }`.
- **Errors:** 404 when the profile row doesn't exist (shouldn't happen after signup, but defensive).

### ProfilePageData shape

```ts
{
  profile: {
    id: string;
    fullName: string | null;
    email: string | null;
    username: string | null;
    avatarUrl: string | null;
    role: "user" | "personal_trainer" | "physiotherapist" | "admin";
    fitnessLevel: "beginner" | "intermediate" | "advanced" | "elite" | null;
    heightCm: number | null;
    weightKg: number | null;
    preferredUnits: "metric" | "imperial";
    isProfilePublic: boolean;
    createdAt: string; // ISO — "member since" copy
  }
  subscription: {
    tierName: string | null; // raw, e.g. 'free' / 'premium'
    tierDisplayName: string | null; // 'Premium' (Title-Cased from tierName)
    status: "active" | "trialing" | "cancelled" | "past_due" | null;
    isFreeTier: boolean; // computed via dashboardRepository.computeIsFreeTier
    isTrainerTier: boolean;
    expiresAt: string | null; // ISO
    cancelledAt: string | null; // ISO
    workoutLimit: number | null; // null when unlimited or no tier
    isUnlimited: boolean; // tier.features.workouts === 'unlimited'
  }
  stats: {
    workoutsCompleted: number; // lifetime count of workout_sessions WHERE status='completed'
  }
  recentAchievements: Array<{
    id: string;
    name: string;
    description: string | null;
    iconUrl: string | null;
    unlockedAt: string; // ISO
  }>; // capped at 3, ORDER BY unlocked_at DESC
  activeTrainers: Array<{
    id: string; // pt_client_relationships.id
    trainer: {
      id: string;
      fullName: string | null;
      avatarUrl: string | null;
    };
  }>;
  pendingTrainerRequests: Array<{
    id: string;
    trainer: { id: string; fullName: string | null; avatarUrl: string | null };
  }>;
}
```

### Repository contract

Extend `ProfileRepository` with `getProfilePageData(userId)`. Internally fans out to seven independent queries via `Promise.all` (mirrors `DashboardRepository.getDashboard`):

1. `profile` — existing `getById(userId)` projection, ISO-stamped + role/units normalised.
2. `subscription` — same join as `DashboardRepository.getSubscriptionSlice` but with the extra fields (`expiresAt`, `cancelledAt`, `workoutLimit`, `features.workouts`). Reuses the existing `computeIsFreeTier` + `normaliseSubscriptionStatus` helpers — single source of truth for those rules.
3. `workoutsCompleted` — `SELECT COUNT(*) FROM workout_sessions WHERE user_id = $1 AND status = 'completed'`.
4. `recentAchievements` — `SELECT FROM user_achievements JOIN achievements ON id ORDER BY unlocked_at DESC LIMIT 3`.
5. `activeTrainers` — `SELECT FROM pt_client_relationships JOIN profiles ON trainer_id WHERE client_id = $1 AND status = 'active' AND is_ai_trainer = false`.
6. `pendingTrainerRequests` — same join, `status = 'pending'`.
7. (None — fan-out of 6 queries.)

`is_ai_trainer = false` is load-bearing on (5) and (6): legacy memory notes (`feature_pt_relationships`) say AI trainer rows should never surface in the Profile UI's "Active Trainers" list. Bake this filter into the repo, not the handler.

### Local-DB caching (frontend PR contract)

Frontend PR-2 will:

- Add a `cachedProfilePage` table to the mobile SQLite storage adapter (one row per user — same pattern as `cachedDashboard`).
- Render from cache on mount; refetch in background on focus + manual pull-to-refresh.
- TTL: stale-after = 5 min (matches dashboard).

This endpoint's response shape is intentionally **complete** (no nested cursor pagination, no follow-up fetches) so the SQLite slot is a single JSON blob with no consistency edges.

### Out of scope for this PR

| Concern                                                                      | Where it lands                       |
| ---------------------------------------------------------------------------- | ------------------------------------ |
| Avatar upload (multipart `POST /profile/avatar`)                             | M6 PR-3 (follow-up; needs S3 wiring) |
| Edit profile screen (`PATCH /profile` already exists)                        | M6 frontend PR-2                     |
| Subscription detail page (manage / upgrade)                                  | M6 PR-4 or M7                        |
| Trainer-side stats (rendered when role = personal_trainer / physiotherapist) | M8 (Trainer features)                |
| Notifications list endpoint                                                  | M7 (Notifications)                   |

The aggregation endpoint shape leaves room for trainer-side stats to be added as an optional `trainerStats` field later, without breaking the v1 contract.

## Acceptance criteria

- [ ] `GET /profile/page` returns the full `ProfilePageData` envelope for an authenticated caller.
- [ ] Returns 401 when unauthenticated.
- [ ] Returns 404 when the `profiles` row for `sub` is missing.
- [ ] `isFreeTier` matches the rule already in `dashboardRepository.computeIsFreeTier` (re-used, not re-implemented).
- [ ] `isAiTrainer = true` rows never appear in `activeTrainers` or `pendingTrainerRequests`.
- [ ] `recentAchievements` capped at 3, sorted by `unlocked_at DESC`.
- [ ] All seven queries run in parallel; Lambda warm-start latency stays bounded.
- [ ] `bun run typecheck && bun run lint && bun run prettier:check && bun --filter @persistence/core test:unit` clean.
- [ ] Coverage ≥ 90% on the new repo methods + handler.

## Smoke test (frontend PR-2 prereq)

1. `bun run dev`
2. `curl -H "Authorization: Bearer $JWT" $API/profile/page | jq` — verify envelope shape against this brief.
3. Spot-check that an AI-trainer-flagged PT relationship row in the DB does NOT appear in either list.
4. Run for a user with no subscription row → `subscription.isFreeTier === true`, `tierName === null`.
5. Run for a user with one cancelled subscription past `expires_at` → `isFreeTier === true` (legacy parity).
