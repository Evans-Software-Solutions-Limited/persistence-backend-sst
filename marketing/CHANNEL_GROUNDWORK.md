# Channel groundwork pack

**Written:** 2026-07-26 · **Owner:** Brad
**Purpose:** the three things every intermediary asks for, prepared before
someone asks — plus the PIB approach.

> ⚠ No web search available this session. Platform names in § A are from general
> knowledge and **must be verified** — check each still exists, still runs the
> model described, and has an open supplier route before spending time on it.
> Architecture facts in § C were read from the repo and are cited.

---

## A. Wellbeing marketplace target list

Ranked by likelihood of a supplier listing actually happening in 2026.

### Tier 1 — allowance marketplaces (employee chooses, no procurement cycle)

| Platform | Why it fits | Watch for |
| --- | --- | --- |
| **Heka** | Employee picks from a wellbeing marketplace using an employer allowance. Closest fit to your consumer tiers — no seat model needed. | Curated; they vet suppliers on quality |
| **Juno** | Same allowance model, flexible spend categories | Smaller UK footprint |
| **Ben / Thanks Ben** | Flexible benefits wallet | May want an integration, not just a listing |

**Why Tier 1 first:** you're chosen by an individual, not approved by a benefits
committee. That skips most of § C. It's also the only tier where a listing could
plausibly produce revenue this calendar year.

### Tier 2 — flex/benefits platforms (employer procures, you're a catalogue item)

Zest, Benefex, Darwin (Mercer's own), Reward Gateway, Vivup, **PIB's glo**.
Middle barrier, middle reward. Requirements largely transfer between them, so
answering one questionnaire properly (§ C) unlocks the set.

### Tier 3 — insurer and group-risk ecosystems

YuLife, Vitality, Aviva, Bupa wellbeing programmes. Vitality's model rewards
logged activity directly, which is the closest product fit of anyone on this
page — and the highest bar to clear. Long shot, big prize.

### Adjacent, probably not worth it

Wellhub (formerly Gympass), Hussle. These sell **gym access**, not tracking.
You'd be a complement, not a listing. Park unless someone raises it.

### Suggested first move

Two Tier 1 enquiries, nothing else, until you know what the questionnaire looks
like. Draft in `EB_CHANNEL_ANGLES.md` § 8b.

---

## B. DPIA — outline

A DPIA is legally expected here: you process **special-category health data** at
scale via new technology including automated/AI features. It's also the first
document a benefits consultant's compliance team asks for, so it does double duty.

**This is a skeleton, not a completed DPIA, and I'm not a lawyer.** Get it
reviewed before it goes to a third party.

### 1. Nature, scope, context, purposes

- **Processing:** account data, workout and session logs, body measurements,
  nutrition and food logs, sleep quick-log, goals, PRs, plus coach↔client and
  physio↔patient relationships
- **Special category (Art. 9):** health data throughout. Note `STATE.md` line 216
  records gender being classified under Health for the Apple privacy label —
  consistent treatment needed here
- **Automated processing:** exercise AI classification (`specs/15`), adaptive
  workout generation (`specs/21`), meal planning (`specs/26`). None produce legal
  or similarly significant effects, so Art. 22 is unlikely to bite — but say so
  explicitly rather than leaving it unaddressed
- **Data subjects:** consumers; coach and physio clients; B2B scheme members
- **Scale:** pre-launch, zero users at time of writing

### 2. Necessity and proportionality

- **Lawful basis (Art. 6):** contract performance for core service
- **Art. 9 condition:** **explicit consent, Art. 9(2)(a)** — the realistic route
  for a consumer app. Consent must be granular, unbundled and withdrawable
- **Coach/physio access:** separately consented per relationship — this is
  already built (`specs/28-coach-data-sharing-consent`) with an access audit
  trail (`specs/27-coach-health-data-read-audit`). Cite both; they're unusually
  strong evidence
- **Minimisation:** state what you deliberately *don't* collect
- **Retention:** ⚠ define it. Currently undefined as far as I can see, and it's a
  standard questionnaire item

### 3. Risks and mitigations

| Risk | Mitigation | Evidence |
| --- | --- | --- |
| Cross-user data leakage | Every repository method takes `userId` first; every query filters by ownership | `CLAUDE.md` § Dangerous Areas; 90% coverage gate |
| Role spoofing (PT/physio/admin) | Role read only from validated JWT, never request body | `CLAUDE.md` § RBAC |
| Over-broad clinician access | Per-patient consent + read audit | `specs/26`, `specs/27` |
| Employer sees individual health data | Aggregate-anonymised dashboard only, suppressed below minimum cohort size | `WEBSITE_PRICING_SPEC.md` § 3 |
| Third-country transfer | See sub-processors, § C | — |
| Device loss | Offline SQLite cache on device — document encryption-at-rest posture | ⚠ verify |

### 4. The B2B controller question

Worth settling before a pilot, because it decides who carries the Art. 9 burden:

- Employer is controller of **roster/seat** data (who's entitled)
- Evans Software Solutions is controller of **health** data, with the member's
  own explicit consent
- Employer never receives individual health data at all

That's a clean split and a genuinely strong sales point — but **get it confirmed
by someone qualified** before you assert it in a contract.

---

## C. Security questionnaire — reusable answer set

Answer once properly, reuse everywhere. Facts below are read from the repo;
anything marked ⚠ needs you to confirm.

### Architecture

| Question | Answer |
| --- | --- |
| Hosting | AWS, serverless (Lambda) via SST v3 |
| **Region** | **eu-west-2 (London), everything** — confirmed by Brad 2026-07-26. SES is pinned to `eu-west-2` in `infra/email.ts`, which also requires the prod Supabase project to match |
| Database | **Supabase Postgres**, reached with `postgres.js` over TCP via the Transaction-mode pooler (6543). Confirmed in `packages/db/src/client.ts`. *(Not Neon — CLAUDE.md said Neon and was stale; corrected 2026-07-26.)* |
| ORM / injection | Drizzle query builder; no raw SQL by standing rule (`CLAUDE.md`) |
| Authentication | Supabase JWT, signature-validated in middleware |
| Authorisation | Explicit per-request ownership + role checks in the backend (not DB row-level policies) |
| Mobile | Expo / React Native, offline-first SQLite cache |
| Error monitoring | Sentry, **EU region** (`.de.sentry.io`), org `evans-software-solutions-limit` |
| Payments | Apple IAP via RevenueCat. No card data ever touches your systems |
| Testing | Vitest, **90% coverage gate** on lines/functions/branches/statements — non-negotiable per `CLAUDE.md` |
| CI/CD | GitHub Actions; prod deploys release/manual-gated, staging auto |
| Secrets | SST secrets + GitHub Environments + AWS SSM SecureString |

### Sub-processors — draft list

| Processor | Purpose | Location |
| --- | --- | --- |
| AWS | Compute, storage, email (SES) | eu-west-2, London |
| Supabase | **Database + authentication** | eu-west-2, London |
| Sentry | Error monitoring | EU (Frankfurt) |
| Google Workspace | Business email (`admin@evans-software-solutions.com`) | ⚠ set the Workspace data region to EU if not already |
| **RevenueCat** | Subscription state | **US — flag as a third-country transfer** |
| Apple | App distribution, IAP | Global |
| GitHub / Expo EAS | Source control, builds | US — no production personal data |

Your residency story is strong: UK/EU for everything that holds user data.
**RevenueCat is the one US transfer** — get ahead of it, name it, and have the
transfer mechanism (IDTA/SCCs) ready rather than being asked.

### Credential position — confirmed with Brad 2026-07-26

**Held:**

- **ICO registration** (data protection fee) ✅
- **Privacy Policy + T&Cs** live on the marketing site, App-Store-wired ✅
- UK limited company, sole owner

**Not held:** Cyber Essentials, professional indemnity insurance, cyber
insurance, ISO 27001, SOC 2, NHS DSPT.

Be straight about what the ICO registration is worth: it is a **legal baseline
for any UK controller, not a differentiator.** Every organisation on your target
list has one. Cite it, don't lean on it.

### Gaps to close, cheapest first

1. **Professional indemnity + cyber insurance** — moved to the top because it is
   frequently a *contractual precondition*, not a nice-to-have. A platform will
   ask for certificates before signing. Cheap for a one-person software company;
   get quotes this month rather than mid-negotiation
2. **Cyber Essentials** — the single highest-leverage credential at your size.
   Self-assessed, a few hundred pounds, and it answers a large chunk of most
   questionnaires on its own
3. **Written retention policy** — currently undefined, and a standard ask
4. **Encryption-at-rest posture** for the on-device SQLite cache — verify and document
5. **Incident response / breach notification process** — you have Sentry; write
   down what happens after it fires. ICO breach reporting is 72 hours
6. **Accessibility (WCAG 2.1 AA)** — real for NHS/public sector. You have a
   `design:accessibility-review` skill; run it before anyone asks
7. ISO 27001, SOC 2, NHS DSPT — only if a specific deal demands it and pays for it

### What being a one-person company actually rules in and out

Worth being realistic so you aim at the right doors:

| Tier | Viable now? | Why |
| --- | --- | --- |
| **Tier 1 — allowance marketplaces** | **Yes** | Curated on product quality, not corporate scale. ICO + policies + a live app is roughly the bar |
| **Tier 2 — flex platforms incl. glo** | **Probably, with insurance + Cyber Essentials** | They'll run a questionnaire and want certificates. Achievable this year |
| **Tier 3 — insurers, Mercer/Howden scale, NHS via Vivup** | **No, not yet** | Financial-standing checks, ISO/DSPT, and references you don't have. Revisit once you have paying customers and filed accounts |

This is a good argument for the § A sequencing — Tier 1 first, and it's the tier
that could actually produce revenue in 2026.

---

## D. PIB / James Henson — approach and call prep

### The ask

Not "will you sell my app." The ask is a 20-minute conversation about what
**glo** — PIB's benefits platform, which carries "plug-and-play" voluntary
benefits — would need to see. It costs him nothing and hands you the whole
requirements list.

If it goes well, ask to be pointed at whoever owns glo supplier onboarding.
**Victoria Watts, Head of Corporate**, is quoted as owning the glo proposition
(linkedin.com/in/victoriap-watts). MD is David Skinner.

### Message to James — draft

> Subject: Intro from {colleague} — quick question about glo
>
> Hi James,
>
> {colleague} suggested I get in touch. I've built a workout and nutrition
> tracking app — Persistence, launching on iOS next month — through my company
> Evans Software Solutions.
>
> I'm not going to pitch you. What I'd value is 20 minutes on what **glo** would
> need to see before something like this could sit on the platform as a voluntary
> benefit. I'd rather find out the bar now than build towards the wrong one.
>
> The angle I think is actually relevant to your clients isn't fitness tracking —
> it's MSK. The app has a native physio role: a clinician assigns a rehab
> programme and can see what the patient actually completed between appointments,
> with per-patient consent and an audit trail on access. The employer view is
> aggregate and anonymised only, so there's no individual health data going
> anywhere near HR.
>
> Is there half an hour in the next couple of weeks?
>
> Brad Simms-Evans
> Evans Software Solutions Ltd

### Lead with MSK, not fitness

Repeating because it's the whole game: benefits consultants are paid to reduce
absence and claims cost, not to source perks. "Workout tracker" is a crowded
category he has no reason to care about. "Rehab adherence visibility" is a
number he can put in front of a client.

### Questions to ask him

1. What does a benefit need to clear to get onto glo — security, insurance,
   references, contractual?
2. Does glo carry anything in the MSK or physio space now, and what's missing
   from it?
3. How are suppliers on glo remunerated — commission, rev-share, flat listing?
4. What's the realistic timeline from first conversation to live on the platform?
5. Which client segments would actually buy this — and is the NHS/public-sector
   route different?
6. Who else should I be talking to, inside PIB or outside?

### What he'll ask you — have answers ready

- "How many clients do you have?" → **None. You launch in August.** Say it
  plainly; a benefits consultant will find out anyway and evasion costs more than
  the truth. Frame it as why you're asking about the bar now rather than pitching
- Data protection and where data sits → § C
- Pricing → seats at £4–6 TBC, and note the channel-margin problem in
  `EB_CHANNEL_ANGLES.md` § 5 before you quote anything
- "Are you FCA regulated?" → No, and you don't need to be. PIB's own footer notes
  not all their products are FCA-regulated; a wellbeing app isn't one. Don't let
  any agreement be structured as insurance mediation

### Don't

- Don't agree exclusivity, on the call or after
- Don't quote a seat price you haven't modelled the commission against
- Don't let this displace launch week — first channel revenue is realistically
  Q1 2027 (`EB_CHANNEL_ANGLES.md` § 6)
