# FOUNDING-OFFER — backend brief

> **2026-09-04 amendment:** `BRIEF.md`'s grant-model amendment supersedes the
> mandatory-payment and fixed-six-month assumptions below. Contributions are
> optional metadata independent of access; grants have an explicit kind,
> configurable duration, database-backed capacity, and an audited extension
> operation. Admin grants do not lock referral attribution as paid conversion.

Read `BRIEF.md` first (decisions D1–D9 are binding). Conventions:
`.claude/skills/elysia-route-change/SKILL.md`, root `CLAUDE.md` § Authorization
Pattern, handler path `src/application/{domain}/{action}/{domain}{Action}Handler.ts`,
sub-app per domain mounted once in `src/api.ts` (root chain is at the TS2589
ceiling — **never** add more than one root `.use()` per PR).

## 1. Migration `supabase/migrations/20260904120000_founding_offer_referrals.sql`

Idempotent (`IF NOT EXISTS`), additive only. Tables:

### `referral_codes`

| column                  | type                                                                   | notes                                             |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| id                      | uuid pk default gen_random_uuid()                                      |                                                   |
| code                    | text not null                                                          | canonical: upper-case, `[A-Z0-9]{4,24}`; `UNIQUE` |
| display_code            | text not null                                                          | as entered, for UI                                |
| label                   | text not null                                                          | e.g. "Uni of Nottingham freshers fair"            |
| partner_name            | text                                                                   | vendor / partner                                  |
| kind                    | text not null check in ('vendor','campaign','founding','internal')     |                                                   |
| status                  | text not null default 'active' check in ('active','paused','archived') |                                                   |
| max_redemptions         | integer                                                                | null = unlimited                                  |
| redemption_count        | integer not null default 0                                             | maintained atomically by the claim tx             |
| starts_at / ends_at     | timestamptz                                                            | optional validity window                          |
| campaign_slug           | text                                                                   | optional link to web `CAMPAIGNS` slug             |
| notes                   | text                                                                   |                                                   |
| created_by              | uuid references profiles(id) on delete set null                        |                                                   |
| created_at / updated_at | timestamptz not null default now()                                     |                                                   |

### `referral_redemptions`

| column                  | type                                                    | notes                                      |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------ |
| id                      | uuid pk                                                 |                                            |
| code_id                 | uuid not null references referral_codes(id)             |                                            |
| user_id                 | uuid not null references profiles(id) on delete cascade | **UNIQUE** — one attribution per user (D5) |
| source                  | text not null check in ('app','admin','web_link')       |                                            |
| locked_at               | timestamptz                                             | set at first paid conversion (D5)          |
| replaced_code_id        | uuid references referral_codes(id)                      | previous code when the user swapped        |
| created_by              | uuid references profiles(id)                            | admin actor when source='admin'            |
| created_at / updated_at | timestamptz                                             |                                            |

Index `referral_redemptions_code_id_idx (code_id)`.

### `founding_grants`

| column            | type                                                                            | notes                                              |
| ----------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| id                | uuid pk                                                                         |                                                    |
| user_id           | uuid not null references profiles(id) on delete cascade                         |                                                    |
| tier_name         | text not null references subscription_tiers(tier_name)                          | `premium` / `premium_plus` / `start_up_coach_plus` |
| months            | integer not null default 6                                                      |                                                    |
| amount_minor      | integer not null                                                                | pence                                              |
| currency          | text not null default 'GBP'                                                     |                                                    |
| payment_method    | text not null check in ('bank_transfer','stripe_link','card_in_person','other') |                                                    |
| payment_reference | text                                                                            | bank ref / Stripe payment id                       |
| paid_at           | timestamptz not null                                                            |                                                    |
| referral_code_id  | uuid references referral_codes(id)                                              | attribution captured at grant                      |
| subscription_id   | uuid references user_subscriptions(id)                                          | the row this grant created                         |
| granted_by        | uuid not null references profiles(id)                                           |                                                    |
| revoked_at        | timestamptz                                                                     |                                                    |
| revoke_reason     | text                                                                            |                                                    |
| notes             | text                                                                            |                                                    |
| created_at        | timestamptz                                                                     |                                                    |

Index on `user_id`; partial unique index `founding_grants_user_active_uq (user_id) where revoked_at is null` (one live founding grant per user).

### `admin_audit_log`

`id, actor_id uuid not null, action text not null, entity_type text not null, entity_id text, before jsonb, after jsonb, reason text, created_at timestamptz default now()`. Append-only; index `(entity_type, entity_id)` and `(created_at desc)`.

Mirror all four in `packages/db/src/schema.ts` (+ `$inferSelect/$inferInsert` types), keeping index parity as `trainerInviteCodes` does. Confirm `subscription_tiers.tier_name` has a unique constraint before referencing it (it is the FK target used by `user_subscriptions.tier_name` — check migration 004; if it isn't unique, reference `subscription_tiers(id)` instead and store `tier_id`).

## 2. Auth helper — `packages/api-utils/src/auth/supabaseAuth.ts`

- Extend `SupabaseUser` with `app_metadata?: { admin?: boolean; [k: string]: unknown }` (Supabase puts `app_metadata` in the access token).
- Add `isAdmin(user): boolean` → `user.app_metadata?.admin === true`.
- Add `requireAdmin(ctx)` onBeforeHandle: 401 if no user, **403 `{ message: "Forbidden" }`** if not admin. Constant response shape; never reveal why.
- Unit tests alongside existing `supabaseAuth` tests.
- Script `scripts/src/set-admin.ts` (workspace `@persistence/scripts`): `bun run set-admin <email> [--revoke]` — uses the existing `supabaseAdminClient` pattern (`microservices/core/src/application/account/supabaseAdminClient.ts`) to `auth.admin.updateUserById(id, { app_metadata: { admin: true } })`. Document that the user must sign out/in (new JWT) for it to take effect.

## 3. Constants — `microservices/core/src/application/founding/foundingOffer.ts`

```ts
export const FOUNDING_OFFERS = {
  premium: { months: 6, priceMinor: 3000, pool: "consumer" },
  premium_plus: { months: 6, priceMinor: 5000, pool: "consumer" },
  start_up_coach_plus: { months: 6, priceMinor: 9900, pool: "coach" },
} as const;
export const FOUNDING_POOL_CAPS = { consumer: 200, coach: 20 } as const;
```

`amount_minor` on a grant is what was actually paid (admin-entered, defaults to the list above); the cap counts **non-revoked grants per pool**.

## 4. Routes

### 4a. Admin sub-app `src/application/adminRoutes.ts`

⚠ Measured 2026-09-03: adding `adminRoutes` as a root `.use()` in `api.ts` tips the root chain into TS2589. It is therefore mounted from `subscriptionsRoutes` (one level down), alongside `referralsHandler`.

All handlers: `.derive(getAuthUser)` → `.onBeforeHandle(requireAdmin)`. Every mutation writes an `admin_audit_log` row in the same transaction.

| Method & path                                       | Behaviour                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `GET /admin/summary`                                | `{ founding: { consumer: { used, cap }, coach: { used, cap }, byTier, revenueMinor }, referrals: { codes, claims, lockedClaims }, recentGrants[] }`                                                           |
| `GET /admin/users?email=`                           | Exact-match (case-insensitive) lookup → `{ id, email, role, createdAt, subscription: { tierName, paymentStatus, expiresAt, externalSubscriptionId }                                                           | null, attribution: { code, label }                                                                                       | null }`. Never list all users. |
| `GET /admin/referral-codes?status=&q=`              | List with `redemptionCount`, `grantCount` (founding grants carrying the code), `paidCount` (redemptions with `locked_at`).                                                                                    |
| `POST /admin/referral-codes`                        | Body: `{ code, label, partnerName?, kind, maxRedemptions?, startsAt?, endsAt?, campaignSlug?, notes? }`. Normalise `code` (trim, upper, strip spaces/hyphens), validate `^[A-Z0-9]{4,24}$`, 409 on duplicate. |
| `PATCH /admin/referral-codes/:id`                   | `status`, `label`, `partnerName`, `maxRedemptions`, `startsAt`, `endsAt`, `notes`. `code` immutable.                                                                                                          |
| `GET /admin/referral-codes/:id/redemptions`         | Paginated `{ userId, email, source, lockedAt, createdAt }`.                                                                                                                                                   |
| `POST /admin/referral-attributions`                 | `{ userId, code, reason }` — admin sets/replaces a user's attribution (`source='admin'`); 409 if locked.                                                                                                      |
| `GET /admin/founding-grants?revoked=`               | List joined with email, tier, code label.                                                                                                                                                                     |
| `POST /admin/founding-grants`                       | Body `{ email                                                                                                                                                                                                 | userId, tierName, amountMinor?, currency?, paymentMethod, paymentReference?, paidAt?, referralCode?, notes? }`. See § 5. |
| `POST /admin/founding-grants/:id/revoke`            | `{ reason }` → sets `revoked_at`, cancels the linked `user_subscriptions` row (`payment_status='cancelled'`, `expires_at=now()`), frees the seat.                                                             |
| `GET /admin/audit-log?entityType=&entityId=&limit=` | Newest first.                                                                                                                                                                                                 |

### 4b. User sub-app `src/application/referralsRoutes.ts` — join to an **existing** sub-app rather than adding a root `.use()`: mount inside `subscriptionsRoutes` (attribution is subscription-adjacent) to stay under the TS2589 ceiling.

| Method & path                      | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `POST /referrals/claim` `{ code }` | Normalise; one transaction: `UPDATE referral_codes SET redemption_count = redemption_count + 1 WHERE code = $1 AND status='active' AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()) AND (max_redemptions IS NULL OR redemption_count < max_redemptions) RETURNING id, label, partner_name` — zero rows → 404 `{ message: "That code isn't valid" }` (uniform; never say exhausted/paused/expired). Then upsert `referral_redemptions` on `user_id`: if existing row `locked_at IS NOT NULL` → roll back the increment and 409 `{ message: "Your referral is already locked in" }`; if replacing, decrement the old code's count and set `replaced_code_id`. Response `{ code: displayCode, label, partnerName, lockedAt: null }`. Rate limit: 10 attempts / user / hour (in-memory per Lambda is acceptable for v1; note it). |
| `GET /referrals/me`                | `{ applied: { code, label, partnerName, lockedAt }                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | null }` |
| `DELETE /referrals/me`             | Remove attribution if not locked (decrement count); 409 if locked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 4c. Lock hook

`src/application/referrals/lockReferralAttribution.ts`: `UPDATE referral_redemptions SET locked_at = now() WHERE user_id = $1 AND locked_at IS NULL`. Called (best-effort, errors logged not thrown) from the founding-grant handler and from `syncRevenueCatCustomer` in the `activated` branch.

## 5. Founding grant — `src/application/founding/foundingGrantService.ts`

**Live-at-the-stand flow (Brad, 2026-09-03):** the admin takes the buyer's email and tier, records the payment, and the buyer receives an email invite. If the email already belongs to an account the subscription row is written immediately; otherwise the grant is stored **pending** (`founding_grants.user_id IS NULL`, keyed by lower-cased `email`) and is applied on the buyer's first authenticated `GET /subscriptions/me` after they sign up with that email (`FoundingGrantService.applyPendingForUser`, wired into `subscriptionsMeHandler`; idempotent, never throws). Pending grants hold a seat. The invite email goes through the existing Resend client (`leads/resendClient.ts`) and links to `${WEB_ORIGIN}/qr/founding`; a send failure is reported in the response but never fails the grant (`invited: false, inviteError`).

Repository transaction (`FoundingGrantRepository.create`, under `pg_advisory_xact_lock(hashtext('founding_pool_<pool>'))`):

1. Resolve user by `userId` or exact email (`profiles.email` ILIKE); 404 with `{ message: "No account with that email — ask them to sign up first" }`.
2. Validate `tierName ∈ FOUNDING_OFFERS`; tier row exists in `subscription_tiers`.
3. Seat check: `SELECT count(*) FROM founding_grants WHERE revoked_at IS NULL AND tier_name IN (<pool tiers>) FOR UPDATE`-equivalent via advisory lock `pg_advisory_xact_lock(hashtext('founding_pool_' || pool))`; 409 `{ message: "Founding pool is full" }` when `used >= cap`.
4. 409 if the user already has a live founding grant.
5. `SubscriptionRepository.cancelLiveSubscriptions(userId)` (same call the RC sync uses), then insert `user_subscriptions` per D3, with `metadata = { source: 'founding_offer', grant_id, payment_method, payment_reference, referral_code }`.
6. Insert `founding_grants` (link `subscription_id`).
7. If `referralCode` given: upsert attribution (`source='admin'`, replaces an unlocked one, 409 if a _different_ locked code exists), then `lockReferralAttribution(userId)`.
8. `admin_audit_log` row (`action='founding_grant.create'`, `after` = grant).
9. Response `{ grant, subscription: { tierName, expiresAt }, seats: { pool, used, cap } }`.

⚠ Trigger side-effect (STATE.md): `update_subscription_limits_trigger` sets `profiles.role` from `is_trainer_tier` — a consumer grant to a `personal_trainer` account demotes it to `user`. The handler must **refuse** (409, `{ message: "This account is a coach — grant a coach tier or use a second account" }`) when `profiles.role IN ('personal_trainer','physiotherapist')` and the tier is a consumer tier, unless body `allowRoleChange: true`.

## 6. Tests (vitest, `microservices/core`)

- `requireAdmin`: 401 / 403 / pass.
- Claim tx: valid, unknown, paused, exhausted (cap reached under two concurrent claims — assert exactly `max_redemptions` succeed), expired window, replace unlocked, refuse locked, delete.
- Founding grant: happy path per tier, email-not-found, pool full, duplicate live grant, coach-demotion refusal, cancels prior live row, attribution attached + locked, revoke frees seat and cancels the sub.
- RC sync `activated` branch calls the lock hook (mock).
- `GET /subscriptions/me` for a founding user returns `premium`/`premium_plus` active with `expiresAt` ≈ +6 months and `cancelledAt` set (drives the "active until" banner).
- Repository-level parity test for the new schema tables (mirror `activeSubscriptionIndexParity.test.ts` style if the partial unique index is declared in Drizzle).

## 7. Definition of done

`bun run typecheck && bun run lint && bun run test:unit` green at repo root; migration applied on staging by the merge pipeline; `SMOKE_TEST.md § Backend` passes against staging with Brad's account flagged admin via `set-admin`; STATE.md session entry written.
