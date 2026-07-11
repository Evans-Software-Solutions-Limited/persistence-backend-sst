# Persistence — Launch & Revenue Playbook

**Owner:** Brad · **Written:** 2026-07-02 · **Launch target:** ~6 weeks out (mid-August 2026)
**Constraints:** £0 ad budget at launch · iOS-only (Apple IAP via RevenueCat) · solo founder
**Strategy:** Trainers-first. Every trainer you sign is both revenue AND distribution.

---

## 1. The strategy on one page

You have four paid tiers: `premium` (consumer), `individual_trainer`, `small_business`, `medium_enterprise`. With £0 to spend, consumer acquisition is a grind — but **trainers are a leveraged channel**: one trainer paying £15–25/mo brings 10–40 clients into the app for free, and some of those clients convert to premium. That's the flywheel:

```
Recruit trainer → trainer pays (revenue) → trainer onboards clients (free installs)
     ▲                                              │
     └── referrals + case studies + content ◄───────┘
              some clients → premium (more revenue)
```

Everything below serves that loop. Consumer ASO/content runs in parallel but is the slow lane; trainers are the fast lane.

**The honest caveat up front:** fitness is one of the most crowded App Store categories. You will not win on "workout tracker." You win on the trainer↔client relationship (your PT/physio roles, invite flows, client management are already built — most competitors at your stage don't have this) and on being a real person trainers can talk to.

---

## 2. Benchmarks to anchor targets (RevenueCat, State of Subscription Apps 2025)

- Health & Fitness revenue per install: **$0.63 median at 60 days** — highest of any category alongside AI apps (overall median $0.31).
- Trial→paid, Health & Fitness: **39.9% median, 68.3% top decile**. Habit-forming features + community drive the top end.
- **>80% of trials start on day 0** of download. Your paywall placement and onboarding decide almost everything.
- Longer trials convert better: 17–32-day trials convert at **45.7% median** vs. lower rates for 3–7 day trials (which also see the highest instant-cancel rates).
- Higher-priced apps convert download→trial _better_ (9.8% vs 4.3% median) — intent filters itself. Don't race to the bottom on price.

**Implications for Persistence:** offer a 14–30 day premium trial, put the paywall in onboarding (day 0), and don't be shy on trainer-tier pricing.

Also: enrol in the **Apple Small Business Program** (commission drops 30% → 15% under $1M/yr — apply in App Store Connect before launch). RevenueCat is free until $2,500/mo tracked revenue, then 1%.

---

## 3. Phase 0 — Pre-launch (weeks 1–6, starting now)

### Week 1–2: Foundations

- [ ] Apply to Apple Small Business Program (takes time to approve).
- [ ] Buy the domain / landing page with waitlist email capture (Carrd or a static page — free/cheap). Two CTAs: "Join waitlist" (consumers) and "I'm a trainer — get founding access."
- [ ] Set up social handles: TikTok, Instagram, X/Threads, YouTube (same handle everywhere).
- [ ] Draft App Store listing (see §6 ASO) and screenshots.
- [ ] Write the Founding Trainer offer (see §4) and outreach list: 100 named trainers.

### Week 2–4: Founding Trainer recruitment (the main job)

- [ ] Outreach 10–15 trainers/day (scripts in §4). Target: **15–25 founding trainers committed before launch day**.
- [ ] Onboard committed trainers into TestFlight. Their feedback doubles as your final QA — and testers become advocates.
- [ ] Collect testimonials/screenshots from TestFlight trainers for launch content.

### Week 3–5: Content engine warm-up

- [ ] Start posting **before** launch (see §5): build-in-public + trainer-pain content. 3–5 posts/week minimum. The algorithm needs history; day-one accounts get no reach.
- [ ] Record the app in action (screen recordings) — bank 20–30 clips pre-launch.

### Week 5–6: Launch prep

- [ ] Submit for App Review with margin (rejections cost days; IAP-heavy apps get scrutiny — have your paywall, restore-purchases, and account-deletion flows clean).
- [ ] Line up launch-day assets: launch video, App Store link cards, email to waitlist, posts scheduled.
- [ ] Founding trainers briefed: on launch day they post + invite their client lists.

---

## 4. The Founding Trainer Programme (core revenue motion)

### The offer

Trainers won't pay for an unproven app — so trade money for momentum, but **keep a card on file**:

> **Founding Trainer:** 3 months free on `individual_trainer` (starts a trial with card required, or promo entitlement via RevenueCat), locked-in founding price for life after that, direct WhatsApp/Slack line to the founder, name in the app's "Founding Coaches" list, and input on the roadmap.

Why this works: cost to you ≈ £0 (marginal), and each trainer imports their client roster — real installs, real retention, real testimonials. After 3 months their workflow (and their clients' data) lives in Persistence: switching cost does the retention work.

Cap it: "first 25 trainers." Scarcity is real here — you genuinely can't support more as a solo founder.

### Where to find the first 100 trainers

1. **Your own gym(s)** — every PT you've ever trained near. In-person beats every channel.
2. Instagram: search location tags of local gyms; PTs list themselves in bio. UK PT hashtags (#ukpersonaltrainer #ptuk #onlinecoachuk).
3. Facebook groups: "Personal Trainers UK", online-coach business groups.
4. TikTok creators with 1k–20k followers doing coaching content — small enough to reply to DMs, big enough to bring clients.
5. Physio clinics (you support the physio role — almost no competitor does; this is a wedge).
6. Reddit: r/personaltraining, r/PTcert — participate, don't spam.

### Outreach scripts

**Instagram/TikTok DM (cold):**

> Hey [name] — I'm a developer and lifter in [city] and I've built a training app with a proper coach side: you program workouts, clients log them, you see everything they do. I'm taking on 25 founding coaches before launch — 3 months free, founding price locked after, and you get a direct line to me for features. Want a 2-min video of the coach view?

**Follow-up (3 days later, if opened no reply):**

> No stress if it's not for you — one thing I'd genuinely value: what app/spreadsheet do you use with clients now, and what's the most annoying part? Building this in the open and coach feedback shapes it.

(The follow-up converts poorly to sales but brilliantly to intel — and intel-conversations convert later.)

**In person / gym:**

> "You use [Trainerize/TrueCoach/spreadsheets] with clients? I built something — can I show you 60 seconds on my phone?" Then show, don't tell.

### Trainer economics (worked example — plug in real prices)

Assumptions (**illustrative — replace with your App Store Connect prices**): trainer tier £19.99/mo, premium £7.99/mo, Apple takes 15% (Small Business Program).

- 20 founding trainers → after free period: 20 × £19.99 × 0.85 ≈ **£340/mo**
- Each brings avg 15 clients = 300 consumer installs at £0 CAC
- If 10% of those go premium: 30 × £7.99 × 0.85 ≈ **£204/mo**
- ≈ **£544 MRR** from ~20 relationships, before any consumer marketing works at all. That's your ad budget (see §7).

---

## 5. Organic content engine (£0 channel #2)

### What actually "pushes the algorithm"

No tool pushes an algorithm. TikTok/Reels/Shorts rank on **watch time, completion rate, and shares** — full stop. AI tools (see §8) help you produce more, better, faster; the hook and the first 2 seconds do the ranking. Anyone selling "AI algorithm boosting" is selling snake oil.

### Two content tracks

**Track A — Build in public (your founder account):**
"I'm a solo dev building a training app to compete with [big name]" is a durable, proven hook. Post: revenue milestones, App Review pain, feature builds, trainer feedback, the launch-day numbers. Audiences: X/Threads (dev + indie hacker), TikTok (broader). This also compounds into trainer trust — founders who show their face close founding-trainer deals.

**Track B — Trainer/client pain content (the app's accounts):**

- "POV: your coach can see you skipped leg day" (app screen recording)
- "How online coaches program workouts for 30 clients without a spreadsheet"
- "3 things your PT wishes you logged" — duet/stitch bait for trainer creators
- Client transformation + "tracked every session in Persistence" (from founding trainers, with consent)

### Cadence and rules

- 1/day on TikTok if possible, 4–5/wk minimum; cross-post to Reels + Shorts (repurpose, don't re-create).
- Hook in the first 1.5s, on-screen text, native-style (polished ads underperform organically).
- **Founding trainers are your creator network**: part of the founding deal is 1 post/story at launch. 20 trainers × 2k avg followers = 40k warm, fitness-native reach for £0.

### Communities (slow but free)

Reddit (r/fitness weekly threads where allowed, r/personaltraining), UK gym Discords, indie hacker communities for the build-in-public track. Give value first; a naked app-plug gets removed.

---

## 6. ASO (App Store Optimization)

You can't outrank "workout tracker" (MyFitnessPal/Strong/Hevy own it). Target the **trainer-client niche** where volume is lower but intent is exactly yours:

- Title: `Persistence: Coach & Train` (pattern — brand + keyword; check character fit)
- Subtitle keywords: "personal trainer app", "coach clients", "workout log"
- Keyword field: trainer, coaching, PT, client, physio, programming, hypertrophy…
- Screenshots: first two show the **coach↔client relationship**, not another workout logger. Caption-led ("See every set your clients log").
- Ratings: in-app review prompt after a genuinely good moment (PR set, 10th session logged) — never on first open. Founding trainers + clients seed the first 50 ratings.
- Free ASO tooling: Appfigures free tier, AppTweak trial, and Apple's own App Store Connect search-terms data once live. Iterate monthly.

---

## 7. Revenue → paid ads flywheel (how ads pay for themselves)

**Rule: don't spend until the product converts organically.** Paid traffic amplifies your funnel — including a broken one. Gate: ~£500 MRR and trial→paid ≥ ~30% (near the H&F median).

Then, in order:

1. **Apple Search Ads (first £ spent, always).** Highest-intent channel that exists for apps. Start £5–10/day, exact-match only: competitor names (Trainerize, TrueCoach, Hevy Coach, PTminder) + "personal trainer app". Watch cost-per-install vs. your revenue per install (H&F median benchmark $0.63; yours will be higher if the trainer tier converts).
2. **Meta ads to trainers** (not consumers): interest-target fitness professionals; creative = your best-performing organic clip. Trainers have 10–30× the LTV of a consumer, so £30–60 CAC can still be strongly profitable.
3. Skip broad consumer TikTok/Meta ads until MRR > £2–3k. Consumer fitness CACs are brutal against big-app budgets.

**Break-even math (worked example, same assumed prices):** a trainer at £19.99/mo × 85% × ~12-month retention ≈ **£204 LTV**, before counting the premium clients they pull in. Even a £50 CAC returns ~4×. This is why the trainer motion is the whole game.

Reinvest **30–50% of MRR** into ads once the gate is passed; keep the rest as buffer (Apple pays out ~33 days after month end — mind the cash-flow lag).

---

## 8. AI tool stack (what's actually worth using at £0–low cost)

| Job                                                    | Tool                                       | Cost            |
| ------------------------------------------------------ | ------------------------------------------ | --------------- |
| Scripts, hooks, ASO keywords, outreach personalisation | Claude / ChatGPT                           | free–£20/mo     |
| Video editing, captions                                | CapCut                                     | free            |
| Long recording → many short clips                      | OpusClip (or Descript)                     | free tier       |
| Voiceover for demo videos                              | ElevenLabs                                 | free tier       |
| Thumbnails, App Store screenshots, social graphics     | Canva (+ Figma, which you have)            | free            |
| Scheduling/cross-posting                               | Buffer or Later                            | free tier       |
| ASO keyword tracking                                   | Appfigures                                 | free tier       |
| Revenue/conversion analytics                           | RevenueCat dashboards (already integrated) | free < $2.5k/mo |

Workflow that makes one hour produce a week of content: record one 10-min screen-share of you using/building the app → OpusClip cuts 8–10 shorts → CapCut captions → Buffer schedules across TikTok/Reels/Shorts. Claude writes 20 hook variants; you pick 5.

What to ignore: "AI growth hacking" tools, follower bots, engagement pods, paid "viral audit" services. They range from useless to account-killing.

---

## 9. Metrics & weekly rhythm

Track weekly (RevenueCat + App Store Connect give you all of it):

- Founding trainers: contacted → replied → demoed → committed → active
- Installs, download→trial %, trial→paid % (target ≥30%, stretch 40%+)
- MRR by tier; clients-per-trainer; trainer churn (the number to fear most)
- Content: posts shipped, views, profile-visits → App Store taps

Weekly cadence (solo-founder realistic): Mon — plan + schedule content; Tue–Thu — trainer outreach blocks (45 min/day) + build; Fri — metrics review + 1 experiment decided for next week.

---

## 10. Milestones

| When       | Milestone                                                                              |
| ---------- | -------------------------------------------------------------------------------------- |
| Launch day | 15–25 founding trainers live, 50+ ratings pipeline, waitlist emailed                   |
| Month 1    | 20 active trainers, 200+ client installs, first premium conversions                    |
| Month 2    | ~£500 MRR → switch on Apple Search Ads (£5–10/day)                                     |
| Month 3    | ~£1k MRR, trainer referral loop formalised ("give a month, get a month")               |
| Month 4–6  | £2–3k MRR → Meta ads to trainers; consider Android/web rail to unlock non-iOS trainers |

**Two structural notes for later:** (1) iOS-only halves your trainer market — UK Android share is ~45–50%; the web rail (Stripe, already dormant in your codebase) is the cheapest way to let Android-owning _trainers_ pay while their iOS clients use the app. (2) Business tiers (`small_business`, `medium_enterprise`) shouldn't be marketed at launch — they're a month-6+ motion once you have individual-trainer case studies to sell with.

---

_Prices marked "assumed" are placeholders — swap in your actual App Store Connect price points and re-run the math in §4/§7. Benchmarks: RevenueCat State of Subscription Apps 2025._
