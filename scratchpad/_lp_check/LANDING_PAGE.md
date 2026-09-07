# Persistence launch offer — landing-page strategy and copy

Status: **approved copy direction, decisions applied 5 Sep 2026** (six-month introductory offer, open until 30 September 2026, no "free" wording, requester confirmation email, availability numbers hidden, founder named once). Once approved this file is the source of truth for MARKETING-PLANS WP9; the coding agent implements it verbatim and writes no copy of its own. Governing constraints: `specs/milestones/FOUNDING-OFFER/BRIEF.md § 2` (2026-09-04 amendment) and `ADDENDUM-2026-09-04-launch-page.md` (A1–A7).

Every product claim below is taken from `packages/subscription-catalog/src/index.ts` or the marketing Home. Nothing is invented: no prices, no testimonials, no results, no deadlines, no user counts. Where a statement needs Brad's confirmation it is marked **[confirm]** and listed in § 14.

---

## 1. Why the current page fails

The page is written from the inside out. Its hero is about the founder's birthday, not the visitor's training. Its body explains what the page _is not_ ("not sold here", "no checkout or payment code") and how access is recorded internally ("Brad records the tier and access period, then the grant is applied to the email you use in the app"). Tier cards describe access "for the period agreed with Brad", which reads as an arrangement, not an offer. Availability is shown as a raw pair of counters. There is no form, no CTA, no picture of the product and no statement of what the visitor will be able to do. A cold visitor from an ad has no reason to act and no way to act other than composing an email.

The commercial model behind it is sound — access granted for a set period, contributions separate, limited places. The page just describes the mechanism instead of the opportunity.

---

## 2. Three positioning concepts

### Concept A — "The launch cohort"

Belonging and first-in. The visitor joins a small first group that gets full access from day one and whose feedback shapes what gets built next. Strong for warm traffic and for coaches; weaker for cold traffic that has never heard of the product.

- Hero: **Be in from the start.**
- Sub: Persistence is launching. A limited number of introductory places give you six months of full access from day one — and a say in what comes next.
- CTA: Request a launch place · Alt: Join the launch

### Concept B — "Structure that sticks"

Outcome-first. Leads with what the visitor gets — a plan they follow, food that matches it, progress they can see — and uses the launch period as the reason to act now. Strongest for cold, problem-aware traffic.

- Hero: **Train with a plan. Fuel to match. See it add up.**
- Sub: Persistence brings training, nutrition and progress into one loop. Our introductory launch offer — six months of full access — is open until 30 September.
- CTA: Request launch access · Alt: Request your place

### Concept C — "Everything in one loop"

Product-system framing, mirroring the marketing Home ("Three disciplines. One loop."). Clear and premium, but leads with the category rather than the visitor's problem, so it earns fewer clicks cold.

- Hero: **Training, nutrition and coaching. One app.**
- Sub: A six-month introductory offer for people and coaches who want the whole picture in one place.
- CTA: Request launch access · Alt: Apply for launch access

## 3. Hero variants per concept

| Concept | Headline                                         | Subheading                                                                                                                                                                                  | Primary CTA             | Secondary           |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------- |
| A       | Be in from the start.                            | Persistence is launching. A limited number of introductory places give you six months of full access from day one — and a say in what comes next. Open until 30 September.                  | Request a launch place  | See what's included |
| A′      | The first group gets the full app.               | An introductory offer for launch: six months of full access, confirmed personally, no card and no checkout on this site. Open until 30 September.                                           | Join the launch         | How it works        |
| B       | Train with a plan. Fuel to match. See it add up. | Persistence brings training, nutrition and progress into one loop. Our introductory launch offer — six months of full access — is open until 30 September, with a limited number of places. | Request launch access   | See what's included |
| B′      | Structure you'll actually keep.                  | One app for the plan, the food and the progress — with a six-month introductory offer open until 30 September.                                                                              | Request your place      | How it works        |
| C       | Training, nutrition and coaching. One app.       | A six-month introductory offer for people and coaches who want the whole picture in one place. Open until 30 September.                                                                     | Request launch access   | See what's included |
| C′      | One loop. Not three apps.                        | Persistence closes the gap between what you lift, what you eat and what you see. Introductory places open until 30 September.                                                               | Apply for launch access | See what's included |

## 4. Recommendation

**Concept B, with Concept A's "shape what comes next" line carried into the "Why now" section.**

Cold Meta traffic is problem-aware at best. It converts on a recognisable outcome, then needs a reason to act today; "launch places, limited, full access" is that reason. Concept A's belonging story is the right second beat, not the first — it works on people who already want the product. Concept C describes a category, which is what every competitor's page does.

B also aligns with the marketing brief's message map (outcome → mechanism → CTA) and with a Leads objective: the form asks for one clear thing, and the headline has already told the visitor what they are requesting access _to_.

CTA wording: **"Request launch access"** as primary everywhere. It is truthful (there is a review step), active, and specific. "Claim your spot" is excluded; "Apply" is kept as an A/B variant because it may raise intent quality at the cost of volume.

---

## 5. Final landing-page copy (Concept B)

Sentence case throughout. No emojis. Section labels are for the developer; they are not rendered.

### 5.1 Hero

Kicker: `Introductory launch offer · until 30 September`

H1: **Train with a plan. Fuel to match. See it add up.**

Sub: Persistence brings training, nutrition and progress into one loop. Our introductory launch offer gives you six months of full access. Places are limited and requests close on 30 September.

Primary CTA: **Request launch access** (scrolls to the form; on mobile the form is the next section)

Secondary CTA (text link): See what's included ↓

Availability line: `Places are limited and confirmed personally. Requests close 30 September 2026.` — plain sentence, **no numbers** (decided 5 Sep). The numeric variant exists only as A/B test 3 and stays behind a constant.

Hero visual: the app on a phone — the Home screen (today's session, rings) with the You progress screen behind it. **[asset needed]**

### 5.2 What you get

Kicker: `The loop`

H2: **Everything you do in the gym and the kitchen, in one place.**

Three columns, each a real feature set from the catalogue:

- **Train** — Log every set in seconds. Follow a programme or build your own. Streaks and PRs update themselves.
- **Fuel** — Track food by barcode, photo or plain text. See today's target and how you're doing against it.
- **Progress** — Body trend, volume, personal records and streaks in one view, so the work shows.

Below the columns, one line: Premium+ adds **Loadout**, which adapts your programme to the equipment you actually have, and **Mealprint**, which plans meals around your targets and tastes.

### 5.3 Why now

Kicker: `Why now`

H2: **Six months of the full app, not a trial.**

Body (three short paragraphs, not bullets):

This is an introductory offer for launch: six months of full access to the tier you request. There's no checkout on this site and no card to enter — you request a place here and claim it by signing up in the app once it's confirmed.

Requests are open until 30 September and places are confirmed personally, one at a time. That keeps the first group small enough to look after properly — every request is read by Brad, the founder.

The people who join now shape what gets built next. Feedback from launch members sets the order of the roadmap.

### 5.4 Choose your access

Kicker: `Access options`

H2: **Pick the level that fits how you train.**

Three cards. Feature lines are verbatim catalogue entries; no prices.

**Premium** — For consistent training

- Unlimited workouts and history
- Photo and free-text AI nutrition logging
- Smart swap suggestions
- Everything in Free: full logging, barcode scanner, streaks and PRs

**Premium+** — Everything in Premium, plus the adaptive suite (highlighted card)

- Loadout — equipment-aware training
- Mealprint — AI meal planning around your targets
- Programme import from PDF or spreadsheet

**Start Up Coach+** — Coaching plus the adaptive suite

- Coach tools and client management
- Programme builder
- Up to 5 clients
- Adaptive suite included

Each card's button: **Request this** → scrolls to the form with that option pre-selected.

Caption under the cards: Not sure? Pick the one closest and say what you're aiming for in the form — we'll help you choose.

### 5.5 For coaches

Kicker: `For personal trainers`

H2: **Your clients, your programmes, one place.**

Body: Build programmes once and assign them to clients. See who trained, what they lifted and how they're eating without chasing screenshots. Coach places are part of the same six-month introductory offer, limited and confirmed separately from consumer places, until 30 September.

CTA: **Request coach access** → form with Start Up Coach+ pre-selected.

### 5.6 How it works

Kicker: `Three steps`

1. **Request your place.** Tell us which access you're interested in and, if you like, what you're aiming for. Takes about a minute. Requests close 30 September.
2. **We confirm by email.** Every request is reviewed personally, usually within a few days. If there's a place, you'll get a confirmation with your access details and the six-month period it covers.
3. **Claim it in the app.** Sign up with the same email address you requested with. Your six months start the first time you open the app after confirming your email.

Small print under step 3: Requests aren't automatic — places are limited and we confirm each one. You'll hear back either way.

### 5.7 The form

See § 7 for fields, states and copy. Rendered inline here on all breakpoints (see § 6).

### 5.8 FAQ

Keep to six. Collapsed by default; first one open.

**What is the introductory offer?**
Six months of full access to the tier you request, for people who join during launch. There's no checkout on this site and no card to enter: you request a place, we confirm it by email, and you claim it by signing up in the app with the same address. When the six months end you can carry on with a standard plan in the app if you want to — nothing renews automatically.

**How long is it open?**
Requests close on 30 September 2026. Places are limited, so it may close earlier if they're all confirmed.

**Is every request accepted?**
No. Places are limited and each one is confirmed personally. You'll get a reply either way.

**Which email should I use in the app?**
The one you request with. Access is linked to that address, so if you'd use a different one in the app, tell us in the form.

**I have a referral code — what does it do?**
It tells us who sent you, so we can thank them. It doesn't change your access or move you up the list.

**Can I support the launch beyond taking a place?**
Some people ask to contribute to the wider launch. That's separate from access: a contribution doesn't buy, guarantee or extend a place, and a place never requires one. If you'd like to know more, mention it in the form.

### 5.9 Closing CTA

H2: **The introductory offer closes 30 September.**
Sub: Six months of full access. Request your place in about a minute and we'll confirm by email.
CTA: **Request launch access**

### 5.10 Footer note

Persistence is built by Evans Software Solutions Limited. Read the terms and privacy policy. (Links to `/terms` and `/privacy`.)

---

## 6. Section-level wireframe

```
┌──────────────────────────────────────────────────────────────┐
│ MarketingNav (existing)                                      │
├──────────────────────────────────────────────────────────────┤
│ HERO   kicker (until 30 Sep) · H1 · sub · [Request launch    │
│        access] · link · 'places limited, close 30 Sep' line   │
│        right: phone mock (Home + You)                        │
├──────────────────────────────────────────────────────────────┤
│ WHAT YOU GET   3 columns: Train / Fuel / Progress            │
│                one line on Loadout + Mealprint               │
├──────────────────────────────────────────────────────────────┤
│ WHY NOW   H2 + three short paragraphs, left; image right     │
├──────────────────────────────────────────────────────────────┤
│ ACCESS OPTIONS   3 cards, Premium+ highlighted               │
│                  each: name · tagline · 3–4 features · button│
├──────────────────────────────────────────────────────────────┤
│ FOR COACHES   split: copy left, coach screen right · button  │
├──────────────────────────────────────────────────────────────┤
│ HOW IT WORKS   3 numbered steps in a row (stack on mobile)   │
├──────────────────────────────────────────────────────────────┤
│ FORM   card, max-width ~560px, centred                       │
│        first name · email · interest (segmented) · goal      │
│        referral code (collapsed "Have a code?") · consent    │
│        [Request launch access]                               │
├──────────────────────────────────────────────────────────────┤
│ FAQ   6 items, accordion                                     │
├──────────────────────────────────────────────────────────────┤
│ CLOSING CTA   H2 · sub · button (scrolls to form)            │
├──────────────────────────────────────────────────────────────┤
│ Secondary: "Already sure? Get the app" — StoreOfferCta,      │
│ iOS only, only when VITE_STORE_OFFER_IOS_URL is set (A1)     │
├──────────────────────────────────────────────────────────────┤
│ MarketingFooter (existing)                                   │
└──────────────────────────────────────────────────────────────┘
```

Hierarchy rules: one H1; the form is reachable within one scroll on mobile (hero CTA anchors to it); Premium+ is the visually highlighted card because it is the tier the Home page already sells; the store-offer CTA is visually secondary and never above the form. Show the form **inline**, not behind a modal: the page's whole job is the request, and a modal adds a click and hides the consent text.

Dark theme first (site default), with the existing marketing tokens; no new colours.

---

## 7. Form — fields, copy and states

Component: `FoundingRequestForm`, built on `LeadForms.tsx` patterns (`useLeadSubmit`, Turnstile widget, honeypot, `ConsentRow`, `trackLead`). Posts to `POST /leads/founding` with `campaign` (from `useCampaign()`) and `ref` (from `storedReferralCode()`), plus the fields below.

### Fields

| Field        | Label                    | Control                                                                | Required                                                                       | Supporting copy / placeholder                                                                                                                                            | Validation message                                          |
| ------------ | ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| firstName    | First name               | text, autocomplete given-name                                          | yes                                                                            | placeholder: Your first name                                                                                                                                             | Enter your first name.                                      |
| email        | Email                    | email, autocomplete email                                              | yes                                                                            | helper: Use the address you'll sign in with in the app.                                                                                                                  | Enter a valid email address.                                |
| interest     | I'm interested in        | segmented control: Premium / Premium+ / Start Up Coach+                | yes (default from card click or `?interest=`; otherwise Premium+ pre-selected) | —                                                                                                                                                                        | Choose an option.                                           |
| goal         | What are you aiming for? | textarea, 1000 max                                                     | no                                                                             | placeholder: A few words is plenty — e.g. stick to a programme, get my nutrition matching my training, coach my first clients.                                           | Keep this under 1,000 characters.                           |
| referralCode | Referral code            | text, uppercase, collapsed behind a "Have a referral code?" disclosure | no                                                                             | helper: Optional. Tells us who sent you.                                                                                                                                 | Codes are 4–24 letters or digits.                           |
| consent      | (checkbox)               | `ConsentRow`                                                           | yes                                                                            | Required. Tick to confirm you're happy for us to email you about your request, the launch and product updates. You can unsubscribe at any time — see our Privacy policy. | Please tick the box so we can email you about your request. |
| hp           | honeypot                 | hidden                                                                 | —                                                                              | —                                                                                                                                                                        | —                                                           |

Notes: `interest` values map to `premium`, `premium_plus`, `start_up_coach_plus`. The referral code is normalised client-side (`normalizeReferralCode`) and shown in the collapsed disclosure pre-filled when `storedReferralCode()` is present, with the disclosure open. Turnstile renders inside the card above the button, as on the coach form.

### Submit button

Idle: **Request launch access**
Submitting: **Sending your request…** (disabled, spinner)

### States

**Idle / validating.** Inline errors appear on blur and on submit attempt, one per field, `role="alert"`, matching `lead-error` styling. The button stays enabled until submit so the browser's required-field hints and our messages don't fight.

**Success** (replaces the form card, `role="status"`):

> **Request received.**
> Thanks, {firstName}. We review every request personally and you'll hear from us by email — usually within a few days. If there's a place for you, the email will say exactly what access it covers and how to claim it in the app.
> Until then, nothing else is needed from you.

Below it, a quiet line: Want to look around in the meantime? **Get the free app** (existing App Store / Play CTAs, unchanged — the free tier is real and available).

**Error** (server 5xx, network): keep the form values; show under the button:

> Something went wrong and your request wasn't sent. Please try again in a moment. If it keeps happening, email admin@evans-software-solutions.com and we'll add you by hand.

**Rate-limited** (429):

> Too many requests from this connection. Please try again in a few minutes.

**Turnstile failed / unavailable** (challenge rejected or 503):

> We couldn't verify the form. Refresh the page and try again, or email admin@evans-software-solutions.com.

**Duplicate** (server returns the normal success body — no enumeration): show the success state.

### Confirmation email to the requester (decided 5 Sep: **send it** — WP8 adds this to `POST /leads/founding`, best-effort, after the admin email)

Resend, plain text, from the existing sender:

Subject: We've got your Persistence launch request

> Hi {firstName},
>
> Thanks for requesting a place on the Persistence introductory launch offer ({interest label}). Every request is reviewed personally, and you'll hear from us by email — usually within a few days.
>
> If there's a place for you, that email will say exactly what access it covers — six months of {interest label} — and how to claim it by signing up in the app with this address. Nothing else is needed from you for now.
>
> Brad
> Persistence · Evans Software Solutions Limited
>
> You're receiving this because you requested launch access at persistence.evans-software-solutions.com. Privacy policy: {link}

### Admin email (WP8)

Subject: New launch access request — {interest label}

Body lines: Name · Email · Interest · Goal (or "(not provided)") · Referral code (or "(none)") · Campaign (or "(direct)") · Consent: yes/no · Request id · Link: `/admin/requests?status=new`

---

## 8. Segmentation

**One page, segmented, not three pages.** Reasons: the audiences share the same product story and the same form; a single URL keeps the pixel, `?ref=` capture and campaign slug simple; and the coach audience is small enough that a dedicated page would fragment the little traffic there is.

Segmentation is done three ways on the one page:

1. **Pre-selection by entry.** `?interest=premium|premium_plus|start_up_coach_plus` pre-selects the segmented control and scrolls past the hero to the matching card on load. Coach ad sets link with `?interest=start_up_coach_plus`.
2. **Card buttons** set the same state in-page.
3. **The coach section** speaks only to coaches and sends them to the form with the coach option set.

If the Meta test shows coach clicks converting materially differently, a `/founding/coaches` variant with a coach-first hero is the first thing to add — the copy for it already exists in § 5.5.

---

## 9. Meta ad-to-page message map

The parallel campaign's creative is Brad's. This map defines what the _page_ promises per segment so the ads can match it; creative angle cells are placeholders to be filled from the ads Brad makes.

| Segment                                       | Likely creative angle (placeholder)           | Ad promise the page fulfils                                                             | Matching page headline                                                                 | Supporting proof / benefit on page              | CTA                                           | Conversion event                                                                                 |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Individuals wanting structure and consistency | [founder story / situation callout — Brad]    | One app that holds the plan, the food and the progress; launch places open              | Train with a plan. Fuel to match. See it add up.                                       | Train / Fuel / Progress columns; Premium card   | Request launch access                         | `Lead` (pixel + CAPI, deduped by `event_id`); `lead_captured` with `campaign`, `ref`, `interest` |
| Committed users wanting the full experience   | [demonstration of Loadout / Mealprint — Brad] | The adaptive suite: programme adapts to your kit, meals planned around your targets     | Same hero; deep-link `?interest=premium_plus` scrolls to the highlighted card          | Premium+ card; Loadout + Mealprint line         | Request launch access (Premium+ pre-selected) | `Lead` as above                                                                                  |
| New or growing coaches                        | [coach workflow demo — Brad]                  | Your clients, your programmes, one place; coach places limited and confirmed separately | Your clients, your programmes, one place. (§ 5.5, via `?interest=start_up_coach_plus`) | Coach tools, programme builder, up to 5 clients | Request coach access                          | `Lead` as above                                                                                  |
| Secondary, iOS only (A1)                      | —                                             | Already sure? Get the app                                                               | —                                                                                      | Store-offer CTA                                 | Redeem in the App Store                       | `store_click` with `campaign`, `ref`                                                             |

### Tracking recommendations

- **Attribution key is the campaign slug**, not UTMs. Ads land on `/founding?ref=<CODE>` via the campaign route the slug provides (`/meta` renders Home today; for the launch page, add `/founding` as the destination and pass the slug the same way — see § 13). UTMs may be appended for Meta's own reporting (`utm_source=meta&utm_medium=paid&utm_campaign=founders&utm_content=<concept>`) but nothing in our stack reads them.
- **Referral code**: `?ref=<CODE>` is captured by `MarketingLayout`, shown in the existing banner, stored in sessionStorage, and pre-fills the form's collapsed code field. Codes never change access — the FAQ says so.
- **Lead event timing**: fire `trackLead(eventId)` and the server `lead_captured` on **successful** submit only (the existing `useLeadSubmit` behaviour), never on button click or form start. Consent-gated on both sides.
- **Custom conversion**: once Meta has received a `Lead` from this page, create a custom conversion on `Lead` filtered to URL contains `/founding`, so the campaign optimises on this form rather than the waitlist/coach forms.
- **Separate page variants**: not for launch (see § 8). Separate **ad sets** per segment linking to the pre-selected URL, yes.

### What this workstream shares with the Meta workstream

The three headlines and the promise column above; the CTA wording; the "no price on this page" rule; the pre-selection URLs; the consent-gated `Lead` behaviour; the fact that the store-offer CTA is secondary and iOS-only.

### What the Meta workstream must return before launch

The chosen concept per segment and its opening line, so the hero sub can be checked for continuity; the audience definitions used per ad set (so the `?interest=` mapping is right); the final list of codes per avenue; confirmation of the Leads objective and the first-week budget split; the `utm_content` naming so `/admin/marketing` metrics can be entered per concept.

---

## 10. A/B tests worth running

Only when there is enough traffic for a decision; otherwise run them sequentially as weekly variants.

1. **Hero framing: outcome (Concept B) vs cohort (Concept A).** Same page below the fold. Measures whether cold traffic needs the product outcome first or responds to "be in from the start". Primary metric: `Lead` rate per landing view. Guardrail: request quality (share of requests with a written goal).
2. **CTA verb: "Request launch access" vs "Apply for launch access".** Hypothesis: "Apply" lowers volume but raises intent and reduces the review burden. Primary: requests per landing view; secondary: Brad's accept rate per variant (from `/admin/requests` status).
3. **Deadline vs numbers.** The default plain '30 September' deadline vs the quiet numeric availability caption (behind `SHOW_AVAILABILITY`). Measures which real scarcity signal moves cold visitors without reading as a database counter. Primary: `Lead` rate; guardrail: bounce on the hero.

Not worth testing now: button colour, card order, FAQ wording.

---

## 11. SEO

Title (≤ 60 chars): `Introductory launch offer — Persistence`

Description (≤ 155 chars): `Six months of full access to Persistence — training, nutrition and progress in one app. Limited places, open until 30 September. Request yours in a minute.`

Canonical: `https://persistence.evans-software-solutions.com/founding`. `robots: index, follow`. H1 as § 5.1. No structured data beyond the existing site defaults.

## 12. Social sharing

`og:title`: `Persistence introductory launch offer — six months of full access`
`og:description`: `Training, nutrition and progress in one app. Limited places, open until 30 September. Request yours in about a minute.`
`og:image`: hero phone mock on the dark background, 1200×630 **[asset needed]**
`twitter:card`: `summary_large_image`, same title and description.

---

## 13. Implementation handoff (React developer / WP9)

- Rebuild `packages/web/src/pages/Founding.tsx` to § 5–7 inside `MarketingLayout`, reusing the existing marketing tokens, `disp` headings, `kicker`, card and `lead-*` classes. One H1.
- `FoundingRequestForm` (new, `packages/web/src/marketing/`), composed from `LeadForms.tsx` primitives: `ConsentRow`, Turnstile widget, honeypot, `useLeadSubmit` → `POST /leads/founding`. Body: `firstName`, `email`, `interest`, `goal?`, `referralCode?`, `campaign?`, `hp`, `turnstileToken`, `event_id`, `marketing_consent`, `fbc?`, `fbp?`. Success/error/429/503 states per § 7.
- `interest` state: initial from `?interest=` (validated against the three ids) → card button → segmented control. On `?interest=` present, `scrollIntoView` the matching card after first paint.
- Referral disclosure: closed by default; open and pre-filled when `storedReferralCode()` returns a value.
- Availability: fetch `GET /founding/availability` as today; render the plain deadline sentence by default; numeric caption only behind a `SHOW_AVAILABILITY` constant (default false) and only when both `cap - used` exceed `AVAILABILITY_FLOOR` (constant, default 10). Never a progress bar.
- Deadline: `OFFER_CLOSES = "2026-09-30"` constant; after that date (Europe/London) the form is replaced by a closed state: heading **The introductory offer has closed**, body `Thanks for your interest — the launch offer closed on 30 September. Persistence is available on the App Store and Google Play.` with the existing store CTAs. Test both sides of the date.
- Requester confirmation email is part of WP8 (`POST /leads/founding`), per § 7; the page does not send mail.
- Secondary store CTA: `StoreOfferCta` from WP3, iOS only, below the closing CTA; hidden when the env URL is unset.
- Remove: birthday line, "allocated personally", "granted, not sold here", "for the period agreed with Brad", "no checkout or payment code", the raw counters. Keep the `FOUNDING_CONTACT_EMAIL` constant (used in error copy).
- Meta: `<title>`, description, canonical, OG/Twitter tags per § 11–12 via the existing head helper.
- Tests (`Founding.test.tsx`): renders hero + form; `?interest=` pre-selects and scrolls; card button pre-selects; validation messages; success state replaces form and shows the free-app line; error and 429 copy; referral disclosure opens with stored code; **existing assertions kept**: no `Pay for` button, no bank section, no price literal on the page; store CTA hidden when unset; banned phrases absent (assert the four strings from the previous page do not render, and that the word "free" appears only in the catalogue line "Everything in Free" and the "Get the free app" success link).
- Privacy (`Privacy.tsx` only, web copy): extend the existing waitlist/coach-enquiry paragraph to cover "launch access requests" and the fields collected (first name, email, access interest, optional goal, optional referral code). Do not touch the mobile copy.
- Accessibility: labels bound to inputs, `aria-live` on success, focus moves to the success heading, segmented control is a `radiogroup`, FAQ accordion is `button`/`region` pairs, contrast per the existing CTA rules (see STATE 2026-08-31 entry).

---

## 14. Decisions taken and what is still needed

Decided 5 Sep 2026 (applied throughout): six-month introductory offer stated on the page; described as an introductory offer, never as "free"; requests open until **30 September 2026**; requester confirmation email sent, "usually within a few days"; availability numbers hidden; founder named once, no photo.

Still needed from Brad before WP9 ships:

1. **Screenshots**: Home (today's session, rings), You (progress), Fuel (today's target), a coach client list, Loadout and Mealprint screens — current build, dark theme, no personal data. Plus a 1200×630 crop for social.
2. **Roadmap promise.** 5.3 says launch members' feedback sets the order of the roadmap. Confirm you'll honour that (a simple feedback channel is enough).
3. **Coach line.** Confirm Start Up Coach+ is the only coach tier offered at launch, and "up to 5 clients" is correct for launch grants.
4. **Terms.** Confirm the current `/terms` wording covers a no-charge, fixed six-month access grant with no renewal, and the 30 September close (your solicitor item from the security review).
5. **Close behaviour.** After 30 September the page shows the closed state (§ 13). Confirm, or tell me if you'd rather extend by changing `OFFER_CLOSES`.
