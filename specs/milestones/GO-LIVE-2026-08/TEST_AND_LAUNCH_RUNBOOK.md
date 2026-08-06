# Test & Launch Runbook — GO-LIVE 2026-08

**Written 2026-08-06, post-merge of #361/#362/#363/#364/#365.** Operational steps to
(a) test the entitled paths on staging and (b) go live. Code is complete for this
slice; the remaining work here is **operational and Brad's**.

> ⚠ **Project refs.** Staging = `nxkhlrvjxotyjulodxzk`. Prod = `opcvjypsoivaxerahbal`.
> **Prod is read-only in every step below unless a line explicitly says "prod launch".**
> The Supabase MCP connector currently exposes **prod only** — staging SQL is run by
> Brad (SQL editor / psql), not by an agent.

---

## 0. What is already true on `main` (don't redo)

- The **six IAP tiers are ACTIVE** (`is_active = true`) — activated by #362's
  `20260805180000_activate_iap_coach_ladder.sql`. The old `small_business` /
  `medium_enterprise` tiers are inactive tombstones.
- Prices per `specs/29-subscription-restructure/design.md` § 1, with
  **`start_up_coach_plus` annual = £289.99** (ASC-valid price point; #362's fix migration).
- Staging has **auto-deployed** these migrations on each merge (Deploy Staging workflow).
- ⚠ **Active tiers + no ASC/RevenueCat products = the 2.1(b) rejection.** Do NOT cut a
  prod release / App Store build until § 4 (store config) is done.

---

## 1. OFF re-seed (Mealprint candidate pool) — Brad, operational

Without this, every allergen filter empties the candidate pool and Mealprint looks
broken (all ~144k seeded `foods` rows have NULL `allergen_tags` / `categories_tags`).

- Script + full instructions: **`microservices/core/src/scripts/seedOpenFoodFacts.ts`**
  (header has the DuckDB filter over the OFF Parquet dump → NDJSON → idempotent upsert).
- The updated script now selects `allergens_tags` + `categories_tags`, so re-running it
  **backfills** those columns. Idempotent (upsert by `code`).
- ⚠ Run it **after** the tag-column migration is applied (staging: already deployed).
- Until it runs, QA Mealprint with **no allergen chips** (an allergen chip correctly
  returns `emptyReason: "no_candidates"` against an untagged pool).

---

## 2. Staging entitlement — to reach the ENTITLED Mealprint path

Mealprint's generation is gated on `premium_plus`. Give a staging test account a live row.

⚠ **TRIGGER TRAP:** `update_subscription_limits` derives `profiles.role` from the tier's
`is_trainer_tier`. `premium_plus` is `is_trainer_tier = false`, so writing this row sets
`role = 'user'` — **knocking the account out of coach mode (and it would demote an admin).**
Use a **second test account**, or accept the flip knowingly.

```sql
-- staging nxkhlrvjxotyjulodxzk — NOT prod
-- 0. sanity: the tier resolves and grants mealprint
select tier_name, is_active, mealprint_access, is_trainer_tier
  from subscription_tiers where tier_name = 'premium_plus';   -- expect mealprint_access = true

-- 1. does the account already have a live sub? (a second INSERT violates the
--    one-live-sub-per-user unique constraint — UPDATE it instead)
select p.id, p.role, s.id as sub_id, s.tier_name, s.payment_status
  from profiles p
  left join user_subscriptions s
    on s.user_id = p.id and s.payment_status in ('active','pending','trialing','past_due')
 where p.email = '<staging test account>';

-- 2a. NO live row → insert
insert into user_subscriptions (user_id, tier_name, payment_status, starts_at)
values ('<uuid>', 'premium_plus', 'active', now());

-- 2b. live row exists → switch it (records the old tier so it can be restored)
update user_subscriptions
   set tier_name = 'premium_plus', payment_status = 'active',
       metadata = coalesce(metadata,'{}'::jsonb)
                  || jsonb_build_object('device_qa_prev_tier', tier_name)
 where user_id = '<uuid>'
   and payment_status in ('active','pending','trialing','past_due');
```

Verify: call `GET /subscriptions/me` as that user → `tierName` = `premium_plus`.
Reversible: restore `tier_name` from `metadata.device_qa_prev_tier`; the trigger restores role.

---

## 3. Verify prod + staging catalog data (Brad flagged) — read-only

Run on **both** DBs and eyeball that the coach-ladder migration landed correctly.

```sql
select tier_name, display_name, price_monthly, price_yearly, is_active,
       is_trainer_tier, loadout_access, mealprint_access, trainer_client_limit
from subscription_tiers
order by is_active desc, price_monthly nulls first;
```

Expect (active rows):

| tier_name                           | £/mo  | £/yr       | trainer | loadout | mealprint | clients |
| ----------------------------------- | ----- | ---------- | ------- | ------- | --------- | ------- |
| premium                             | 16.99 | 139.99     | ✗       | ✗       | ✗         | —       |
| premium_plus                        | 29.99 | 249.99     | ✗       | ✓       | ✓         | —       |
| individual_trainer (Start Up Coach) | 18.99 | 159.99     | ✓       | ✗       | ✗         | 5       |
| start_up_coach_plus                 | 34.99 | **289.99** | ✓       | ✓       | ✓         | 5       |
| coach                               | 59.99 | 499.99     | ✓       | ✓       | ✓         | 15      |
| coach_pro                           | 99.99 | 839.99     | ✓       | ✓       | ✓         | 30      |

`small_business` / `medium_enterprise` should be **`is_active = false`** (tombstones).

⚠ **Do we need to RESET subscription data?** Not for schema safety — the migration kept
retired tiers as FK-safe tombstones, so nothing breaks. Reset (clear `user_subscriptions`)
only to avoid: (a) a test account left on a retired tier / old price, and (b) the Apple
**price-increase consent** flow that a live sub at an old price would trigger. Prod + staging
hold only test accounts + Brad's, and the reset is **authorised** — so clearing
`user_subscriptions` before launch is the clean path. It does NOT touch workouts/sessions
(separate tables) — Brad's own prod workouts are safe from a subscription reset.

---

## 4. Store config (launch gate) — Brad, operational

The one thing between here and a submittable build. Full detail in the RevenueCat/ASC
runbook given in chat (2026-08-05). In short:

- **App Store Connect:** create the 12 IAP products (6 tiers × monthly/annual) at the
  prices in § 3; `start_up_coach_plus` annual at £289.99.
- **RevenueCat:** entitlement id === tier_name for all six; every product in the
  **`default`** offering, marked current. Archive `small_business` / `medium_enterprise`.
- **App Review Info:** add a **coach demo/invite code** (the open 2.1(a) item).
- Then: prod release (deploys + migrates prod) → new iOS build → resubmit.

---

## 5. Device QA once § 1–2 are done

- **Mealprint entitled path:** suggest sheet (all stages incl. draft-stage pinned Accept
  inside the gorhom sheet), plan flow (config → generating → draft review → accept), the
  per-item serving stepper (gap-2), recipe/meal-backed accept (gap-1), Fuel `PlanToday`.
- **Workout limit:** free account with 4+ workouts → both start paths route to the lock
  screen; deleting to ≤3 (or upgrading) clears it AND flushes any stranded finished session.
- **Paywall (#362):** renders the six tiers; a real purchase needs the § 4 sandbox products.
