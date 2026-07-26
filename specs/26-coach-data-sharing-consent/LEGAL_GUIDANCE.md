# Legal guidance — Coach data-sharing consent (26) & read-audit (27)

**For:** Brad (solo engineer / sole data controller)
**Date:** 2026-07-20
**Covers:** the open legal/DPO decisions flagged in `specs/26.../BRIEF.md` and
`specs/27.../BRIEF.md`.

> ⚠️ **I am not a lawyer and this is not legal advice.** This is practical
> orientation to help a solo founder get to a defensible position cheaply, and to
> turn the briefs' open questions into concrete choices. Before you submit to the
> App Store, get the two things below signed off by someone qualified (a solicitor
> or a fixed-fee privacy consultant — you do **not** need a full-time DPO):
> 1. the **privacy-policy wording** (see § 4), and
> 2. that **explicit consent** is your chosen Art 9 lawful basis and the copy is adequate (§ 2).
> Everything here is written so that review is a 1-hour sanity check, not a rebuild.

---

## 1. The one thing to internalise

Your app stores **special-category data** under UK GDPR (Art 9): health and body
metrics (weight, body fat, measurements), and arguably the whole coaching health
picture. Special-category data has a higher bar than ordinary personal data. For a
consumer fitness app sharing that data with a human coach, the only realistic
lawful basis is **explicit consent** (Art 9(2)(a)). Explicit consent must be:

- **Specific** — to *this* processing (sharing with your coach), not bundled into T&Cs.
- **Informed** — the user is told *what* is shared and *with whom*.
- **Affirmative** — a deliberate opt-in action (a ticked box the user ticks, not a pre-ticked one).
- **Recorded** — you can later prove they consented, and to which version of the terms.
- **Withdrawable** — as easily as it was given.

Spec 26 implements exactly this mechanism. Spec 27 implements the **accountability**
side (Art 5(2) / Art 32): being able to show *who read* a client's health data,
which is also what lets you answer a "right of access" request.

You are, as a solo trader, still a **data controller**. Two housekeeping items that
sit outside the code and only you can do — see § 6.

---

## 2. Brief 26 decisions — my recommendations

### Decision 1 — Backfill of existing active relationships → **RESOLVED (no action)**
You confirmed there is **no production data**. So there are no already-active
coach↔client relationships to migrate. The implementation takes the clean path:
consent is required going forward at the two capture points, and every relationship
that reaches `active` will carry a recorded consent. **No backfill flag, no
grandfathering, no re-consent prompt is being built.** If that ever changes (you
somehow onboard coaches before this ships), tell me and we add the re-consent path
— but as of today this decision is closed.

### Decision 2 — Consent copy + data categories → **draft below; you/legal own final wording**
The mechanism is wired with the draft copy below. It is deliberately plain-English
and names the categories. Get it eyeballed, tweak the words, and it drops straight
in (it's a small set of string constants + the privacy page).

**Categories a coach can see (this is the factual list — keep it accurate):**
- Body measurements — including body weight and body fat
- Workout sessions and personal records (PRs)
- Nutrition totals (calories / macros)
- Goals and habits

**NOT shared (say this — it's your data-minimisation / trust story, and it's true
per the spec-25 audit):** raw Apple Health data — sleep, heart rate, steps.

**Draft consent copy (as wired):**
> **Share your data with your coach**
> To coach you, your coach will be able to see the fitness and health data you
> record in Persistence: your body measurements (like weight and body fat), your
> workout sessions and personal records, your nutrition totals, and your goals and
> habits.
> Your raw Apple Health data — sleep, heart rate, steps — is never shared. Only the
> coaching metrics above.
> You can stop sharing at any time by leaving your coach, which immediately ends
> all data sharing.
> ☐ I agree to share the data above with my coach.
> [Read our Privacy Policy]

**Why this is defensible:** it's specific (names the categories + the recipient),
informed (says what's shared and what isn't), affirmative (unticked box, button
disabled until ticked), and it points at the withdrawal path.

### Decision 3 — `consent_version` string + when to bump → **use `v1-2026-07`; bump rules below**
Set to `v1-2026-07`. The point of versioning is: if you later change *what* is
shared or *materially* change the wording, you can tell who agreed to which terms
and re-prompt only the people on the old version.

**Bump the version (and re-prompt existing consenters) when:**
- You **add a new data category** a coach can see (e.g. you later share sleep/HR).
- You **change the recipient** (e.g. coaches can now share onward with a third party).
- You **materially change the meaning** of the consent (not typo fixes).

**Do NOT bump for:** typo/formatting fixes, or unrelated privacy-policy edits.
Format is `vN-YYYY-MM` so it's human-readable in the audit log. It's one constant
(`CONSENT_VERSION`) defined in the backend with a mirrored mobile copy.

---

## 3. Brief 27 decisions — my recommendations

### Decision 1 — Data categories to log → **the 9 in the brief; confirm the list**
The read-audit logs a category per coach read: `measurements`, `body_trend`,
`sessions`, `goals`, `habits`, `nutrition`, `client_detail_aggregate`,
`ai_summary`, `active_programme`. That's the current surface of coach reads. No
change recommended unless you add new coach read surfaces later (then add a
category).

### Decision 2 — Retention period + de-dupe window → **12 months retention, 15-min de-dupe (defaults, tune to taste)**
- **Retention: 12 months.** Long enough to answer a "who saw my data over the last
  year" access request; short enough that you're not hoarding an ever-growing
  access log. GDPR says keep it no longer than necessary — 12 months is a sensible,
  common default for access logs. If your solicitor prefers 6 or 24, it's a one-line
  change. Pruned via the same retention pattern the repo already uses.
- **De-dupe window: 15 minutes.** The Client Detail screen loads the aggregate on
  nearly every coach screen-open, so logging every read would balloon the table.
  De-duping collapses repeated reads of the same (coach, client, category) within
  15 minutes into one row — you still capture "coach X looked at client Y's data
  around time T", which is what an access request needs, without one row per scroll.
  Tunable via a single constant.

### Decision 3 — Client-facing "who's viewed my data" screen → **fast-follow, NOT a launch blocker**
For launch, the **ops query** documented in the brief is enough to satisfy a
right-of-access request (you run one SQL query and hand the client the answer).
Right-of-access requests must be answerable within a month; a manual query easily
meets that at your current scale. Build a client-facing screen later if volume
justifies it. **Recommendation: park it as a fast-follow slice; do not gate launch on it.**

---

## 4. Privacy-policy additions (concrete text to add)

Your current policy (`packages/web/src/pages/Privacy.tsx`) mentions coach sharing
only in passing ("sharing it with a coach or trainer you have explicitly connected
with"). For explicit-consent-based special-category sharing you should say more.
**Suggested new section** (drop after "How we use your information"; get it
sign-off then paste in — I can wire it whenever you say):

> ### Sharing data with your coach
> If you connect with a coach or trainer inside the app, you will be asked to give
> explicit consent before any of your data is shared. With your consent, your coach
> can see: your body measurements (including weight and body fat), your workout
> sessions and personal records, your nutrition totals, and your goals and habits.
> Your raw Apple Health data (such as sleep, heart rate, and steps) is never shared
> with your coach.
> You can withdraw this consent at any time by removing your coach in the app,
> which immediately stops all further sharing. We keep a record of when you gave and
> withdrew consent, and a record of when a coach accessed your data, so we can answer
> any request you make about who has seen your information.

This also quietly documents the read-audit (spec 27), which is good practice.

The **"Read our Privacy Policy" link** in the consent screen points at
`https://persistence.evans-software-solutions.com/privacy` (your live privacy page).
That's already wired.

---

## 5. What "good enough to submit" looks like (checklist)

- [ ] Consent copy (§ 2) + privacy-policy section (§ 4) read and OK'd by a
      qualified person (1-hour fixed-fee review is fine).
- [ ] Explicit consent confirmed as the Art 9 basis (it's the obvious one).
- [ ] Privacy policy live at the linked URL (it is) and listed in App Store Connect
      metadata (already done per BRIEF-6 audit).
- [ ] ICO registration done (see § 6) — independent of the code.
- [ ] (Recommended, not strictly blocking) a lightweight DPIA on file (see § 6).

Apple Review (Guidelines 5.1.1 / 5.1.3) wants: a clear consent step for health data
+ a reachable privacy policy. Both are satisfied by 26 + the existing privacy page.

## 6. The two things only you can do (outside the code)

1. **Register with the ICO as a data controller.** In the UK, if you process
   personal data with automated equipment you must pay the ICO data-protection fee
   (tier 1 is currently ~£40–60/year for a small organisation) unless you're exempt
   — a health-data app is not exempt. This is a 10-minute online form. Do it before
   launch. (General info — confirm your tier/fee on ico.org.uk.)
2. **Keep a short DPIA (Data Protection Impact Assessment).** Because you process
   special-category health data, a DPIA is best practice and often expected. It
   doesn't need to be long: what you process, why, the risks, and the mitigations
   (explicit consent, no raw-HealthKit sharing, read-audit, retention limits,
   deletion flow). The ICO publishes a free DPIA template. Having one on file is
   your evidence of "accountability" if anyone ever asks. Not a hard App Store
   blocker, but cheap insurance — an afternoon's work.

Neither of these is something I can do for you (they're registrations/attestations
in your name), and neither blocks the *code* shipping — but item 1 should be done
before you're live to real users.

---

## 7. Hand to your reviewer (the short version)

> "Fitness app. Users log health/body data. Optionally they connect a human coach
> who can then see a defined subset (weight, body fat, measurements, sessions, PRs,
> nutrition totals, goals, habits — NOT raw Apple Health). We take explicit,
> recorded, versioned opt-in consent before any sharing, withdrawable one-tap by
> removing the coach. We log coach reads for accountability, retained 12 months.
> Please sanity-check (a) the consent copy in § 2, (b) the privacy-policy section in
> § 4, and (c) that explicit consent is the right Art 9 basis and adequately obtained."

That's the whole ask. It should be a quick, cheap review.
