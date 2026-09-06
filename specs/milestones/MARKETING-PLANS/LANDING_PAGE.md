# Persistence founding offer — sales page strategy and copy

Status: **v2, 5 Sep 2026 — written for the paid web model Brad decided on 5 Sep** (Stripe Checkout on the website; offer live until 30 September 2026; admin grants remain the second route; matching in-app introductory offers are a separate path never referenced here). Supersedes the v1 request-form page. Once Brad approves, this file is the source of truth for MARKETING-PLANS WP9; the coding agent implements it verbatim and writes no copy of its own.

Every product claim is taken from `packages/subscription-catalog/src/index.ts` or the marketing Home. No testimonials, results, user counts or invented features. Prices are the four Brad set. Items marked **[confirm]** are listed in § 14.

---

## 1. Why the current page fails

It is written from the inside out. The hero is about the founder's birthday, the body explains what the page is not ("not sold here", "no checkout or payment code") and how access is recorded internally, tier cards describe access "for the period agreed with Brad", and availability is a raw pair of counters. There is no way to buy, no product on screen, and no reason to act. A cold visitor from an ad cannot do anything except compose an email.

The paid model fixes the mechanism; this document fixes the page.

---

## 2. Three positioning concepts

**A — "Be in from the start."** Belonging/first-in: a small first group, full access for the launch period, a say in what comes next. Strong warm; weaker cold.

**B — "Train with a plan. Fuel to match. See it add up."** Outcome-first; the founding offer is the reason to act now. Strongest for cold, problem-aware Meta traffic.

**C — "Training, nutrition and coaching. One app."** Category framing, mirrors the Home page. Clear but generic.

## 3. Hero variants

| Concept | Headline                                         | Subheading                                                                                                                                                       | Primary CTA            |
| ------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| A       | Be in from the start.                            | Persistence is launching. Founding places give you six months or a year of full access at the founding price — and a say in what comes next. Until 30 September. | See founding prices    |
| B       | Train with a plan. Fuel to match. See it add up. | Persistence brings training, nutrition and progress into one loop. The founding offer — six months of Premium for £30 — is open until 30 September.              | Get the founding offer |
| B′      | Structure you'll actually keep.                  | One app for the plan, the food and the progress. Founding prices until 30 September.                                                                             | See founding prices    |
| C       | Training, nutrition and coaching. One app.       | Founding prices for people and coaches who want the whole picture in one place. Until 30 September.                                                              | Get the founding offer |

## 4. Recommendation

**Concept B.** Cold traffic converts on a recognisable outcome, then needs a reason to act today; a concrete price and a real date are that reason. The headline price in the hero is the cheapest entry (six months of Premium for £30) because it is the easiest yes; the year and Premium+ are one scroll away on the cards. Primary CTA: **Get the founding offer** (scrolls to the plans). Plan buttons carry the price so the click is informed: **Six months — £30**.

---

## 5. Final page copy

Sentence case. No emojis. Labels in brackets are for the developer and are not rendered.

### 5.1 Home page banner (all marketing pages except `/founding`; hidden after 30 Sep)

`Founding offer: six months of Premium for £30, until 30 September →` (links to `/founding`; dismiss control with `aria-label="Hide founding offer banner"`; dismissal remembered in sessionStorage)

### 5.2 Hero

[Kicker] `Founding offer · until 30 September`

[H1] **Train with a plan. Fuel to match. See it add up.**

[Sub] Persistence brings training, nutrition and progress into one loop. The founding offer — six months of Premium for £30, or a year for £60 — is open until 30 September. Fixed term, nothing renews.

[Primary CTA] **Get the founding offer** → scrolls to § 5.5

[Secondary link] See what's included ↓

[Scarcity line] Founding places are limited. The offer closes on 30 September 2026, or earlier if they're gone.

[Visual] Phone with the Home screen (today's session, rings) and the You progress screen behind. **[asset]**

### 5.3 What you get

[Kicker] `The loop`

[H2] **Everything you do in the gym and the kitchen, in one place.**

- **Train** — Log every set in seconds. Follow a programme or build your own. Streaks and PRs update themselves.
- **Fuel** — Track food by barcode, photo or plain text. See today's target and how you're doing against it.
- **Progress** — Body trend, volume, personal records and streaks in one view, so the work shows.

[Line] Premium+ adds **Loadout**, which adapts your programme to the equipment you actually have, and **Mealprint**, which plans meals around your targets and tastes.

### 5.4 Why now

[Kicker] `Why now`

[H2] **The founding price is for the people who join first.**

[Body, three short paragraphs]

Founding prices are fixed-term: you pay once for six months or a year, and nothing renews. When the term ends you can carry on with a standard plan in the app, or not — your call.

The offer closes on 30 September. After that these prices go, and places are limited before then.

The people who join now shape what gets built next. Feedback from founding members sets the order of the roadmap, and every founding purchase is looked after personally by Brad, the founder.

### 5.5 Founding prices

[Kicker] `Founding prices · until 30 September`

[H2] **Pick your access. Pay once.**

Two cards, each with two buttons. Feature lines are verbatim catalogue entries.

**Premium** — For consistent training

- Unlimited workouts and history
- Photo and free-text AI nutrition logging
- Smart swap suggestions
- Everything in Free: full logging, barcode scanner, streaks and PRs

Buttons: **Six months — £30** · **One year — £60**

**Premium+** — Everything in Premium, plus the adaptive suite [highlighted card]

- Loadout — equipment-aware training
- Mealprint — AI meal planning around your targets
- Programme import from PDF or spreadsheet

Buttons: **Six months — £50** · **One year — £100**

[Caption] Prices in GBP, paid once. No renewal, no card stored. You'll sign up in the app with the email you pay with.

[Coach line under the cards] **Coaches:** founding places for Start Up Coach+ are arranged directly — [send a coach enquiry] (links to the existing coach form on Home).

### 5.6 Before checkout (small step, inline, appears when a plan button is pressed)

[H3] **{Plan name} · {term} · £{price}**

[Field] Email — helper: Use the address you'll sign in with in the app. Your access is linked to it.

[Disclosure, collapsed] Have a referral code? — helper: Optional. It tells us who sent you; it doesn't change the price.

[Consent checkbox — required] Tick to confirm you're happy for us to email you about your purchase, your access and product updates. You can unsubscribe at any time — see our Privacy policy.

[Terms line] By continuing you agree to the terms and conditions and ask us to start your access as soon as you sign up in the app. You keep a 14-day right to cancel for a full refund, unless you've started using the app in that time. **[confirm with solicitor]**

[Button] **Continue to payment** → Stripe Checkout
[Submitting] Opening secure payment…

[Errors] Enter a valid email address. · Please tick the box so we can email you your access. · Codes are 4–24 letters or digits. · That plan has just sold out — pick another or check back after 30 September. · Something went wrong opening payment. Please try again, or email admin@evans-software-solutions.com.

### 5.7 Stripe Checkout custom text (shown on Stripe's page)

Submit line: Persistence founding offer — {plan}, {term}. Paid once, no renewal. Access starts when you sign up in the app with this email.

Terms acceptance: I agree to the Persistence terms and ask for my access to start when I sign up. I understand I can cancel within 14 days for a full refund unless I've started using the app. **[confirm with solicitor]**

### 5.8 Thanks page (`/founding/thanks`)

[Paid] **Payment received — you're in.**
Thanks. We've emailed **{masked email}** an invite with your access details: {plan}, {term}. Next: install Persistence, sign up with that exact email address, confirm it, and your access is on the first time you open the app. Nothing else to do.
[Store buttons: App Store / Google Play — the existing CTAs]
[Small print] Didn't get the email within a few minutes? Check spam, then email admin@evans-software-solutions.com with the email you paid with.

[Still processing] **Finishing up…** Your payment is being confirmed. This usually takes a few seconds.

[Cancelled / expired] **No payment was taken.** Your session ended before payment completed. [Back to founding prices]

### 5.9 How it works

[Kicker] `Three steps`

1. **Pick your plan and pay once.** Six months or a year, Premium or Premium+. Secure payment by card through Stripe.
2. **Check your email.** Your invite arrives within a few minutes with your plan and term.
3. **Sign up in the app with the same email.** Confirm your address and your access is live the first time you open the app.

[Small print] Access is tied to the email you pay with. If you'd use a different one in the app, reply to your invite and we'll move it.

### 5.10 FAQ (six, collapsed, first open)

**What exactly am I buying?**
Fixed-term access to Persistence — six months or a year of Premium or Premium+, paid once. Nothing renews and no card is stored. When the term ends you can carry on with a standard plan in the app if you want to.

**Is this the same as subscribing in the app?**
It's the same access. Buying here during the founding period is how you get the founding price; the app is where you'll use it. Sign up in the app with the email you pay with.

**Can I get a refund?**
You have 14 days to cancel for a full refund, unless you've started using the app in that time. Email admin@evans-software-solutions.com from the address you paid with. **[confirm with solicitor]**

**I already subscribe in the App Store or Google Play.**
Then the founding offer isn't for you — an active store subscription can't be combined with it. If yours is ending, buy once it has expired.

**I have a referral code — what does it do?**
It tells us who sent you, so we can thank them. It doesn't change the price or your access.

**Is there a coach option?**
Yes — Start Up Coach+ founding places are arranged directly. Send a coach enquiry and Brad will come back to you.

### 5.11 Closing CTA

[H2] **Founding prices end 30 September.**
[Sub] Six months of Premium for £30. Pay once, nothing renews.
[CTA] **Get the founding offer**

### 5.12 Closed state (from 1 October, replaces § 5.5–5.11)

[H2] **The founding offer has closed.**
[Body] Thanks to everyone who joined during launch. Persistence is available on the App Store and Google Play, and founding members' feedback is already shaping what comes next.
[Store buttons]

### 5.13 Footer note

Persistence is built by Evans Software Solutions Limited. Payments are processed by Stripe. Read the terms and privacy policy.

---

## 6. Wireframe

```
MarketingNav · [banner hidden on this page]
HERO   kicker · H1 · sub · [Get the founding offer] · link · scarcity line · phone mock
WHAT YOU GET   Train / Fuel / Progress · Loadout + Mealprint line
WHY NOW   H2 + 3 paragraphs · image
FOUNDING PRICES   2 cards (Premium · Premium+ highlighted) × 2 price buttons · caption · coach line
BEFORE CHECKOUT   inline step (email · code disclosure · consent · terms line · Continue to payment)
HOW IT WORKS   3 steps
FAQ   6 items
CLOSING CTA
MarketingFooter
```

`/founding/thanks` is its own route with the three states in § 5.8. From 1 Oct the page renders hero + what you get + closed state only. The form step appears in place of the cards' caption when a price button is pressed (no modal), with focus moved to the email field.

---

## 7. Interaction states (summary — details in § 5.6–5.8)

Plan button → inline step (plan locked, changeable via "Change plan") → Continue to payment (validates, POST `/founding/checkout`, Turnstile) → redirect to Stripe → return to `/founding/thanks?session_id=…` → poll status → paid / processing / cancelled. Pixel: `InitiateCheckout` on Continue (same `event_id` as the server's `checkout_started`); `Purchase` on the thanks page when status is paid (same `event_id` the server used). Both consent-gated.

---

## 8. Segmentation

One page. Cold Meta traffic and the Home banner land on the hero; `?plan=premium_plus` pre-selects the highlighted card and scrolls to it (for a Premium+-angled ad set). Coaches are routed to the existing coach enquiry form and handled as admin grants. No separate coach page.

---

## 9. Meta ad-to-page message map

Creative cells are placeholders for Brad's ads.

| Segment                       | Creative angle (Brad)       | Ad promise the page fulfils                                                      | Page headline                                    | Proof on page                     | CTA                    | Conversion                                                       |
| ----------------------------- | --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| Individuals wanting structure | [founder story / situation] | One app for the plan, the food and the progress; six months for £30 until 30 Sep | Train with a plan. Fuel to match. See it add up. | Train/Fuel/Progress; Premium card | Get the founding offer | `Purchase` (pixel + CAPI, deduped); `InitiateCheckout` as intent |
| Committed users               | [Loadout / Mealprint demo]  | The adaptive suite at the founding price                                         | Same hero; `?plan=premium_plus`                  | Premium+ card                     | Six months — £50       | `Purchase`                                                       |
| Coaches                       | [coach workflow]            | Coach founding places arranged directly                                          | Coach line + enquiry                             | Coach form                        | Send a coach enquiry   | `Lead` (existing coach form)                                     |

Tracking rules: campaign slug is the attribution key (`meta`, `ig`, …); UTMs mirror only. `?ref=` captured by `MarketingLayout` pre-fills the code disclosure. `checkout_started` and `purchase` carry `campaign`, `ref`, `tier`, `months`. Week 1 Meta objective: **Sales**, optimising `Purchase`; if under ~10 purchases in the first week, switch the ad set to `InitiateCheckout` or landing views rather than starving the algorithm. Create the `Purchase` custom conversion filtered to `/founding/thanks` after the first event arrives. Web purchases bypass RevenueCat — Shipaton evidence must show `/admin` grants and Stripe alongside RC.

What the Meta workstream returns: chosen concept per segment and opening line; ad-set audience definitions; `utm_content` naming per concept so `/admin/marketing` metrics can be entered per concept (Sprint 2).

---

## 10. A/B tests

1. **Hero price vs no price.** Headline price in the hero sub ("six months of Premium for £30") vs outcome-only sub with prices on the cards. Primary: purchases per landing view; guardrail: bounce.
2. **Default term.** Cards lead with six months vs lead with the year. Primary: revenue per landing view; secondary: Premium+ share.
3. **Deadline prominence.** Kicker + scarcity line vs kicker only. Primary: purchases per landing view.

---

## 11. SEO

Title: `Founding offer — Persistence gym & coaching app`
Description: `Six months of Persistence Premium for £30, or a year for £60. Training, nutrition and progress in one app. Founding prices until 30 September, paid once, nothing renews.`
Canonical `/founding`; index, follow.

## 12. Social

`og:title`: `Persistence founding offer — six months for £30`
`og:description`: `Training, nutrition and progress in one app. Founding prices until 30 September. Pay once, nothing renews.`
`og:image`: phone mock, 1200×630 **[asset]**

---

## 13. Implementation handoff (WP9; WP10 builds the routes it calls)

- Rebuild `Founding.tsx` to § 5–6 inside `MarketingLayout`; one H1; copy as data objects, not inline JSX strings, so v3 copy is a data change.
- `FoundingPlanCards` (2 × 2 buttons; `?plan=` pre-select + scroll), `FoundingCheckoutStep` (email, code disclosure pre-filled from `storedReferralCode()`, `ConsentRow`, Turnstile, honeypot, terms line, Continue → `POST /founding/checkout` → `window.location = url`), `FoundingThanks` route with status polling and `Purchase` pixel, `FoundingBanner` in `MarketingLayout` (hidden on `/founding` and after `FOUNDING_OFFER_CLOSES`), `FoundingClosed`.
- `FOUNDING_OFFER_CLOSES = "2026-09-30T23:59:59+01:00"` shared between web and core.
- Remove the birthday line, "allocated personally", "granted, not sold here", "for the period agreed with Brad", "no checkout or payment code", the raw counters. Availability: no numbers; the scarcity line only.
- Tests: hero + cards render with the four prices; plan button opens the step with the right plan; validation messages; Continue posts the right body and redirects; sold-out error; closed state both sides of the date; banner visibility rules; thanks page three states and `Purchase` dedupe id; banned phrases absent; **the old assertions about bank details and "Pay for" buttons are replaced** — the page now has price literals by design; assert they match `FOUNDING_WEB_PRICES` exactly.
- Privacy (`Privacy.tsx`, web copy only): add "founding offer purchases" — email, plan, term, payment reference, referral code, campaign — processed by Stripe; retention per the existing founding-purchase paragraph.
- Terms (`Terms.tsx`): fixed-term non-renewing purchase; 14-day right and immediate-supply consent; seller ESS Ltd; refunds by email. **Solicitor-approved text required before deploy.**
- Accessibility as before: labelled inputs, `aria-live` on step and thanks states, focus management, contrast per the 2026-08-31 CTA rules.

---

## 14. Confirmations needed from Brad

1. **Solicitor wording** for the terms line, Stripe terms acceptance, and the refund FAQ (§ 5.6, 5.7, 5.10) — blocks deploy.
2. **Stripe account**: use the existing one behind `STRIPE_SECRET_KEY` (assumed) or a new one.
3. **Coach founding places**: arranged directly via the coach form (as written), or should Start Up Coach+ £99 be sold on the page too?
4. **Screenshots**: Home, You, Fuel, Loadout, Mealprint — dark theme, no personal data; plus a 1200×630 social crop.
5. **Roadmap promise** in § 5.4 — confirm you'll honour it.
6. **"Looked after personally by Brad"** — keep, or make it product-only.
