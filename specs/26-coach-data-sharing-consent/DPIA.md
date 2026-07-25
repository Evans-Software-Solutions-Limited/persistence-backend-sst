# Data Protection Impact Assessment — Persistence (draft)

**Controller:** Evans Software Solutions Limited
**App:** Persistence (iOS fitness/coaching app)
**Prepared by:** Brad Evans · **Date:** _[fill in]_ · **Version:** draft 1
**Review cycle:** on any material change to processing; at minimum annually.

> ⚠️ **Draft for Brad to review and complete — not legal advice.** I've filled
> every section from the actual system so this is a review-and-sign exercise, not
> a blank page. Anywhere marked _[confirm]_ needs your decision. If in doubt on a
> risk rating, a fixed-fee privacy consultant can sanity-check this in under an hour.
> A DPIA is a living document — keep it with your records; you don't file it with
> the ICO unless they ask, or unless a high risk can't be mitigated (see step 7).

## Why a DPIA (screening)
A DPIA is required/strongly advised because Persistence processes **special-category
health data** (Art 9) **at scale on a consumer app**, including **combining** health,
nutrition and body metrics, and **sharing** them with a third party (a coach). Under
UK GDPR Art 35 and the ICO's criteria, that clears the threshold. So: yes, do one.

## Step 1 — Describe the processing

**What data:**
- Account: email; Apple Sign-In identifier.
- Health & body metrics (special category): body weight, body fat, body measurements.
- Training: workouts, sessions, sets/reps, personal records.
- Nutrition: meals, calories, macros; meal photos (for AI food logging).
- Goals, habits, progress.
- Optionally, data read from Apple Health (with the user's OS-level permission).

**How / where:**
- Stored in Supabase (Postgres, EU/UK region _[confirm region]_).
- Backend: SST v3 / AWS Lambda with explicit per-user authorisation.
- Sub-processors: Supabase (auth + DB), RevenueCat (subscriptions), Stripe (payments),
  Expo (push), AWS (AI meal-photo processing). Each processes only what it needs.

**Scope:** UK/EU consumers; solo B2C plus optional coach↔client relationships.

**Coach sharing (the sensitive flow):** when a user connects a coach, they give
**explicit, recorded, versioned consent** (spec 26) before any data is shared. The
coach can then see: body measurements (incl. weight/body fat), sessions & PRs,
nutrition totals, goals, habits. **Raw Apple Health data (sleep, heart rate, steps)
is never shared.** Consent is withdrawable one-tap by removing the coach (immediately
ends sharing). Coach reads of health data are logged (spec 27) for accountability.

## Step 2 — Necessity & proportionality
- **Lawful basis (general personal data):** Art 6(1)(b) — performance of the contract
  (providing the app the user signed up for).
- **Condition for special-category data:** Art 9(2)(a) — **explicit consent**, obtained
  specifically for coach sharing (not bundled into T&Cs).
- **Necessity:** each data category maps to a core feature the user chose; coach sharing
  only occurs on explicit opt-in.
- **Data minimisation:** raw HealthKit streams are deliberately excluded from coach
  sharing; only coaching-relevant metrics are shared.
- **Retention:** account data kept while active; on deletion, 30-day soft-delete then
  permanent erasure. Coach read-audit logs retained _[12 months — confirm]_.
- **Rights:** access/rectification in-app + on request; erasure via in-app account
  deletion; consent withdrawal via Leave-coach; right-of-access "who viewed my data"
  answerable from the `client_data_access_log`.

## Step 3 — Consultation
- Users informed via the privacy policy + the in-app consent step.
- _[confirm]_ whether to consult a privacy professional before launch (recommended once).

## Step 4 — Risks and mitigations

| # | Risk | Likelihood | Severity | Mitigation | Residual |
|---|------|-----------|----------|-----------|----------|
| 1 | Coach sees health data without valid consent | Low | High | Explicit, recorded, versioned consent gates activation; no backfill; append-only consent log (spec 26) | Low |
| 2 | Can't evidence who accessed a client's data (DSAR) | Low | Med | Append-only `client_data_access_log` on every coach read (spec 27) | Low |
| 3 | Consent hard to withdraw | Low | Med | One-tap Leave-coach ends sharing immediately + logs withdrawal | Low |
| 4 | Health data leaks between users (isolation failure) | Low | High | Every query scoped by user id / explicit ownership guard; two-user isolation tests; PT reads gated by active relationship | Low |
| 5 | Excessive/indefinite retention | Low | Med | 30-day deletion pipeline; 12-mo audit-log prune; retention documented | Low |
| 6 | Sub-processor mishandling | Low | Med | Reputable processors, data-processing terms in place _[confirm DPAs signed]_; EU/UK data residency _[confirm]_ | Low |
| 7 | Meal photos (special category by inference) sent to AI | Low | Med | Sent only on explicit user action; processed for the stated purpose; disclosed in privacy policy | Low |
| 8 | Children's data | Low | High | Age rating / _[confirm 16+ or parental-consent stance]_ | _[confirm]_ |

## Step 5 — Measures to reduce risk (summary)
Explicit consent + versioning; data minimisation (no raw HealthKit sharing); one-tap
withdrawal; read-audit logging; per-user authorisation + isolation tests; retention
limits + deletion pipeline; reputable sub-processors with DPAs; transparent privacy
policy.

## Step 6 — Sign-off
- Residual risk after mitigations: **Low** _[confirm]_.
- Approved to proceed: **[Brad Evans]**, date _[fill in]_.
- DPO: not appointed (not mandatory for an organisation of this size/nature) —
  _[confirm you're comfortable with that assessment]_.

## Step 7 — When you'd need to consult the ICO first
Only if a **high residual risk remains that you cannot mitigate**. On the analysis
above, all risks reduce to Low, so **no prior consultation is required** — you keep this
DPIA on file as your accountability evidence.

---
*Kept in-repo as the source draft; move a signed copy into your business records.*
