# Traction plan — channels not already in the launch playbook

**Written:** 2026-07-26 · **Owner:** Brad
**Scope:** additive only. The trainer flywheel, content engine, ASO and paid-ads
gate are in `LAUNCH_PLAYBOOK.md` and are not repeated here.

> No web search this session. Apple/TestFlight mechanics below are from general
> knowledge — verify limits and review behaviour in App Store Connect before
> depending on any specific number.

---

## A. Public TestFlight before 1 August — do this first

**Window: now → 31 July. Five days.**

`SHIPATON_2026_PLAN.md` states the rule: *"Building/brainstorming/posting before
Aug 1 is explicitly allowed. TestFlight/dev is not a 'release.'"* So everything
below is free of the eligibility constraint. ⚠ The full official rules were still
pending when that doc was written — re-read them before relying on this.

Today TestFlight is being used only for your own device QA (`STATE.md` line 135,
the 22 July session that produced QA-1…QA-20). That's leaving the single biggest
free lever untouched.

### What it buys you

1. **Real bugs.** You found 20 testing alone. Twenty testers will find the next twenty.
2. **Testimonials and screenshots** for the App Store listing and launch content —
   you currently have none, and `STATE.md` line 143 notes a fabricated 5-star row
   was already (rightly) dropped from the site.
3. **A warm day-one cohort.** People who install and rate on 1 August. Ratings are
   your weakest ASO asset at zero.
4. **A traction spike inside the judging window** — precisely what the Grand Prize
   is scored on.

### Mechanics to get right

- **Public link**, not email invites — App Store Connect → TestFlight → Public
  Link. Shareable URL, up to ~10,000 external testers.
- **External testing needs Beta App Review.** Lighter than full App Store review,
  but it is a review and it takes time. Submit immediately.
- **Builds expire after 90 days.** Fine for this window.
- **IAPs are free in the TestFlight sandbox.** Two consequences: you cannot
  validate real purchase conversion here, and testers get Premium/Premium+ for
  nothing. Say so explicitly or you'll get complaints on 1 August.
- **TestFlight users cannot leave App Store ratings.** They must install the
  public App Store build separately on launch day. This is the whole reason the
  day-one email in § A.4 exists — do not assume the cohort carries over by itself.
- **Their data does carry over** — accounts are server-side (Supabase auth +
  Postgres), so a tester who installs the App Store build signs in and finds
  everything intact. Make that promise explicitly; it removes the main objection.

### A.1 Recruitment copy — public link

**For coaches (the priority):**

> I'm opening the beta of Persistence before it hits the App Store next month.
> It's a training and nutrition app with a proper coach side — you program,
> your clients log, you see every set they actually did. Works offline, so the
> basement free-weights room isn't a problem.
>
> I want coaches in early because your feedback shapes what ships. Free while
> it's in beta, and founding coaches keep a founding rate afterwards.
>
> [link] — you'll need the TestFlight app first.

**For consumers:**

> Persistence is a workout and nutrition tracker launching on iOS next month.
> I'm letting people in early to find the rough edges. Everything's unlocked
> and free during the beta, and your account carries over at launch.
>
> [link] — needs the TestFlight app. Tell me what's broken.

### A.2 "What to Test" brief

Goes in the TestFlight description field. Testers who are told what to look at
report ten times better than testers who aren't.

> Thanks for testing. Most useful areas:
>
> 1. **Logging a session** — start a workout, log sets, finish. Anything slow,
>    fiddly or confusing?
> 2. **Offline** — put your phone in aeroplane mode mid-session, log a few sets,
>    come back online. Did everything sync?
> 3. **Nutrition** — barcode scanner and food search. Missing foods? Wrong data?
> 4. **Coaches** — invite a client, assign a programme, check what you can see.
> 5. **Anything that crashes**, or any number that looks wrong.
>
> Everything is unlocked and free during the beta. Your account carries over
> when the App Store version lands, so nothing you log now is wasted.
>
> Feedback: shake the device, or admin@evans-software-solutions.com.

### A.3 Recruitment targets, in order

1. Your own gym's PTs and members — in person, highest conversion
2. The founding-coach outreach list (`OUTREACH_BATCH_01.md` § A) — beta access is
   a *better* opening than a founding offer, because it asks for help rather than money
3. r/fitness daily threads, r/personaltraining, r/physicaltherapy — where the
   rules allow beta posts
4. Friends and family for basic flow-breaking

### A.4 Day-one email to the cohort (1 August)

> Persistence is live on the App Store.
>
> One thing I need from you: **download it from the App Store** — the TestFlight
> build won't update into it. Sign in with the same account and everything
> you've logged is there.
>
> And if the beta was useful, a rating genuinely changes whether anyone else
> finds this. It takes twenty seconds.
>
> [App Store link]
>
> Thank you — the app is meaningfully better for your having broken it.

---

## B. Apple editorial featuring nomination

Free, high-leverage, and almost nobody submits it. There's a featuring
nomination form in App Store Connect. Apple's editorial team looks for design
quality, novel platform use, a good story, and local relevance.

Your hooks, in the order Apple cares about them:

- **Offline-first architecture** — a real engineering choice with an obvious user
  benefit ("works in a basement gym with no signal")
- **HealthKit integration** (`specs/07-health-integration`)
- **The coach/physio relationship model** — genuinely uncommon in consumer fitness
- **Solo UK founder**, UK-registered company — editorial teams run regional stories

Submit three to four weeks ahead of the moment you want. Nominate once for the
August launch, then again for January.

---

## C. MSK and physio channels — uncrowded, high intent

The same reframe that works on benefits brokers works for consumer acquisition.
In "fitness app" you are invisible against MyFitnessPal and Hevy. In rehab
adherence you have almost no competition.

Channels: Chartered Society of Physiotherapy member groups, physio-specific
Facebook groups, r/physicaltherapy, MSK and rehab podcasts, sports-therapy
courses and their alumni networks.

Smaller audiences, dramatically higher intent, and every physio who adopts brings
a patient roster the same way a coach brings clients.

---

## D. The Shipaton cohort is itself a channel

Entrants cross-promote, RevenueCat runs a community and amplifies participants,
and #BuildInPublic is simultaneously a prize category and free reach to an
audience of people who habitually try new apps. You were already committed to the
content cadence — being visibly present in that community costs nothing extra and
compounds.

---

## E. Independent gyms — physical distribution for £0

Not chains. Independent gyms and PT studios, who care about member retention and
have wall space.

The offer: their members get Premium free for three months; they put a QR poster
by the door and mention it at induction. No cash moves. It's physical
distribution in exactly the place your users already are, and it feeds the coach
flywheel because their PTs are your founding-coach targets.

Ask for the poster placement *after* they've said yes to the member offer, not as
part of the same ask.

---

## F. Instrument the loop you already built

Your coach→client invite flow is a working viral mechanic sitting in the product
untracked. Before adding a single new channel, measure:

- clients invited per coach
- invite → install
- install → first session logged
- client → premium conversion

You have the `product-tracking-skills` plugin installed, which is built for
exactly this. Improving a loop that exists beats adding a channel that doesn't —
and these are the same numbers the Shipaton Grand Prize wants to see.

---

## G. January, not August

August is close to the deadest month in the fitness calendar. The first week of
January is the annual spike, by a wide margin.

Your launch date is fixed by Shipaton, so frame expectations accordingly:
**August–September is for building the machine and winning the competition;
January is the consumer moment.** Second featuring nomination in early December,
seasonal ASO, and a content run into the new year.

Revisit properly in October once Shipaton results are in (21 Oct) — no point
planning it in detail now.

---

## H. Sequencing, and what not to do

| When | Focus |
| --- | --- |
| **Now → 31 Jul** | Beta App Review submitted, public TestFlight link live, testers recruited. Nothing else matters this week. |
| **1 Aug** | Public release. Devpost project. Day-one email to the cohort. #BuildInPublic starts. |
| **Week of 4 Aug** | Product Hunt — *after* you have ratings, not on launch day |
| **Aug–Sep** | Coach recruitment, content cadence, MSK channels, weekly RevenueCat metrics |
| **Oct** | Shipaton results. Plan January. Reassess everything on real numbers. |

**Don't:**

- Stack Product Hunt, the public launch and the Shipaton kickoff on the same day —
  you get one shot at each and they'll cannibalise
- Spend on ads before the `LAUNCH_PLAYBOOK.md` § 7 gate (~£500 MRR, ≥30% trial→paid)
- Let TestFlight feedback push the 1 August date. Ship, then fix
- Expect August consumer numbers to look good. They won't, and that's seasonal,
  not a product failure
