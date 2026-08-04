# Waitlist & Founding Offer — page copy + mechanics

**Written:** 2026-07-25 · **Owner:** Brad · **Status:** DRAFT for review
**Decision taken (Brad, 2026-07-25):** free waitlist now, charge at launch. No
paid pre-sale, no web payment rail before the iOS release.

> This supersedes the "possibly display on the homepage / TBC" state of
> `WEBSITE_PRICING_SPEC.md` § 4 and answers open decision § 6.4. The HARD
> EXCLUSION recorded in `STATE.md` line 143 (no founding-waitlist or early-bird
> anywhere on the site) was pending exactly this review — this doc is that
> review. Nothing ships to `packages/web` until Brad signs off below.

---

## 1. Why a free waitlist rather than a paid pre-sale

Three reasons, in order of weight:

1. **Shipaton eligibility.** `SHIPATON_2026_PLAN.md` requires the first public
   store release to fall between 1 Aug and 30 Sep 2026. A waitlist touches
   nothing in that constraint. A paid pre-sale creates pressure to ship early —
   the one thing that silently disqualifies a $50k entry.
2. **You cannot deliver yet.** The build is in App Review, not approved. Taking
   money for access to an unapproved app is refund liability if review turns,
   and under the UK Consumer Contracts Regulations 2013 consumers get a 14-day
   cancellation right on a digital service that hasn't started.
3. **The paid rail doesn't exist.** `specs/stripe-rail-removal/RECON.md` is
   explicit — RevenueCat Web Billing is the intended single rail for web, but it
   is PARKED, "do not execute pre-release", and the mobile Stripe branch is
   unreachable on iOS. A paid pre-sale page is a new build, not a config change.

A waitlist gets the same commercial outcome — a warm list that converts on day
0, which is where >80% of trials start (`LAUNCH_PLAYBOOK.md` § 2) — at zero
build risk.

---

## 2. Mechanics: how founding access is actually granted

This is the part worth getting right, because the codebase already decides most
of it.

### Recommended: App Store **Offer Codes** (primary rail)

| Why | Detail |
| --- | --- |
| Quantity-capped | You can issue a fixed number of one-time-use codes — this is what makes "first 25 coaches" real rather than a marketing claim. |
| Card on file | Redemption attaches the Apple Account payment method. Apple bills automatically at month 4 with no action from you or the coach. This is the single biggest conversion lever you have. |
| No new billing code | Codes redeem against the existing `individual_trainer` subscription group. |

⚠ **Build gap:** offer-code redemption is **not implemented**. `grep` for
`presentCodeRedemptionSheet` across `packages/mobile` returns nothing. RevenueCat
exposes it on the iOS SDK; it needs adding to `revenuecat.adapter.ts` +
`purchases.port.ts` and a redeem entry point (Profile drawer is the natural
home). Small, self-contained, and it must land before you promise codes to
anyone. Codes can also be redeemed via URL outside the app as a stopgap.

### Not the right tool here: Apple introductory offers

A 3-month free trial as an introductory offer applies to **every** new
subscriber in the group — it can't be limited to 25 people. `useIntroEligibility`
already reads real per-Apple-ID eligibility from RevenueCat, so the paywall will
honestly reflect whatever you configure. Use an intro offer as the *public*
launch trial (`LAUNCH_PLAYBOOK.md` § 2 recommends 14–30 days on the strength of
the 17–32 day cohort converting at 45.7% median). Keep it separate from the
founding programme.

### Fallback: RevenueCat promotional entitlements

No card, granted server-side, no IAP involved. Right for cases that can't route
through the App Store — comped accounts, B2B seats under manual invoice
(`WEBSITE_PRICING_SPEC.md` § 3), Android coaches later. Wrong as the default
founding mechanic precisely *because* there's no card: take-up rises, month-4
conversion collapses.

**Net:** offer codes for the 25 founding coaches, promo entitlements for
exceptions, intro offer for the public launch trial.

---

## 3. Founding Coach offer — proposed terms

Changed from `LAUNCH_PLAYBOOK.md` § 4 in one material respect: the price lock is
bounded.

> **Founding Coach — first 25**
>
> - **3 months free** on Individual Trainer (£14.99/mo thereafter)
> - **Founding price held at £14.99/mo for as long as your subscription stays
>   continuously active**, guaranteed for a minimum of 24 months
> - A direct line to me — WhatsApp or email, not a support queue
> - Your name in the app's Founding Coaches list
> - Real input on the roadmap; founding coaches see specs before they ship

### On dropping "locked for life"

`LAUNCH_PLAYBOOK.md` § 4 promises "founding price locked for life". I'd not sign
that. It is a permanent, unbounded margin commitment made at your *lowest-ever*
confidence about costs — and your costs here are genuinely uncertain, because
Premium+ carries per-user AI inference (spec-21 adaptive workouts, spec-26
Mealprint, spec-15 classification). "Held while continuously subscribed, minimum
24 months" reads as generous, is materially cheaper to honour, and adds a
retention hook: lapsing forfeits the rate.

If you want the stronger promise for closing power, bound it a different way —
lock the price for life *on the Individual Trainer tier only*, explicitly
excluding future tiers and add-ons. Your call; flagging it rather than deciding
it.

### Cap honesty

25 is a real constraint, not scarcity theatre — you're one person offering a
direct line. Say so in the outreach. It's more persuasive than manufactured
urgency and it's true.

---

## 4. Page copy

Two CTAs on one page, coach-first. The consumer list is worth collecting but the
coach list is the revenue motion.

### Hero

> ### Train. Fuel. Coach.
>
> Persistence is a workout and nutrition tracker with a proper coach side —
> you program, your clients log, you see everything they do. Offline-first, so
> it works in the basement free-weights room with no signal.
>
> **Coming to the App Store this August.**

### Coach CTA (primary)

> **Founding Coaches — 25 places**
>
> I'm taking on 25 coaches before launch. Three months free, your founding rate
> held while you stay subscribed, and a direct line to me for the features you
> actually need. I'm one person, which is why it's 25 and not 250.
>
> `[ I'm a coach — apply for founding access ]`
>
> *Name, email, where you coach, how many clients, what you use today.*

### Consumer CTA (secondary)

> **Get it first**
>
> Join the list and I'll email you the day it's live. No spam, no drip
> sequence — one email at launch.
>
> `[ Join the waitlist ]`  *Email only.*

### Microcopy

- Submit button, coach form: `Apply for founding access`
- Submit button, consumer: `Join the list`
- Coach success state: `You're in. I read every one of these myself — expect a reply within two days, usually sooner.`
- Consumer success state: `Done. One email, launch day. Nothing else.`
- Validation, email: `That doesn't look like an email address.`
- Error: `That didn't send. Try again, or email admin@evans-software-solutions.com and I'll add you manually.`

Voice notes: first person singular throughout — the solo founder *is* the
differentiator per `LAUNCH_PLAYBOOK.md` § 5 Track A. No exclamation marks, no
"revolutionise", no fabricated social proof (`STATE.md` line 143 already dropped
a fake 5-star row — don't reintroduce the pattern in a different costume).

---

## 5. What needs building in `packages/web`

`STATE.md` line 164: "no waitlist code exists (only in `marketing/` docs)". So
all of this is net-new.

| Item | Notes |
| --- | --- |
| Waitlist section on `/` | Home.tsx is described as a placeholder in STATE.md line 164 — confirm current state before editing. |
| Two forms + storage | Simplest path that avoids new infra: a form service (Formspree/Buttondown/Resend) posting straight from the Vite app. A DB table means a backend route, a migration and GDPR retention rules for no launch-critical gain. |
| GDPR basics | Lawful basis = consent. Unticked opt-in, purpose stated at point of capture, one-click unsubscribe, and it must match `/privacy`. You are a UK data controller for this list. |
| Keep `appStore.available = false` | `marketing/config.ts` — every CTA reads from here. Flip on launch day, not before. |

**Do not** add an App Store link or a "pre-order" CTA. App Store pre-orders are
a store-side release mechanism and interact with the Aug 1 constraint; don't go
near them without re-reading the Shipaton rules.

---

## 6. Launch-day sequence

1. **Now → 31 Jul** — waitlist page live, coach outreach running (see
   `OUTREACH_BATCH_01.md`), offer-code redemption built and device-verified,
   codes generated in App Store Connect. Release stays **Manual**.
2. **1 Aug** — public release. Flip `appStore.available = true` + fill `appId`.
   Create the Devpost project. Email both lists.
3. **1 Aug, +1h** — send offer codes to committed founding coaches individually,
   not as a bulk BCC.
4. **Aug–Sep** — #BuildInPublic cadence inside the judging window; weekly
   RevenueCat metric capture for the Grand Prize traction narrative.
5. **~1 Nov** — first founding-coach renewals land. This is the number that
   tells you whether the programme worked.

---

## 7. Decisions — resolved 2026-07-26

Brad confirmed the waitlist + founding-offer route. Defaults taken below so the
build is decision-complete; override any of them and the brief in § 9 still holds.

| # | Decision | Taken | Rationale |
| --- | --- | --- | --- |
| 1 | Price lock | **Held while continuously subscribed, 24-month minimum** | § 3 — bounded commitment, adds a retention hook, still reads generous |
| 2 | Homepage treatment | **Full coach-first block**, consumer secondary | Supersedes the `STATE.md` line 143 hard exclusion, which was pending exactly this review |
| 3 | Consumer waitlist | **Yes, both lists** | Nearly free to collect; the coach form stays visually primary |
| 4 | Public launch trial | **30 days** | `LAUNCH_PLAYBOOK.md` § 2 — 17–32 day trials convert at 45.7% median vs. much worse for 3–7 day. Costs two weeks of first revenue, worth it |
| 5 | Storage + email | **Own stack: Supabase table + SES.** No third-party form tool | See § 8 — you already have both, and adding Formspree/Buttondown would mean a new sub-processor immediately after documenting the list in `CHANNEL_GROUNDWORK.md` § C |

---

## 8. ⚠ SES sandbox — check this before anything else

**This is a potential launch-day blocker and I can find no record of it being
addressed.**

`infra/email.ts` provisions SES properly — verified domain, DKIM, DMARC,
least-privilege SMTP user, credentials in SSM. What it cannot do in code is grant
**SES production access**. Every AWS account starts SES in **sandbox mode**,
where you can only send to *verified* identities and are capped at ~200
messages/day.

If the account is still in sandbox:

- Supabase auth confirmation emails to real new users **fail silently**
- Nobody who signs up on 1 August can confirm their address
- The waitlist launch email cannot be sent either

The SES delivery test in the `admin@` inbox (19 July, "Direct SES test to confirm
delivery to admin@evans-software-solutions.com") proves sending to your **own
verified domain** works — which succeeds in sandbox too, so it does not tell you
which mode you're in.

**Action:** check the SES console for the account and stage in use. If it says
sandbox, request production access today — approval typically takes ~24 hours and
you have six days. Nothing else on this page matters if signup email is broken.

Grep found no mention of SES production access in `STATE.md` or `infra/`, so treat
it as unverified rather than done.

---

## 9. Implementation brief

Sized to be a single small PR against `packages/web` + `microservices/core` +
`packages/db`. Follows the repo conventions in `CLAUDE.md`.

### Backend

**Table** — new migration, idempotent:

```
waitlist_signups
  id            uuid pk default gen_random_uuid()
  email         text not null
  list          text not null   -- 'coach' | 'consumer'
  name          text            -- coach form only
  location      text            -- coach form only
  client_count  text            -- coach form only
  current_tool  text            -- coach form only
  consent_at    timestamptz not null
  source        text            -- utm/referrer, nullable
  created_at    timestamptz not null default now()
  unique (email, list)
```

**Route** — `POST /waitlist`, public (no `requireAuth`):

- Typebox guard: `t.Object({ email, list, name?, location?, clientCount?, currentTool?, source? })`
- Validate email shape; normalise to lowercase and trim
- Upsert on `(email, list)` so a double submit is idempotent, not a 500
- Rate-limit by IP — this is your first unauthenticated write endpoint, so it's
  the first thing anyone can abuse. Do not skip this
- Return `204` regardless of whether the row already existed (don't leak list membership)
- No PII in logs, no email in query strings

**Deliberately out of scope:** no confirmation email at signup. Adds SES coupling
and a bounce-handling problem for a list you'll only mail once. Collect now,
mail on launch day.

### Frontend

- Waitlist section in `packages/web/src/pages/Home.tsx`, copy verbatim from § 4
- Coach form: name, email, location, client count, current tool
- Consumer form: email only
- **Unticked** consent checkbox on both, with the purpose stated at the point of
  capture — consent is the lawful basis, so it cannot be pre-ticked or bundled
- Success and error states from § 4 microcopy
- Leave `appStore.available = false` in `marketing/config.ts`. Flip on 1 August

### Tests

Coverage gate is 90% on `src/application/**` and repositories, so:

- Repository: insert, duplicate upsert, invalid list value
- Handler: valid coach payload, valid consumer payload, malformed email, missing
  consent, rate-limit trip
- Frontend: renders both forms, submits, shows success, shows error

### GDPR

- Lawful basis: consent. Record `consent_at`
- Privacy policy at `/privacy` needs a line covering the waitlist purpose and
  retention before the first address is captured
- Retention: delete unconverted signups 12 months after launch. Write it down —
  it's also gap 3 in `CHANNEL_GROUNDWORK.md` § C
- One-click unsubscribe in the launch email

### Definition of done

`bun run prettier:check && typecheck && lint && build && test:unit` green,
coverage ≥ 90% on changed files, conventional commit, and the page verified on a
real device before it goes near `main`.
