# FOUNDING-OFFER — smoke test & release checklist

Run against **staging** after each PR merges; the whole list before the prod release.

## Staging preconditions

1. **Supabase Confirm email is ON in this environment.** Verify in Authentication → Providers → Email before creating any pending grant.
2. The founding migration has applied and `referral_codes`, `referral_redemptions`, `founding_grants`, and `admin_audit_log` exist.
3. The Auth redirect allow-list includes the staging `/admin/callback`, `VITE_SUPABASE_ANON_KEY` is set, and the admin panel can fetch the API cross-origin.

## Backend

1. `bun run set-admin <brad staging email>` → sign out/in on a client → JWT `app_metadata.admin === true`.
2. Non-admin token → `GET /admin/summary` = 403; admin token = 200 with seat caps 200 / 20.
3. `POST /admin/referral-codes {code:"uon freshers", label:"UoN freshers", kind:"vendor", maxRedemptions:2}` → stored as `UONFRESHERS`; duplicate → 409.
4. As test user A: `POST /referrals/claim {code:"uonfreshers"}` → 200; user B same → 200; user C → 404 uniform message; `GET /admin/referral-codes` shows 2/2.
5. User A: `POST /referrals/claim` with a second active code → replaces (first code back to 1/2). `DELETE /referrals/me` → removed.
6. `POST /admin/founding-grants {email: <user B>, tierName:"premium", paymentMethod:"bank_transfer", paymentReference:"TEST1", referralCode:"UONFRESHERS"}` → 201; `GET /subscriptions/me` as B → `premium`, `paymentStatus=active`, `expiresAt` ≈ +6 months, `cancelledAt` set; B's attribution now `lockedAt` set; B claiming another code → 409.
7. Pending redemption negative path: record a grant for a fresh mailbox; sign up with exactly that email but do not confirm it; `GET /subscriptions/me` remains free. Confirm the email; the next read shows the purchased tier. Fire two first reads concurrently and verify only one applies the grant and writes the subscription/audit rows.
8. Grant to a user with a live `rc_` subscription → 409 `active_store_subscription`. Repeat with the explicit override after explaining the sync risk → grant succeeds and the audit records it.
9. Grant `premium_plus` to a `personal_trainer` test account without `allowRoleChange` → 409 with the coach message; explicit override succeeds.
10. Grant with `paymentMethod:"bank_transfer"` and an empty/blank `paymentReference` → 400 `payment_reference_required` with “Enter the bank or Stripe reference for this payment”. Repeat for `stripe_link`; verify `card_in_person` and `other` remain optional.
11. Delete the account of a granted user → the grant survives with `user_id NULL`, status `account_deleted`, and the seat still counted. A new account using that email does not inherit the old grant; a new paid grant is allowed.
12. Revoke B's grant → `GET /subscriptions/me` reverts to free; seat count decrements; audit log shows create + revoke.
13. Fill the coach pool to 20 in a script → 21st → 409 “Founding pool is full”.
14. RevenueCat sandbox purchase on a founding account → RC webhook → `user_subscriptions` shows the `rc_` row live and the `founding_` row cancelled (superseded).
15. Restore Purchases on a founding account with **no** store subscription → founding row untouched.

## Web

16. `/admin` unauthenticated → login; magic link → dashboard renders summary.
17. Non-admin account → “not an admin” page, no data leaked.
18. Create grant via the form for a fresh test user; success shows seats remaining; user appears in table; Revoke works with reason.
19. Codes page: create, pause (claims now 404), archive, copy link → `/qr/default?ref=CODE` loads Home with the referral banner and `store_click` carries `ref`.
20. `/founding` renders both prices, coach line, counter, funding, out-of-band payment/access instructions, redemption deadline, and cancellation text. It renders no `Pay for` button and no bank-details section. Lighthouse a11y ≥ 95; light/dark.
21. `/privacy` and the in-app Privacy Policy both show the 4 September 2026 date and the founding-purchase retention disclosure.

## Mobile (next release)

22. Onboarding: code row optional; Skip with a half-typed code proceeds; Apply valid code → “Applied”; invalid → neutral error.
23. Subscription Selection: applied state shown; prices unchanged with/without code; locked state read-only.
24. Founding account: “active until <date>” banner reads correctly; after `expires_at` (set in DB) the gate prompt copy is sensible.

## Release (prod)

- [ ] **Supabase Confirm email is ON in this environment.** Verify by eye and query recent email users: real confirmations occur after mailbox interaction, not automatically within seconds of creation.
- [ ] Migration dry-run reviewed: every migration since v1.8.0 is additive (no DROP/RENAME); spot-check `20260805120000_coach_ladder_restructure.sql`, `20260901120000_onboarding_states.sql`, and the founding migration.
- [ ] After migration, `referral_codes`, `referral_redemptions`, `founding_grants`, and `admin_audit_log` exist and the deployed Lambda is from the same release.
- [ ] RevenueCat production webhook URL + secret point at the **prod** API; verify foreign-environment ids log `[revenuecat:sync] skipping`, not 500s.
- [ ] `set-admin` run against prod for exactly Brad's admin email; sign out/in and verify `app_metadata.admin`.
- [ ] Prod Auth redirect allow-list contains the production `/admin/callback` URL.
- [ ] Web env contains the production `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_CORE_API_URL`; the four removed public founding payment variables are absent.
- [ ] Admin panel fetches succeed cross-origin.
- [ ] Pause or delete the dead Supabase project `dfeyebgdktfteqlacmru` so tooling cannot target it by mistake.
- [ ] Privacy policy is approved and published; solicitor-approved Terms wording is in place before sales.
- [ ] Run the Backend + Web smoke sections against production with test data, including the unconfirmed-email negative path, store-subscription refusal, deletion retention, and mandatory-reference checks.
- [ ] Brad's own account is granted first (active path), then one fresh mailbox is tested pending → confirmed → active end to end on a store build.
- [ ] Only then take the first paying customer; reconcile grant exports against Stripe/bank weekly.
- [ ] STATE.md updated; CHANGELOG entry; tag release.
