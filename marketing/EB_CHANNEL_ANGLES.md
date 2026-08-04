# Employee-benefits channels — angles, readiness gap, sequencing

**Written:** 2026-07-25 · **Owner:** Brad
**Origin:** colleague's email suggesting "commission-based brokers" — Perkbox,
Mercer, Howden, and a warm intro to **James Henson at PIB Employee Benefits**
(https://www.pib-eb.com/).

> Researched by fetching the vendors' own pages on 2026-07-25. Facts attributed
> to those pages are quoted; commission rates, sales-cycle timings and due-diligence
> requirements are **general-knowledge estimates and must be confirmed in the
> conversations themselves** — I had no web search, only direct page fetches.

---

## 1. The headline correction: this is distribution, not funding

Worth separating from the original funding question. None of these channels give
you money up front. They give you **access to employers you cannot reach as a
solo founder**, in exchange for margin. That's valuable — it's the delivery
mechanism for `FUNDING_AVENUES.md` item 3 (B2B pilot revenue) — but it is not a
funding round and it will not pay for anything before 2027.

Second correction: **Perkbox is not a broker.** Its own partnerships page pitches
it as *"a unique marketing channel that lowers your CPA"* and the brands listed
on it are Tesco, Greggs, Uber Eats, ASOS, Cineworld. That's a **discount
marketplace** — you offer Perkbox's members a discount, they give you exposure.
Different economics from a broker panel entirely, and worth knowing before you
walk into the conversation using your colleague's framing.

---

## 2. The two live leads, and what each actually is

### PIB Employee Benefits — a genuine intermediary, and the better lead

FCA authorised (FRN 300198), company no. 02026964, part of PIB Group. MD **David
Skinner**. Describes itself as offering *"industry-leading broking and
intermediary expertise"* across protection, risk, healthcare and workplace
savings.

**The route in is `glo`, their benefits platform** — and this is the specific
thing to ask about. The glo page describes *"a range of plug-and-play benefits and
discounts"*, lists **"Voluntary & flexible benefits"** and **"Market review &
procurement"** among its capabilities, and is sold in packages (Save / Inform /
Connect). Head of Corporate is **Victoria Watts**
(linkedin.com/in/victoriap-watts), who is quoted as owning the glo proposition.

So the ask to James Henson is *not* "will you sell my app." It's:

> "What would glo need to see before something like this could sit on the
> platform as a voluntary benefit?"

That question costs him nothing, takes 20 minutes, and hands you the entire
requirements list (§ 4) for free. If it goes well, ask him to point you at
whoever owns glo supplier onboarding — likely Victoria Watts' team.

**One reassurance:** PIB's own footer notes *"Not all products and services are
regulated by the FCA."* A fitness and nutrition app is not a regulated product,
so **you need no FCA authorisation** to be distributed this way. Just don't let
any agreement be structured as insurance mediation.

### Perkbox (now Perkbox Vivup) — a consumer acquisition channel

*"7,500+ companies across 140 countries."* Entry point is a form:
https://www.perkbox.com/contact/partnerships

Two things make this more interesting than it first looks:

- **It's £0-CAC consumer distribution.** `LAUNCH_PLAYBOOK.md` § 7 says don't
  spend on ads until ~£500 MRR and ≥30% trial→paid. A Perkbox listing is
  reach without ad spend — you pay in discount, not cash. That fits your
  constraint exactly.
- **The NHS/public-sector base.** Client logos include Oxford University
  Hospitals, Sheffield Teaching Hospitals and Dorset Healthcare NHS Foundation
  Trusts, and there's a dedicated public-sector solution page. The Vivup merger
  (careers site is `perkboxvivup.teamtailor.com`) deepens that. NHS staff
  wellbeing is a funded priority and a very large employee population.

**But:** a discount listing sells *consumer* subscriptions, not seats. It won't
produce the B2B contract revenue in `WEBSITE_PRICING_SPEC.md` § 3. Treat it as an
acquisition channel and judge it on installs and trial starts, not MRR per deal.

Don't use the press addresses on that page — they're PR, not partnerships.

### Mercer and Howden — right category, wrong stage

Mercer (Marsh McLennan) and Howden's employee-benefits arm are large consultancies
serving enterprise clients. They will want references, audited accounts,
security certification and a track record. **You have none of those yet.** Keep
your colleague's offer to dig out contacts — just don't spend your pre-launch
weeks there. These are a mid-2027 conversation.

---

## 3. Angles your colleague didn't mention — and one that's better than all of them

### 3a. Wellbeing marketplaces — the lowest barrier, best first target

Allowance-based platforms (Heka, Juno, Ben, Thanks Ben and similar): the employer
gives each employee a wellbeing budget, the **employee** chooses what to spend it
on from a marketplace. Verify current names and terms — I couldn't search.

Why this is the right first door:

- **No employer procurement cycle.** You're being *chosen* by individuals, not
  approved by a benefits committee. That skips most of § 4.
- **Onboarding is a supplier listing**, not a panel appointment.
- The purchase is essentially a consumer subscription paid from an allowance, so
  your existing tier catalogue works with no new billing model.

If any of these channels produces revenue in 2026, it's this one.

### 3b. Flex and benefits platforms

Zest, Benefex, Darwin (Mercer's own platform), Reward Gateway, Vivup. Same shape
as glo — you're a listed benefit within someone else's platform. Middle barrier,
middle reward. Worth mapping once you know what glo asks for, because the
requirements largely transfer.

### 3c. Occupational health, EAP and PMI ecosystems

EAP and occupational-health providers, and insurers with wellness programmes
(Vitality's model rewards logged activity directly). Long shots individually, but
the data fit is real and one relationship here is larger than twenty coaches.

### 3d. **Reframe from "fitness app" to MSK — this is the strongest angle available**

The single most useful thing in this document.

Brokers and benefits consultants don't get paid for perks. They get paid for
**reducing the cost of absence and claims**. Musculoskeletal conditions are one
of the largest drivers of UK sickness absence, and the standard employer response
— physio sessions — has a well-known hole in it: nobody knows what the patient
actually did between appointments.

You already solve exactly that, and it's already built:

- A **native physio role**, not a PT tool with rehab bolted on
- `specs/28-coach-data-sharing-consent` — explicit per-patient consent
- `specs/27-coach-health-data-read-audit` — an audit trail on clinician access
- Offline-first logging, so a basement gym with no signal isn't a blocker
- Aggregate-anonymised-only employer dashboard (`WEBSITE_PRICING_SPEC.md` § 3)

"Workout tracker" is a crowded perk nobody needs a broker for. "**Rehab
adherence visibility with clinician oversight and consent-gated access**" is an
absence-cost story a consultant can put in front of a client and justify. Same
product, same code, radically different conversation.

`LAUNCH_PLAYBOOK.md` § 4 already calls physios "a wedge almost no competitor has."
This is that wedge pointed at a channel that pays.

---

## 4. The readiness gap — what you'll be asked for, and don't have

Be clear-eyed: you are pre-launch, zero customers, one person, and you process
**special-category health data**. Every serious intermediary will ask for most of
this. Better to know now than to be surprised on the call.

| Requirement | Status | Notes |
| --- | --- | --- |
| Live product | ⚠ In App Review | Set to Manual release for Shipaton — don't break that |
| Customer references / case study | ❌ None | Founding coaches become your first references |
| Cyber + professional indemnity insurance | ❓ Verify | Near-universally required. Cheap relative to the deals |
| Security certification | ❌ | **Cyber Essentials / Cyber Essentials Plus** is the cheap, achievable stepping stone. ISO 27001 comes later |
| Security questionnaire | ❌ | Answer once properly, reuse forever |
| DPIA | ❌ | Legally expected given health data, and the first thing a benefits consultant's compliance team asks for |
| DPA with Art. 28 processor terms | ❌ | Needed per employer |
| **Art. 9 special-category basis** | ❌ | The big one. Employee fitness and rehab data is special category. Your anonymised-only employer dashboard is your strongest answer — lead with it |
| Accessibility (WCAG 2.1 AA) | ❓ | Real for NHS and public sector. You have a `design:accessibility-review` skill — worth running |
| NHS DSPT | ❌ | Only if you pursue NHS employers via Vivup |
| Financial standing | ⚠ Thin | Evans Software Solutions Ltd is young. Some panels check |

**Sequencing view:** DPIA, a reusable security questionnaire and Cyber Essentials
are the three that unlock the most doors for the least money. None of them are
urgent this week. All of them are cheaper to do before someone asks.

---

## 5. Commission economics — price for the channel, don't discount into it

`WEBSITE_PRICING_SPEC.md` § 3 has seats at **£4–6/month, explicitly TBC.** That
figure was set for direct sales. An intermediary taking a cut leaves very little:

| Seat price | Intermediary cut | Net to you |
| --- | --- | --- |
| £5.00 | 20% | £4.00 |
| £5.00 | 30% | £3.50 |
| £6.00 | 30% | £4.20 |

Three rules before you sign anything:

1. **Set the channel price above the direct price**, or accept a thinner margin
   knowingly — don't discover it after signing.
2. **No exclusivity.** Ever, but especially not to your first intermediary.
   Exclusivity is worth something only to them.
3. **Cap the term.** 12 months with renewal, not evergreen.

Also decide who owns the customer relationship and the data — with special
category data this is a controller/processor question, not just a commercial one.

---

## 6. Realistic timing

| Window | Reality |
| --- | --- |
| **Now → 31 Jul** | Take the James Henson intro. Submit the Perkbox partnerships form. Nothing else — the launch is six days out and it outranks all of this. |
| **Aug – Sep** | Launch, Shipaton judging window, founding coaches. Channel conversations run in the background only. Do not let a broker call displace the traction push. |
| **Oct – Dec** | Real channel work: DPIA, security questionnaire, Cyber Essentials, insurance. Use founding coaches as references. Target wellbeing marketplaces first. |
| **Jan – Apr 2027** | Earliest plausible revenue. Many UK employer schemes renew 1 Jan or 1 Apr, so missing a renewal date costs a full year. |

**The trap to avoid:** broker conversations feel like progress because they're
flattering and involve grown-up companies. They are the slowest revenue on your
board. The trainer flywheel and Shipaton are the fast lane. Give this an hour a
week until October, no more.

---

## 7. Reply to your colleague — draft

> Hi {name},
>
> Good, thanks — and thank you, that's a genuinely useful list.
>
> I'd very much like the intro to James Henson if you're happy to make it. I had
> a look at PIB and I think the relevant bit is **glo** — their benefits platform
> carries "plug-and-play" voluntary benefits, which is roughly the shape of what
> I've got. I'm not going to pitch him; the ask is 20 minutes on what glo would
> need to see before something like this could sit on the platform. If he can
> point me at whoever owns supplier onboarding, even better.
>
> On Perkbox — I looked, and I think it's a discount marketplace rather than a
> broker: you list an offer, their members get a discount, you get reach. Still
> useful to me as a distribution channel, just a different deal shape, so I've
> gone in through their partnerships form separately.
>
> Mercer and Howden I'd love the contacts for, but I'll be honest that I'm
> probably too early for them — no launched product until August and no client
> references yet. Happy to be told I'm wrong about that.
>
> One thing I'd value your read on: the angle I think actually sells through a
> benefits consultant isn't "fitness app" but **MSK**. The app has a proper physio
> role — assign a rehab programme, see what the patient actually completed between
> appointments, with consent-gated clinician access and an anonymised-only
> employer view. Absence cost rather than perk. Does that land better with the
> people you know?
>
> Brad

Adjust the tone to how you actually talk to them — this reads as a colleague, not
a supplier, which is right.

---

## 8. Outreach drafts

### 8a. Perkbox partnerships form

> Persistence is a UK workout and nutrition tracking app (iOS, launching August
> 2026) built by Evans Software Solutions Ltd. Subscription tiers from free to
> £29.99/mo.
>
> I'd like to explore listing a member offer on Perkbox. Two reasons I think it
> fits: your public-sector and NHS client base skews to shift workers, and the
> app works fully offline, which most tracking apps don't. It also has a coach
> and physio side — a clinician can assign a programme and see adherence — which
> is closer to a wellbeing benefit than a discount.
>
> Happy to share a demo build. Who's the right person to talk to?
>
> Brad Simms-Evans · admin@evans-software-solutions.com

### 8b. Wellbeing marketplace (Heka / Juno / Ben — adapt per platform)

> Subject: Supplier enquiry — offline-first fitness & nutrition tracking
>
> Hi {name},
>
> I've built Persistence, a UK workout and nutrition tracking app launching on
> iOS in August. I'd like to explore listing it as an option on {platform}.
>
> Why I think it's a fit for an allowance model: employees choose it themselves
> rather than it being imposed, it works offline (gyms have no signal), and there
> are consumer tiers from free to £29.99/mo so it suits most allowance sizes.
>
> There's also a clinician side — a physio can assign a rehab programme and see
> what the patient actually completed, with per-patient consent and an audit trail
> on access. Employers only ever see aggregate anonymised data.
>
> What does your supplier onboarding involve?
>
> Brad Simms-Evans · Evans Software Solutions Ltd

Send from `admin@evans-software-solutions.com`. Log everything in the tracker in
`OUTREACH_BATCH_01.md` § D with `segment = platform` or `broker`.
