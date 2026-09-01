# Partner code, attribution and commission platform

Status: **Discovery brief — follow-up scope, not approved for implementation**

Owner: Persistence

Related surfaces: onboarding, Subscription Selection, RevenueCat webhooks,
partner web portal, internal admin

## 1. Outcome

Build a controlled partner-growth platform that lets Persistence:

- create any number of internal referral codes and campaign links;
- make a code unlimited-use or enforce an exact redemption limit;
- attribute an account and its verified subscription revenue to a partner;
- calculate, approve, reverse, reconcile and pay commissions from an auditable
  ledger;
- give partners a restricted B2B portal for their own codes and performance;
- give Persistence administrators one place to manage partners, campaigns,
  codes, attribution disputes, commission rules and reconciliation;
- optionally connect a referral campaign to an Apple or Google subscription
  offer without treating the internal referral code as a payment entitlement.

The first implementation decision must keep **attribution codes** separate from
**store promotional codes**. They may be linked, but they have different owners,
limits, eligibility rules and sources of truth.

## 2. Vocabulary and ownership

| Concept          | Purpose                                                  | Source of truth           |
| ---------------- | -------------------------------------------------------- | ------------------------- |
| Referral code    | Identifies a Persistence partner or campaign             | Persistence backend       |
| Campaign link    | Carries referral attribution through web/app acquisition | Persistence backend       |
| Attribution      | Records why a particular user belongs to a campaign      | Persistence backend       |
| Redemption       | Records a user's accepted use of an internal code        | Persistence backend       |
| Store offer code | Applies a trial or subscription offer                    | Apple/Google + RevenueCat |
| Commission       | Amount owed to a partner for an eligible money event     | Persistence ledger        |
| Payout           | Settlement of approved commission ledger entries         | Persistence finance/admin |

Persistence can support unlimited internal referral codes. Store offer codes
remain subject to Apple and Google limits and eligibility rules. An internal
referral code must never grant a mobile entitlement directly.

## 3. Personas

### Referred user

- Arrives from a partner link or enters a code manually.
- Can apply a code during onboarding or Subscription Selection.
- Sees whether the referral was accepted and whether a separate store offer is
  available.
- Can skip onboarding without losing captured attribution.

### Partner operator

- Sees only their organisation's campaigns, codes and aggregated users.
- Creates codes only when their agreement permits self-service creation.
- Views clicks, accepted referrals, trials, paid conversions, renewals,
  reversals and commission status.
- Downloads statements without seeing user health or training data.

### Persistence administrator

- Creates, suspends and archives partners.
- Defines campaigns, code limits, attribution windows and commission rules.
- Reviews attribution exceptions and fraud signals.
- Reconciles commission against verified subscription/store data.
- Approves and records payouts with a complete audit trail.

### Finance/support operator

- Searches by user, partner, code, transaction or payout reference.
- Explains why commission was earned, withheld, reversed or paid.
- Cannot silently rewrite historical money events.

## 4. User journeys

### 4.1 Link-led acquisition

1. Partner shares a campaign link containing a non-secret referral token.
2. The web landing records the click and preserves the token through App Store
   or Play Store navigation where platform support allows.
3. After authentication, the app validates and claims the referral server-side.
4. Onboarding displays a small confirmation but does not add a mandatory page.
5. The same applied state appears on Subscription Selection.
6. A later verified purchase or renewal creates provisional commission entries.

### 4.2 Manual code entry

1. The user selects **Have a partner or referral code?** during onboarding or
   on Subscription Selection.
2. The backend normalises and validates the code atomically.
3. The backend enforces active dates, status, audience, per-user rules and any
   global redemption cap.
4. Accepted attribution is persisted immediately, independently of onboarding
   completion and purchase success.
5. The UI shows the partner/campaign display name and any separate offer terms.

### 4.3 Commission lifecycle

1. A RevenueCat webhook records an idempotent subscription money event.
2. The attribution and commission agreement effective at that event are
   resolved server-side.
3. A provisional positive or negative ledger entry is created.
4. Refunds, chargebacks and subscription reversals append compensating entries;
   they never edit historical entries in place.
5. Admin reconciliation promotes eligible entries from provisional to approved.
6. A payout groups approved entries, records an external payment reference and
   marks those entries paid atomically.

## 5. Product surfaces

### Mobile onboarding

- Optional referral input; it must not block Continue or Skip.
- Deep-link attribution should be pre-applied and shown as confirmation rather
  than asking the user to type the same code.
- Code claim happens immediately, not only when onboarding completes.
- Dismissing onboarding preserves the attribution.
- Invalid/expired/exhausted responses use clear neutral copy and never reveal
  internal campaign or partner details.

### Existing Subscription Selection

- Show the currently applied referral and a change/remove action only while the
  attribution policy still permits changes.
- Keep **Apply referral code** separate from any platform-native **Redeem offer
  code** action.
- The displayed product, price, trial, legal copy and purchase result must come
  from StoreKit/Google Play through the existing RevenueCat implementation.
- A referral code alone never changes the displayed price.

### Partner web portal

- Organisation members and roles.
- Campaign and code list with search, status and date filters.
- Code creation within agreement-defined permissions.
- Unlimited-use or capped-use configuration.
- Shareable links and downloadable campaign assets.
- Funnel reporting: clicks, accepted referrals, trials, paid conversions,
  renewals, refunds and churn.
- Commission balances: provisional, approved, reversed and paid.
- Statement/export downloads and payout history.
- No access to user health, nutrition, workout, coaching or private profile data.

### Persistence admin panel

- Partner onboarding, verification, status and contacts.
- Agreement versioning and effective-dated commission rules.
- Campaign/code creation, bulk generation, suspension and archival.
- Redemption limits, validity windows, plan/platform/region scope and notes.
- Attribution search, manual review and controlled reassignment workflow.
- Transaction-to-ledger reconciliation dashboard.
- Refund/chargeback/reversal queue.
- Payout approval, export and external payment reference capture.
- Audit log showing actor, action, reason, before/after values and timestamp.
- Operational metrics and anomaly alerts.

## 6. Code rules

Each internal referral code requires:

- a globally unique, case-insensitive canonical value;
- a separate safe display value;
- partner and campaign ownership;
- `active`, `paused`, `expired` or `archived` status;
- optional `startsAt` and `endsAt`;
- nullable `maxRedemptions` (`null` means unlimited);
- optional per-user and per-household/device protections;
- optional platform, region, plan and new-customer eligibility constraints;
- an attribution policy and commission agreement reference;
- creation source (`admin`, `partner`, `api`, `bulk_import`);
- immutable creation identity and a complete change audit trail.

Limited redemption must use one database transaction: lock or atomically update
the code while inserting the unique user redemption. Counting rows first and
inserting later is unsafe under concurrency.

Codes intended for private or one-time distribution need sufficient entropy and
must be stored so leaked operational exports do not expose unused codes. Public
campaign codes can be human-readable but still need validation rate limits.

## 7. Attribution policy decisions

The product owner must approve these before implementation:

1. First-touch, last-touch or manually adjudicated attribution.
2. Attribution window between click/code claim and account creation/purchase.
3. Whether a user can change a referral before their first paid transaction.
4. Whether an existing subscriber can ever be newly attributed.
5. Whether free users remain attributed indefinitely.
6. Whether commission applies to initial purchase only, a fixed duration, or
   every eligible renewal.
7. Whether commission uses customer gross price, proceeds after store fees,
   proceeds after tax, or actual reconciled settlement.
8. Refund/chargeback hold period and clawback rules.
9. Currency conversion source and effective timestamp.
10. Minimum payout, payout cadence and supported payout rails.

Recommended starting position: lock the first valid referral claimed before the
first paid conversion; accrue provisional commission from verified webhooks;
approve it after the refund window; reconcile against store financial reports;
and pay only approved ledger entries.

## 8. Proposed data model

### Partner and access

- `partners`: organisation identity, status, finance details reference.
- `partner_memberships`: user, partner, role and invitation state.
- `partner_agreements`: effective-dated commercial terms and signed artifact.

### Campaign and codes

- `partner_campaigns`: partner, name, channel, dates, status and attribution
  policy.
- `referral_codes`: canonical code, display code, campaign, limits and status.
- `referral_clicks`: privacy-minimised click/session attribution events.
- `referral_attributions`: one authoritative user attribution plus provenance.
- `referral_redemptions`: unique user/code claim and validation outcome.
- `store_offer_links`: optional mapping from a campaign to platform/store offer
  identifiers; never an entitlement table.

### Commission and reconciliation

- `commission_rules`: versioned rate/basis/term/hold configuration.
- `commission_events`: idempotent normalized purchase, renewal, refund and
  chargeback events linked to source transaction IDs.
- `commission_ledger_entries`: immutable debit/credit entries and lifecycle
  status.
- `commission_reconciliations`: store report/import run and discrepancy state.
- `partner_payouts`: partner, period, currency, status and external reference.
- `partner_payout_items`: immutable mapping from payout to approved entries.
- `partner_audit_log`: append-only administrative and partner actions.

Money is stored in integer minor units with ISO currency. Original transaction
currency and any converted payout currency are both retained. Commission rules
are snapshotted or version-linked so later agreement changes cannot rewrite old
earnings.

## 9. API boundaries

### Mobile/user API

- Validate a code without exposing private campaign configuration.
- Claim a code idempotently for the authenticated user.
- Read the user's safe applied-referral summary.
- Remove/change attribution only when policy explicitly allows it.

### Partner API

- Partner-scoped campaign/code CRUD where authorised.
- Aggregated analytics and commission statements.
- CSV export with asynchronous generation for large periods.
- No arbitrary user lookup and no health/profile data joins.

### Admin API

- Explicit admin authorization separate from ordinary profile metadata.
- Partner/agreement/campaign/code management.
- Attribution adjudication with mandatory reason.
- Reconciliation and payout state transitions.
- Audit-log search and export.

### Webhook/event API

- RevenueCat signature/authentication before processing.
- Idempotency on the provider event and store transaction identifiers.
- Out-of-order event handling.
- Replay-safe compensating entries for refunds and reversals.
- No commission calculation from client analytics events.

## 10. Security, privacy and fraud controls

- RLS/authorization isolates each partner tenant; backend service routes own all
  commission writes.
- Admin roles live in trusted authorization metadata, not user-editable profile
  metadata.
- Rate-limit public validation and return uniform invalid-code errors.
- Detect self-referrals, code stuffing, repeated device/payment patterns,
  abnormal conversion spikes and refund-heavy cohorts.
- Minimise partner-visible user data; default reporting should be aggregated.
- Encrypt or externally vault payout/bank details.
- Require step-up authentication and dual approval for material payout changes.
- Retain immutable audit and ledger history according to finance/legal policy.

## 11. Reconciliation

The admin experience must answer, for any code or partner:

- how many times the code was attempted, accepted and rejected;
- which limit or eligibility rule rejected a claim;
- how many attributed accounts reached trial, initial purchase and renewal;
- which verified transactions produced each commission entry;
- which refunds/chargebacks produced reversals;
- whether provisional commission matches store/provider reporting;
- what was approved, paid, withheld or disputed and why;
- which payout and external payment reference settled an entry.

Reconciliation imports must be idempotent and retain the original source file or
provider report reference. Discrepancies create review items rather than silently
changing the ledger.

## 12. Store constraints

- Apple subscription offer codes are configured in App Store Connect and have
  Apple-defined eligibility, redemption and distribution rules:
  <https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes/>
- Google Play subscription promo codes and custom codes have Google-defined
  eligibility and redemption limits:
  <https://support.google.com/googleplay/android-developer/answer/6321495>
- RevenueCat can expose store offers and process resulting entitlements, but the
  store remains authoritative for price and eligibility:
  <https://www.revenuecat.com/docs/subscription-guidance/subscription-offers>
- Apple's payment rules require mobile digital subscription functionality to use
  the permitted in-app purchase mechanisms:
  <https://developer.apple.com/app-store/review/guidelines/#payments>

Therefore, Persistence's unlimited internal code capability applies to partner
attribution. Any linked customer discount must use a valid store offer or an
approved web-billing route for the relevant platform and territory.

## 13. Delivery slices

### Slice A — commercial and policy design

- Approve attribution and commission decisions in section 7.
- Define partner agreement, privacy, tax and payout requirements.
- Confirm supported platforms, territories and billing rails.

### Slice B — attribution foundation

- Partner, campaign, code, attribution and redemption schema.
- Deep-link/manual claim APIs with atomic limits and audit events.
- Onboarding and Subscription Selection applied-referral UI.

### Slice C — internal admin

- Partner/campaign/code management.
- Search, attribution review and audit history.
- Initial funnel reporting.

### Slice D — commission ledger and reconciliation

- RevenueCat event normalization and idempotent ledger.
- Refund/reversal handling, approval workflow and imports.
- Payout batches and statements.

### Slice E — partner portal

- Tenant-isolated partner authentication and memberships.
- Self-service code controls, analytics, statements and exports.
- Notifications and dispute workflow.

### Slice F — promotional offer integrations

- Apple/Google offer mapping and native redemption UX.
- Eligibility and price verification through the existing subscription rail.
- Platform-specific sandbox/TestFlight/license testing.

## 14. Explicit non-goals for the first slice

- Building a new subscription or entitlement system.
- Letting referral codes directly unlock paid mobile features.
- Paying commission from clicks, code entry or unverified client analytics.
- Giving partners access to individual health, workout or coaching data.
- Silent admin edits to historical ledger entries.
- Supporting every payout rail before the commission ledger reconciles cleanly.

## 15. Definition of ready

Implementation should not begin until:

- all ten attribution/commission decisions are approved;
- Apple, Google, RevenueCat and any web-billing responsibilities are mapped;
- partner and admin roles/permissions are signed off;
- commission examples cover purchase, renewal, upgrade, refund, chargeback,
  cancellation and currency conversion;
- reconciliation source reports and payout rail are selected;
- legal/privacy/accounting review confirms data retention, invoice/tax and
  partner-contract requirements;
- the mobile UX and both web information architectures are reviewed.
