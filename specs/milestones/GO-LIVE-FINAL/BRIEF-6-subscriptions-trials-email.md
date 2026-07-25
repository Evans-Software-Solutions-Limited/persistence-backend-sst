# GO-LIVE-FINAL · Brief 6 — Subscription unlock, 14-day trial, email-confirmation deep link

_Authored 2026-07-19 (evening session). Three related pre-launch items uncovered while
testing IAP + email on the **production** stack. Ops steps are Brad's (App Store Connect /
RevenueCat dashboard / SST secrets); code steps are a Claude Code task. Findings are baked in
so tomorrow doesn't re-investigate._

Context already fixed today (don't redo): SES email is live (MX + SPF added to Route 53,
SES production access granted, Supabase custom SMTP configured on prod). Reviewer account
`admin+appreview@` is confirmed. App display name fixed to "Persistence" (PR pending). ASC
metadata + featuring nomination done.

---

## Workstream 1 — Subscription entitlement NOT unlocking (LAUNCH-CRITICAL)

**Symptom:** A sandbox purchase shows in RevenueCat, but the app never unlocks the tier and
the profile/feature gates don't update.

**Root cause (diagnosed, not the mobile event code):** prod `user_subscriptions` is **empty**
— the purchase never produced a backend row. The app unlocks from that backend table
(`MySubscription` / `useMySubscription` / the feature-gate model), NOT from RevenueCat's
client-side `customerInfo.entitlements`. So the break is the **RevenueCat → backend
webhook/entitlement chain**, upstream of the app.

How the backend works (verified in `microservices/core/src/application/revenuecat/`):

- `POST /revenuecat/webhook` authenticates a **static bearer secret** in the `Authorization`
  header, constant-time compared against SST secret `RevenueCatWebhookSecret`.
- On ANY event it **re-fetches the customer's active entitlements** from the RC REST API
  (using `RevenueCatApiKey` + `RevenueCatProjectId`) and rebuilds the `user_subscriptions`
  row keyed by `external_subscription_id = rc_<app_user_id>`. No active entitlement → it
  cancels the mirror row (reverts to free).
- The mobile app DOES identify the user to RC: `usePurchasesIdentity` calls
  `purchases.logIn(<supabaseUserId>)`, so `app_user_id` should be the Supabase UUID (not an
  anonymous id). This candidate looks OK — verify in the RC customer record.

**Diagnostic checklist (ops — RevenueCat dashboard + prod secrets), in priority order:**

1. **Is a Webhook configured?** RevenueCat → Integrations → Webhooks. It must POST to
   `https://api.persistence.evans-software-solutions.com/revenuecat/webhook` with an
   `Authorization` header value equal to the prod `RevenueCatWebhookSecret`. Check the
   webhook **delivery logs** for the sandbox purchase — did it fire, and what response code?
   (No webhook, or 401/5xx, ⇒ empty table.)
2. **Are Entitlements configured and products attached?** RevenueCat → Entitlements. Because
   the backend rebuilds state from `active_entitlements`, if the purchased product isn't
   attached to an Entitlement, the REST fetch returns nothing ⇒ no row is written even though
   the transaction exists. Confirm each product (premium + trainer tiers) maps to an
   entitlement, and the entitlement→tier mapping in `revenuecat/entitlements.ts` matches the
   RC entitlement identifiers.
3. **Are the prod RC SST secrets set?** `RevenueCatWebhookSecret`, `RevenueCatApiKey`
   (`sk_…`), `RevenueCatProjectId` must be set on the **production** stage. If ApiKey/ProjectId
   are missing/wrong, `fetchActiveEntitlements` fails ⇒ no row. Verify:
   `bunx sst secret list --stage production`.
4. **Confirm `app_user_id`** on the RC customer is the Supabase user UUID (not
   `$RCAnonymousID:…`). If anonymous, the identity `logIn` isn't running before purchase.
5. **Sandbox events:** confirm the handler/flow doesn't drop `environment: "SANDBOX"` events
   (re-fetch approach should be environment-agnostic, but verify a sandbox event actually
   reaches and is processed).

**How to verify the fix:** after correcting the above, redo a sandbox purchase and confirm a
row appears: `select * from user_subscriptions;` on prod — expect one active row keyed
`rc_<uuid>` with the right `tier_name` — then the app unlocks. (This is also the 12.11 IAP
sandbox sign-off.)

---

## Workstream 2 — 14-day free trial on every subscription

**Key fact:** free trials for Apple auto-renewable subs are **App Store Connect Introductory
Offers**, NOT a RevenueCat setting. RevenueCat only reflects them. Apple grants an intro offer
**once per subscription group per Apple Account** (first-time subscribers) — you can't give it
to someone who already used it.

**Current app state (hardcoded, inconsistent):** banners read "7-day free trial" (Premium)
and "14-day free trial" (Trainer); profile drawer says "7-DAY TRIAL". Eligibility is real
(`isEligibleForUserTrial` / `isEligibleForTrainerTrial` from the backend) but the **duration
text is hardcoded**, not read from the actual offer.

**Ops (App Store Connect):** add an **Introductory Offer → Free Trial → 14 days** to EACH
auto-renewable subscription (Premium monthly + annual; each Trainer tier monthly + annual),
territories = all, eligibility = new subscribers.

**Ops (RevenueCat):** nothing to create — just ensure the products are imported and in the
current **Offering**; RC picks up the intro offers automatically.

**Code (Claude Code):** make the trial duration consistent at **14 days** across all tiers,
and ideally **derive the duration from the product's intro offer** (RevenueCat exposes the
intro-price period) instead of hardcoding, so app copy can never drift from what Apple
charges. Files: `IOSPurchaseFlowPresenter.tsx`, `SubscriptionSelectionPresenter.tsx`
(trialBannerText), `ProfileDrawerPresenter.tsx` ("7-DAY TRIAL"),
`components/subscription/PaymentMethodForm.tsx` (`{trialDuration}-day free trial`), and
`deriveTrialEligibility` in `SubscriptionSelectionPresenter.tsx`. Gates: prettier/typecheck/
lint/build/test:unit. Conventional commit.

---

## Workstream 3 — Email-confirmation deep link ("unmatched route")

**Symptom:** clicking the confirmation email on the iPhone opens the app but shows expo-router
**"unmatched route"**; on desktop the link dead-ends. The email still confirms server-side.

**Cause:** Supabase Site URL was set to `persistencemobile://auth/callback` (deep link), but
the app has **no `auth/callback` route** to handle a cold-open, and desktop can't open the
scheme at all.

**Scope of THIS brief (mobile app route):** add an `app/auth/callback.tsx` route to
`packages/mobile` that handles the deep link — parse the URL fragment (`access_token`,
`refresh_token`, `type`), set the Supabase session via the auth adapter, then route the user
into the app (or to sign-in on failure). This removes the "unmatched route" and makes
`persistencemobile://auth/callback` a first-class handler (it also aligns with the OAuth path,
which already targets `Linking.createURL("auth/callback")`). Gates: prettier/typecheck/lint/
build/test:unit. Conventional commit.

**Alignment with the (separate) web-callback brief — keep them separate:** the web
`/auth/callback` page is already tracked in its **own brief** and must NOT be duplicated here.
The two share one contract: the web page (the Supabase Site URL target — desktop landing +
first hop on mobile) deep-links into the app at `persistencemobile://auth/callback`, which the
app route above then handles. The final **Supabase Site URL** is decided in the web brief
(likely the web page); the app route makes the deep link work regardless. Net: both the web
page and the app route exist and use the same `auth/callback` path, fully aligned.

**Note:** not blocking App Store review — the reviewer account is pre-confirmed and reviewers
sign in with email/password. This is for real-user signup/reset confirmation post-launch.

---

## Ops vs code summary

| Item                  | Brad (ops)                                                                                                   | Claude Code (code)                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1 · Sub unlock        | RC webhook config + delivery logs; RC entitlements mapping; verify prod RC secrets; re-test sandbox purchase | (only if a mapping bug is found in `revenuecat/entitlements.ts`)       |
| 2 · 14-day trial      | ASC intro offers on every sub; confirm RC offering                                                           | Align/derive trial duration = 14 across the app                        |
| 3 · Confirm deep link | Site URL decided in the separate web-callback brief                                                          | Add mobile `app/auth/callback.tsx` route (web page tracked separately) |
