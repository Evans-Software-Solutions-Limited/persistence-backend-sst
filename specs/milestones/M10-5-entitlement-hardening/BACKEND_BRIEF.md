# M10.5 — Backend Agent Brief (`m105-backend`)

You are implementing the backend slice of M10.5 — server-side entitlement enforcement. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the SST / Elysia backend at `microservices/core/`. You are NOT touching mobile code — `m105-mobile-primitives` and `m105-mobile-offline-ux` own that surface and run in parallel with you.

## Authority

- Parent spec: [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — updated 2026-05-24 with STORY-009 + new "Entitlement enforcement (M10.5)" section in `design.md`. Read it first.
- Backend rules: [`CLAUDE.md`](../../../CLAUDE.md) — SST v3 + Elysia + Drizzle + JWT auth + explicit ownership checks.
- Workflow: [`../../_agent.md`](../../_agent.md) — spec-first, always.

## Spec alignment — READ FIRST

Parent spec was already updated when you spawn. You do NOT need a separate spec-update phase. Every implementation commit cites the spec section it implements:

```
Implements: specs/11-payments-subscriptions/design.md § Entitlement enforcement (M10.5) > Server-side assertEntitlement helper
Closes: specs/11-payments-subscriptions/tasks.md § Phase 9 — Server-side assertEntitlement
Satisfies: specs/11-payments-subscriptions/requirements.md AC 9.1, 9.6
```

## Scope

Three logical slices. Recommended commit order: helper → error mapper → wire to handlers. Land all on the same branch.

### 1. `assertEntitlement` helper

Location: `microservices/core/src/application/entitlement/assertEntitlement.ts`

```typescript
export type EntitlementFeature =
  | "create_workout"
  | "ai_workout"
  | "gym_buddy"
  | "unlimited_exercise_library"
  | "trainer_clients";

export type EntitlementVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: "tier" | "limit" | "cancelled" | "expired";
      currentTier: SubscriptionTierName;
      upgradeTo: SubscriptionTierName | null;
      upgradePriceMonthly: number | null;
    };

export async function assertEntitlement(
  userId: string,
  feature: EntitlementFeature,
): Promise<EntitlementVerdict>;

export class EntitlementError extends Error {
  constructor(
    public readonly verdict: Extract<EntitlementVerdict, { allowed: false }>,
  ) {
    super("ENTITLEMENT_DENIED");
  }
}
```

**Read paths inside the helper:**

- `create_workout`: read the latest active `user_subscriptions` row + join `subscription_tiers` + read `subscription_limits` row for `limit_type = 'workouts_per_month'`. Apply the rule:
  - If no active sub → tier is `free`, `workoutLimit` from free tier row, count vs limit
  - If `payment_status NOT IN ('active', 'trialing')` → reason = `'cancelled'`, upgrade target = `'basic'` (or the user's existing tier)
  - If count >= limit (and limit is non-null) → reason = `'limit'`, upgrade target = next-tier-up with higher `workoutLimit`
  - Otherwise → `allowed: true`
- `ai_workout` (stub): always `allowed: true` — wire the read path but accept-all for M10.5
- `gym_buddy`, `unlimited_exercise_library`, `trainer_clients` (stubs): always `allowed: true`

**Upgrade-target resolution rule:** when reason is `'limit'` or `'tier'`, look up the cheapest tier whose feature flag / limit satisfies the request. For `create_workout`, that's `premium` for user-role users and `individual_trainer_standard` for trainer-role users. Use the user's `profiles.role` to pick. Read `upgrade_price_monthly` from that target tier.

**Live DB only.** Never trust JWT claims (`payment_status`, `tier_name`) — always read fresh from Postgres. The whole point is to defend against "valid JWT, cancelled sub."

### 2. `EntitlementError` → HTTP 402 mapper

Approach: extend `microservices/core/src/shared/errorHandler.ts` to recognise `EntitlementError` instances and map to HTTP 402 with the structured body:

```json
{
  "code": "ENTITLEMENT_DENIED",
  "error": "Subscription does not include this feature",
  "feature": "create_workout",
  "current_tier": "basic",
  "upgrade_to": "premium",
  "upgrade_price_monthly": 14.99
}
```

Match the field naming in `design.md` § Entitlement enforcement > 402 response shape EXACTLY — the mobile adapter parses these field names verbatim. Snake_case in the wire payload; the helper returns camelCase internally for TypeScript consistency.

### 3. Wire to `POST /workouts` and `POST /sessions/record`

`microservices/core/src/application/workouts/create/workoutsCreateHandler.ts`:

```typescript
// Inside the handler, AFTER body validation + auth, BEFORE createWithExercises:
const verdict = await assertEntitlement(userId, "create_workout");
if (!verdict.allowed) throw new EntitlementError(verdict);
```

`microservices/core/src/application/sessions/record/sessionsRecordHandler.ts`:

Same pattern, but only when the session represents a **fresh workout** — i.e., the recorded session creates a new workout row OR is unattached to an existing `workoutId`. Re-recording an existing session against an existing `workoutId` is NOT a new workout and doesn't count toward the limit.

Read the existing handler to identify which branch creates a fresh workout. If unclear, ASK in your PR — don't guess.

## Tests

`microservices/core/src/application/entitlement/__tests__/assertEntitlement.test.ts`:

- 100% branch coverage required (non-negotiable for new code under this path)
- Cover: free tier under limit (allowed), free tier at limit (denied with reason `'limit'`), basic at limit (denied with reason `'limit'` + upgrade_to = `'premium'`), premium unlimited (allowed), cancelled sub (denied with reason `'cancelled'`), expired sub (denied with reason `'expired'`), every stub feature returns allowed today

`microservices/core/src/application/workouts/create/__tests__/workoutsCreateHandler.test.ts` (extend existing):

- New test: basic tier at limit → 402 with the structured body
- New test: premium tier → 201 (no entitlement-related regression)
- New test: 402 body shape matches the spec field names exactly

`microservices/core/src/application/sessions/record/__tests__/sessionsRecordHandler.test.ts` (extend existing):

- Same shape: 402 when fresh-workout record at limit, 201 when re-recording existing

## Quality gates

```bash
bun run prettier:check
bun run typecheck
bun run lint  # 0 errors, warnings tolerated only if pre-existing
bun run build
bun --filter @persistence/core test:unit
```

Expected delta: ~25–40 new core tests (helper + handler integration coverage).

## Files you will touch

```
microservices/core/src/application/entitlement/
  assertEntitlement.ts                                          # new
  __tests__/assertEntitlement.test.ts                            # new
microservices/core/src/shared/errorHandler.ts                    # extend (recognise EntitlementError)
microservices/core/src/application/workouts/create/
  workoutsCreateHandler.ts                                       # add assertEntitlement call
  __tests__/workoutsCreateHandler.test.ts                        # extend
microservices/core/src/application/sessions/record/
  sessionsRecordHandler.ts                                       # add assertEntitlement call (fresh-workout branch only)
  __tests__/sessionsRecordHandler.test.ts                        # extend
```

## Files you will NOT touch

- `packages/mobile/` — frontend agents' territory
- `packages/db/src/schema.ts` — no schema changes in M10.5
- The trigger / migrations — `update_subscription_limits_trigger` stays untouched
- The Stripe handlers (`subscriptions/create`, `subscriptions/cancel`, `stripe/webhook`) — they're final for M10.5
- `scripts/reconcile-stripe.ts` — out of scope

## Inspector Brad expectations

M10 PR took 8 sweeps to close 14 findings on a much larger surface. M10.5 backend is a smaller surface but the helper is critical-path. Expect 1–3 sweeps.

Patterns Brad has flagged on previous PRs that apply here:

- Reading from `user_subscriptions.payment_status` without joining `subscription_tiers` (you lose the tier feature flags)
- Forgetting that `payment_status = 'trialing'` is a valid premium state
- Forgetting that "cancelled-but-active" (cancelled with `expires_at` in the future) should still be treated as entitled until `expires_at`
- Using `Date.now()` for "is this sub expired" checks where the trigger already maintains accurate state — prefer reading the trigger's outputs over recomputing

TRACE before patching. Same protocol as M10.

## When you finish

- Tests pass with 100% branch coverage on `assertEntitlement.ts`; 90%+ on handlers
- Commit + push to your worktree branch (the orchestrator merges into `feat/m10-5-entitlement`)
- Report:
  - Branch name
  - Commits + line counts
  - Test delta
  - Any spec amendment flags
  - Any decisions that diverged from this brief + the why
