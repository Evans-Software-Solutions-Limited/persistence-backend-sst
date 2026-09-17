# Persistence conversion review and Shipaton plan

15 September 2026 · Updated after Brad supplied the raw transcript and confirmed no offer uptake. Discussion draft; no campaign changes or spending executed.

## Spec alignment

The measurement work extends `specs/30-growth-instrumentation/requirements.md` § Workstream 5, `design.md` § WS5 and `tasks.md` § Row 5. Those sections define the acceptance criteria, diagnostic design and traceable tasks. This review supplies research and proposed execution order; it does not authorize implementation or a campaign launch.

## What we know

Brad reports approximately 1,500 views on the first TikTok and confirms that his user/offer records show **no offers taken**. Accept that reported outcome; the missing evidence is where people leave the journey. The post, audience breakdown, clicks and store analytics have not been supplied or inspected. A user list shows who arrived, not everyone who considered installing or buying. Organic versus paid remains unconfirmed. No offer uptake does not establish zero installs, zero interest, or which screen caused abandonment.

The code and existing notes establish multiple conversion routes, but not their current production configuration. Use the released app and live checkout as the final source of truth.

## Webinar review

For the detailed feature inventory and Persistence applications, see [Meta AI and creator tools](./META-AI-AND-CREATOR-TOOLS.md). This document focuses on conversion diagnosis.

Read the shared [Meta Festival Online notes](https://notes.granola.ai/t/d009f16b-94ef-4fff-abe5-1c54647c39e0-009c2hma) and the complete raw transcript supplied by Brad on 15 September. The transcript has recognition errors and garbled multilingual sections; do not infer missing product/setup details from those passages.

The material focuses on creator selection, partnership ads, briefing and experimentation. It argues for relevance over follower count, briefs that preserve creator freedom, negotiated usage rights, and measurement beyond exposure. It also describes longer-duration lift studies and reports brand case-study results. These are speaker/summary claims, not forecasts for Persistence. Do not treat a reported add-to-cart return as proven purchase revenue.

**Application:** use a real gym user demonstrating one concrete benefit; define the claim and CTA, then allow their own voice. First test with Brad's real footage before paying creators. The webinar's multiweek lift studies do not fit the immediate evidence window or current sample size. The raw transcript adds a specific AI example: GetNet combined Advantage+ Creative image variants, opportunity-score recommendations and creator video, and reported better conversion results. This is a bundled case study: it does not isolate the contribution of AI, creator content or campaign changes. For Persistence, AI-generated variants are a testable creative tool after tracking works, not evidence that AI will fix the present drop-off. Keep real app footage, accurate offers and human review of generated claims. The clearest transferable advice is creator/product fit, a recognizable use case, one controlled change and measurement of the business outcome.

## Important conflict in existing material

`CREATIVE_BRIEF.md` and `EXECUTION_PLAN.md` still describe a renewing App Store offer and a separate voluntary founding route. Current `packages/web/src/marketing/foundingOffer.ts` describes fixed-term web purchases: Premium £30/six months or £60/year, no renewal, with a 30 September closing date. It also points to a `LANDING_PAGE.md` source absent from this milestone's current file inventory.

**Action before the next ad:** inspect actual destinations, checkout terms, current store offers and fulfillment; label each rail correctly and reconcile the approved brief. Do not use the old renewal sentence for a fixed-term web purchase, or assume website copy establishes current App Store terms. These documents are intentionally left unchanged pending factual reconciliation.

## Diagnose two separate funnels

| Step              | Install/use route                                  | Founding purchase route                                       |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Attention         | Post views → profile visits or outbound clicks     | Same, with offer-specific CTA                                 |
| Destination       | Landing visits → store-button clicks → store views | Offer-page visits → checkout starts                           |
| Conversion        | First-time download → first open → registration    | Confirmed payment → access provisioned                        |
| Product value     | First saved workout → another session              | Install/sign-in with purchase email → first saved workout     |
| Commercial result | Trial → paid membership                            | Fixed-term purchase; report separately from recurring revenue |

Keep the ad's primary action singular. For an installation experiment, show the feature and ask people to install. For a founding-sales experiment, show why it is useful and then the exact offer. Evaluate those as different paths, not one mixed conversion number.

Counts need common date windows, platform and source; record unknowns as unknown rather than zero. Views can include repeats. Store downloads, app activations and registrations are different events. Payment and activation can occur on different days/devices, and attributed figures can arrive later. Use aggregate cohorts where individual attribution is unavailable; do not claim every new install came from TikTok.

### Existing measurement and the gaps to verify

- `packages/web/src/marketing/config.ts` already defines TikTok (`tt`), Meta (`meta`) and other source tags. Use the existing channel routes and configured referral codes; do not invent codes. Check which destination the current bio actually reaches.
- `packages/web/src/lib/metaPixel.ts` and the backend analytics pipeline support web measurement. `microservices/core/src/application/analytics/metaEventMap.ts` forwards consented web events, including store clicks and founding checkout/purchase. **AppStoreClick is not an install.**
- `docs/mobile-meta-attribution.md` and `packages/mobile/src/application/analytics/metaAttribution.ts` describe consent-gated Meta activation only, with automatic events disabled. They explicitly exclude workout/health data and app purchase events. Confirm the current release contains/configures it before planning app-install optimization. Do not promise Meta trial/purchase optimization with this implementation.
- RevenueCat webhooks are the existing authority for store subscription outcomes. The session record handler emits `session_completed`; verify useful first-party registration-to-first-workout reporting before adding duplicate instrumentation. Keep workout behavior in first-party analytics, not advertising payloads.
- TikTok paid attribution requires an app-data connection; a UTM-tagged bio does not create it. Current TikTok documentation lists an MMP, SDK or Events API connection. This is a separate implementation decision, not necessary to make an initial organic funnel report. [TikTok measurement documentation](https://ads.tiktok.com/resources/help/article/how-to-measure-app-activity-for-non-app-promotion-campaigns?lang=en).

## Practical experiment, 15–28 September

**15–16 September: establish the baseline.** Record the post/link/offer, organic or paid, time window, views, profile visits, destination visits, store clicks, downloads, registrations, first workouts and purchases. Trace one normal visitor through the real route on each supported platform. Verify consented event receipt, refusal behavior and no double counting. Distinguish test activity from customer results. Any purchase validation needs its own authorized test arrangement; this scope does not authorize a charge.

**17–20 September: test one feature demonstration.** Use an available released feature such as Loadout or workout logging. Match footage to the public build. Select one buyer problem, one demonstrated solution and one CTA. Keep offer, destination and body fixed while testing two opening variants. Existing creative guidance makes Brad the creative owner; this review supplies the test structure, not publishable scripts. Compare profile/link actions and downstream activation, not views alone. Organic distribution is uncontrolled, so treat differences as directional.

**21–24 September: repair the observed loss.** Low clicks: test clarity/relevance of the opening and CTA. Clicks but few store views: examine redirect and page friction. Store views but few downloads: examine message match, screenshots and compatibility. Downloads but few first workouts: inspect onboarding and the first useful session. Checkout starts but no payment: inspect price/terms clarity and checkout failures. Payments but no activation: inspect email delivery, same-email signup and entitlement refresh. Choose the step with evidence, not all steps simultaneously.

**25–28 September: repeat the better-supported approach and record results.** A small opted-in coach/creator pilot can follow if there is a usable funnel; agree rights and disclosure before any paid use. No outreach is sent by this review. Keep the fair/print cohort separate from TikTok/Meta so their combined growth is not misattributed.

Meta's [official Advantage+ app campaign material](https://www.facebookblueprint.com/student/activity/580818-grow-your-audience-with-advantage-app-campaigns?sid=7df19ff5-d82a-42fc-a4be-e3404a47170e&sid_i=19) covers app campaign optimization and testing. Recommended use here: select the objective matching the actual route and verified event. Consider install optimization only after app activation is confirmed; web founding sales use verified checkout/purchase events. Optimizing traffic can establish a baseline but does not optimize paying users. At this volume, avoid splitting spending across many audiences or promising algorithmic learning from a few purchases.

### Spending and decision discipline

The existing plan records a £210 account cap and £10/day starting point. Those are historical instructions, not verified remaining budget or fresh spending authorization. Inspect actual spend and remaining headroom before any campaign change; the current account cap must remain binding. Do not raise it for this review.

Retain the earlier stop rules as provisional ceilings pending remaining-budget reconciliation: a cell at £60 with no tracked store click, or a campaign at £200 with fewer than two attributable conversions, stops for review. These are loss controls, not statistical proof. Do not scale based on views, clicks alone, or two unverified payments. Calculate cost per activated athlete and cost per actual payer separately. Set affordable acquisition cost from net receipts, servicing costs and retention evidence before scaling; gross fixed-term cash received is not recurring revenue or profit.

## Shipaton evidence and outstanding inputs

Target evidence assembly on 28 September. The [official guide](https://www.shipaton.com/blog/how-to-submit-your-app-for-shipaton) gives the deadline as 30 September 2026, 23:45 PDT (1 October, 07:45 BST).

For each experiment record date, asset/post URL, audience/channel, objective, exact offer/destination, spend, observed funnel counts, attribution method, change made and conclusion. Include organic and paid separately; show real zeroes where measured and unknowns where not measured. Report paid founding access separately from trials, subscriptions and free/complimentary access. Include qualitative user feedback with permission. A well-supported learning is useful evidence even if early sales are low; neither new feature is presented as already shipped.

Needed from Brad: TikTok URL, actual bio/offer destination, organic/paid status and the available counts. Raw-transcript review is complete. Live ad/store/account verification remains open. No claim of increased conversion is made by this document.
