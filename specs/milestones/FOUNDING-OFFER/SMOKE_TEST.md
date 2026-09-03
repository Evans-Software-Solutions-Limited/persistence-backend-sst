# FOUNDING-OFFER — smoke test & release checklist

Run against **staging** after each PR merges; the whole list before the prod release.

## Backend

1. `bun run set-admin <brad staging email>` → sign out/in on a client → JWT `app_metadata.admin === true`.
2. Non-admin token → `GET /admin/summary` = 403; admin token = 200 with seat caps 200 / 20.
3. `POST /admin/referral-codes {code:"uon freshers", label:"UoN freshers", kind:"vendor", maxRedemptions:2}` → stored as `UONFRESHERS`; duplicate → 409.
4. As test user A: `POST /referrals/claim {code:"uonfreshers"}` → 200; user B same → 200; user C → 404 uniform message; `GET /admin/referral-codes` shows 2/2.
5. User A: `POST /referrals/claim` with a second active code → replaces (first code back to 1/2). `DELETE /referrals/me` → removed.
6. `POST /admin/founding-grants {email: <user B>, tierName:"premium", paymentMethod:"bank_transfer", paymentReference:"TEST1", referralCode:"UONFRESHERS"}` → 200; `GET /subscriptions/me` as B → `premium`, `paymentStatus=active`, `expiresAt` ≈ +6 months, `cancelledAt` set; B's attribution now `lockedAt` set; B claiming another code → 409.
7. Grant `premium_plus` to a `personal_trainer` test account without `allowRoleChange` → 409 with the coach message.
8. Revoke B's grant → `GET /subscriptions/me` reverts to free; seat count decrements; audit log shows create + revoke.
9. Fill the coach pool to 20 in a script → 21st → 409 "Founding pool is full".
10. RevenueCat sandbox purchase on a founding account → RC webhook → `user_subscriptions` shows the `rc_` row live and the `founding_` row cancelled (superseded).
11. Restore Purchases on a founding account with **no** store subscription → founding row untouched.

## Web

12. `/admin` unauthenticated → login; magic link → dashboard renders summary.
13. Non-admin account → "not an admin" page, no data leaked.
14. Create grant via the form for a fresh test user; success shows seats remaining; user appears in table; Revoke works with reason.
15. Codes page: create, pause (claims now 404), archive, copy link → `/qr/default?ref=CODE` loads Home with the referral banner and `store_click` carries `ref`.
16. `/founding` renders both prices, coach line, counter, bank + Stripe buttons, cancellation text; Lighthouse a11y ≥ 95; light/dark.

## Mobile (next release)

17. Onboarding: code row optional; Skip with a half-typed code proceeds; Apply valid code → "Applied"; invalid → neutral error.
18. Subscription Selection: applied state shown; prices unchanged with/without code; locked state read-only.
19. Founding account: "active until <date>" banner reads correctly; after `expires_at` (set in DB) the gate prompt copy is sensible.

## Release (prod)

- [ ] `production-deploy.yml` dry-run output reviewed: lists every migration since v1.8.0 — all additive (no DROP/RENAME). Spot-check `20260805120000_coach_ladder_restructure.sql` and `20260901120000_onboarding_states.sql`.
- [ ] Prod `subscription_tiers` will gain `premium_plus`, `start_up_coach_plus`, `coach`, `coach_pro` and `loadout_access`/`mealprint_access` — confirm the deployed Lambda is the same release (migrate-then-deploy order is the pipeline default).
- [ ] RevenueCat production webhook URL + secret point at the **prod** API (STATE.md: one RC project fans out to both envs; prod must skip staging ids, staging must skip prod ids — verify `[revenuecat:sync] skipping` logs, not 500s).
- [ ] `set-admin` run against prod for Brad's admin email; sign out/in.
- [ ] Web env: `VITE_SUPABASE_URL/ANON_KEY` (prod project `opcvjypsoivaxerahbal`), `VITE_CORE_API_URL` prod.
- [ ] Pause or delete the dead Supabase project `dfeyebgdktfteqlacmru` so tooling can't target it by mistake.
- [ ] First real grant done by Brad end-to-end (pay → grant → app shows Premium) before any public announcement.
- [ ] STATE.md updated; CHANGELOG entry; tag release.
