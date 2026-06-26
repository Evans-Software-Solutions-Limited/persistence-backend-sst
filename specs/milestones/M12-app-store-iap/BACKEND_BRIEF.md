# M12 Subscriptions — BACKEND brief (agent 1, lands first)

> RevenueCat-fronted architecture. Replaces the prior hand-rolled receipt design — there is **no**
> `verifyAppleReceipt`, `grantIosSubscription`, `ios-receipt` handler, or `external_subscription_id`
> unique-index migration in this version. RevenueCat owns receipt validation, replay defence,
> renewals, refunds, grace periods. First step: `git fetch && git reset --hard origin/<branch>`.
>
> **Read first:** `BRIEF.md` (model, identity rule, tier↔entitlement table, canonical-table guard).
> Reuse reference: existing Stripe webhook handler `microservices/core/src/application/stripe/`,
> `application/entitlement/` (`assertEntitlement`), `subscriptionsCreateHandler.ts`,
> `packages/db/src/schema.ts:293` (`userSubscriptions`).

## Deliverable 1 — RevenueCat webhook handler (the new source-of-truth writer)

`microservices/core/src/application/revenuecat/handlers/webhook.ts`, registered in `api.ts` as
`POST /webhooks/revenuecat`. **Unauthenticated by JWT** (RevenueCat calls it) — instead:

1. **Auth:** verify the static `Authorization` header against an SST Secret (`RevenueCatWebhookSecret`).
   **Constant-time compare.** RevenueCat uses a shared bearer secret — there is NO HMAC/payload
   signature. Reject non-match with 401. HTTPS only.
2. **Dedup:** RevenueCat delivery is at-least-once and **unordered**; dedup on `event.id`
   (retries reuse the same id). Skip already-processed event ids (small processed-id table or
   idempotent upsert keyed on customer state — see step 4).
3. **Re-fetch, don't trust the event body** (RevenueCat's explicit recommendation — sidesteps
   ordering): on ANY event, call the REST API for the affected customer and rebuild state from that
   snapshot. Use v2 `GET /projects/{project_id}/customers/{app_user_id}/active_entitlements` (Bearer
   `sk_` secret key, server-only, in an SST Secret). The v2 **`gives_access`** boolean is the
   access flag — it already abstracts grace periods + billing retry. (v1 `GET /subscribers` is the
   alternative but its `entitlements` dict includes EXPIRED ones — you'd have to compare
   `expires_date`/`grace_period_expires_date` to now yourself. Prefer v2 `gives_access`.)
   - **TRANSFER events** carry `transferred_from`/`transferred_to`, not a single `app_user_id` —
     handle specially (re-fetch both).
4. **Map → upsert `user_subscriptions`** keyed on `user_id` (= App User ID = Supabase id):
   - Map the active RC entitlement id → `SubscriptionTierName` (`premium`, `individual_trainer`,
     `small_business`, `medium_enterprise`); none active → `free`.
   - Set `tier_name`, `payment_status` (active / cancelled-but-active-until-period-end / expired),
     `expires_at`, `billing_cycle`, `external_subscription_id` = the store transaction/sub id,
     `metadata.source` = `'revenuecat'` + RC store (`app_store` / `stripe`) + product id.
   - Respect the existing `user_subscriptions_active_unique` partial index (one active row per user)
     — upsert in place, mirror how `subscriptionsCreateHandler` updates rather than inserts a 2nd row.
   - Return 200 within 60s (RC retries 5×: 5/10/20/40/80 min) or RC marks failure.

**Grant/revoke mapping** (docs + community consensus — confirm against RC docs at impl time): grant
on `INITIAL_PURCHASE` / `RENEWAL` / `UNCANCELLATION` / `NON_RENEWING_PURCHASE` /
`PRODUCT_CHANGE`; keep access on `CANCELLATION` (until period end) + `BILLING_ISSUE` (grace);
revoke on `EXPIRATION`. Because we re-fetch on every event (step 3), the per-type branching is
mostly about which customer(s) to re-fetch — `gives_access` decides the final state.

## Deliverable 2 — seed existing Stripe subscriptions into RevenueCat

So Stripe/web purchases unlock entitlements under the same identity. Two layers (do both):

1. **Dashboard auto-track** (Brad enables the Stripe S2S "track new purchases" toggle) — primary.
2. **Belt-and-braces from our existing Stripe webhook:** when a Stripe subscription is
   created/updated in `application/stripe/eventHandlers/`, POST to RevenueCat's receipts endpoint
   `{ fetch_token: <stripe sub_… id>, app_user_id: <supabaseUserId> }` with header `X-Platform: stripe`.
   - **`app_user_id` MUST be the Supabase user id** — this is the identity binding that merges the
     Stripe purchase with the user's Apple entitlements. If our Stripe Customer/sub isn't already
     tagged with the Supabase id, ensure we have it at webhook time (it's the row's `user_id`).
   - Fire-and-forget with retry/log; a failure here is recoverable (auto-track covers it) but log it.

## Deliverable 3 — tier mapping module + types

`microservices/core/src/application/revenuecat/entitlements.ts`:
`rcEntitlementToTier(entitlementId): SubscriptionTierName` (throws on unknown), and the inverse map
for any product registration. Single source mirrored by the mobile config.

## What is NOT in this version (removed vs the prior draft)

- ❌ `verifyAppleReceipt`, `grantIosSubscription`, `POST /subscriptions/ios-receipt`.
- ❌ `user_subscriptions_external_sub_uq` migration + the ownership-gated transaction (RC owns
  receipt replay / cross-user binding via App User ID). T-12.13.1 confirms **no schema change** is
  needed; if the team wants a processed-`event.id` dedup table, that's the only candidate migration.

## Tests (90% on changed files; no fake tests — prove behaviour)

- Webhook auth: wrong/missing `Authorization` → 401; correct → 200. Constant-time compare.
- Dedup: same `event.id` twice → second is a no-op.
- Re-fetch + map: mocked v2 `active_entitlements` with `gives_access:true` for `premium` → row
  upserted to `premium`/active with correct `expires_at`; `gives_access:false` / no active → `free`.
- Each lifecycle path (INITIAL_PURCHASE, RENEWAL, CANCELLATION→still active until period end,
  EXPIRATION→revoked, BILLING_ISSUE→grace, PRODUCT_CHANGE, TRANSFER) drives the right final state.
- Stripe-seed: on Stripe sub create, a POST to RC fires with `fetch_token`=sub id +
  `app_user_id`=Supabase id + `X-Platform: stripe`; failure is logged, not fatal.
- Active-unique: an Apple grant for a user with a pre-existing active Stripe row resolves to one
  active row (upsert in place, no `user_subscriptions_active_unique` violation).
- Render real SQL via `PgDialect` for the upsert (unit suite mocks `getDb` — SQL bugs ship green
  otherwise; see `reference_drizzle_groupby_param_bug`).

## Gate (from repo root)

`bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit`
— 90% coverage on changed files.
