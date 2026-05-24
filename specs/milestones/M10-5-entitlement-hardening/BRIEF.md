# M10.5 — Entitlement Hardening + Feature Gates + Offline UX

## Why this milestone

M10 shipped the subscription surface — backend reads, mobile screens, Apple Pay flow. Three gaps surfaced in post-merge review (see the discussion thread closing PR #71):

1. **No server-side enforcement** on premium-only mutations. A user with a cancelled or expired sub could still drive endpoint state. JWT-only checks weren't enough.
2. **No mobile feature gates.** STORY-004 was explicitly deferred from M10 — paywalled features didn't show upgrade prompts; they just silently let users through.
3. **No offline UX** on the subscription screens. Slow / dropped network produced indefinite spinners or error states instead of graceful degradation.

M10.5 closes all three. **Brad's explicit decision:** skip client-side grace windows / `validUntil` — `expiresAt` is trusted on the client, server enforces at every premium-only mutation. AI features inherently require network anyway, so client-side abuse defense isn't worth the complexity.

## Parent spec

[`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — requirements (STORY-009, STORY-010, STORY-011 + revised STORY-004 + STORY-005), design (new "Entitlement enforcement (M10.5)" section), tasks (Phases 9–12).

## Scope summary — two waves, six agents total

### Wave 1 — three parallel agents (fork off the M10.5 briefs commit)

| Agent | Brief | Scope |
|---|---|---|
| `m105-backend` | [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) | `assertEntitlement` helper + `EntitlementError` mapper + apply to `POST /workouts` + `POST /sessions/record`. Feature enum + stubs for `ai_workout` / `gym_buddy` / `trainer_clients` / `unlimited_exercise_library`. 402 with structured payload. |
| `m105-mobile-primitives` | [`MOBILE_PRIMITIVES_BRIEF.md`](./MOBILE_PRIMITIVES_BRIEF.md) | `useFeatureGate(feature)` hook + `FeatureGatePrompt` component + `SubscriptionBadge` component. 402 interception in `SSTApiAdapter`. No per-screen integration. |
| `m105-mobile-offline-ux` | [`MOBILE_OFFLINE_UX_BRIEF.md`](./MOBILE_OFFLINE_UX_BRIEF.md) | `useOnlineStatus()` hook + offline banners on both subscription screens + mutation pre-flight + slow-network "still working…" indicator + 3DS network-drop recovery. |

These three agents touch disjoint trees and have no contract dependency on each other. They land on the same `feat/m10-5-entitlement` PR branch, in three separate merges from worktrees.

### Wave 2 — three parallel agents (fork off Wave 1's merged state, on a new branch)

| Agent | Brief | Scope |
|---|---|---|
| `m105-gates-workouts` | (Wave 2 brief — author after Wave 1 merges) | Wire `FeatureGatePrompt` into exercise library, workout creator, session start. |
| `m105-gates-progress` | (Wave 2 brief) | Lock advanced analytics + health for free tier; render `SubscriptionBadge` on Profile. |
| `m105-gates-trainer` | (Wave 2 brief) | Stub gates on trainer route placeholders. M8 will replace stubs with real client management. |

**Wave 2 is NOT in scope for this milestone PR.** It's authored once Wave 1 primitives ship so per-screen agents can import the real hook + component, not mocks.

## Success criteria (Wave 1 review gate)

Done when **all** of these pass against staging (post-merge auto-deploy):

1. `POST /workouts` with a basic-tier user already at workout limit returns 402 with `{ code: "ENTITLEMENT_DENIED", feature: "create_workout", current_tier: "basic", upgrade_to: "premium", upgrade_price_monthly: 14.99 }`. Same user upgrading to premium then retries → 201.
2. `POST /sessions/record` enforces the same — basic-tier user at limit gets 402 on a fresh-workout record; existing-workout record (no new workout row) returns 201.
3. Mobile: a free-tier user opens the workout creator → `FeatureGatePrompt` renders showing "Upgrade to Basic" CTA → tap → routes to Selection with `basic` pre-selected.
4. Mobile: airplane mode on → Subscription Selection still renders (cached `MySubscription` + tiers) with "You're offline" banner; tap Subscribe → alert "You need to be online to manage your subscription". Re-enable network → tap Subscribe → Apple Pay sheet mounts normally.
5. Mobile: 8s into a slow `useMySubscription` query → "still working…" indicator visible; query continues underneath.
6. Mobile: 402 from any endpoint → `SSTApiAdapter` produces a domain `ApiError` with the verdict payload; containers consume + render the gate.
7. Per-PR quality gates (prettier / typecheck / lint / build / all suites) clean; ≥90% branch coverage on touched files.

## Agent execution discipline

Lessons from M10:

1. **Commit briefs BEFORE spawning.** M10's first attempt spawned agents while specs/briefs were uncommitted → backend worktree branched off a base that didn't yet contain the briefs, producing a misleading diff stat at merge time. This milestone commits all 5 brief files first, THEN spawns.
2. **No file overlap between Wave 1 agents.** Backend touches `microservices/core/`; primitives touches `packages/mobile/src/ui/hooks/` + `packages/mobile/src/ui/components/subscription/`; offline-UX touches `packages/mobile/src/ui/containers/Subscription*Container.tsx` + a new `useOnlineStatus` hook. No conflicts at merge.
3. **Each agent commits per logical slice** with spec citations in the commit footer (`Implements:`, `Closes:`, `Satisfies:`).
4. **Each agent runs its own quality gate before reporting done.** Orchestrator runs the full gate again after merge.

## Explicit non-goals for M10.5

- **Per-screen feature-gate integration** is Wave 2 — not in this milestone PR.
- **Sync-queue entitlement re-check** (the offline-then-flush abuse vector) — deferred to M10.6.
- **Client-side `validUntil` / grace windows / clock-rollback detection** — explicit Brad call: skip. Server-side enforcement is the entire defense.
- **AI endpoint implementation** — out of scope. M10.5 only ships the `ai_workout` feature stub in `assertEntitlement`.
- **Schema changes** — none. M10.5 reads what's already in `subscription_tiers` + `subscription_limits` + `profiles` + `user_subscriptions`.
- **Onboarding `setupRole` flow** — separate concern. Not in M10.5.

## Cross-cutting (carry into all three briefs)

- **`EntitlementError` -> HTTP 402** is the shared contract. The shape MUST match the documented one in `design.md` § Entitlement enforcement; mobile parses it; deviating breaks the mobile adapter's 402 path.
- **No JWT-only entitlement checks.** Always join live DB state — defends against the "valid token, cancelled sub" vector that motivated this milestone.
- **No grace-window state on the client.** `useFeatureGate` reads `MySubscription` directly. Server enforcement is the authoritative layer.
- **`subscription_limits.*` is trigger-maintained** ([004_subscriptions_and_roles.sql:438](../../../supabase/migrations/004_subscriptions_and_roles.sql)). Backend MUST NOT write to those columns from handlers. Read-only.
- **Offline detection** uses `@react-native-community/netinfo` (already a transitive dep — confirm before adding). `useOnlineStatus` exposes a boolean; consumers subscribe via Tanstack Query or `useEffect`.
