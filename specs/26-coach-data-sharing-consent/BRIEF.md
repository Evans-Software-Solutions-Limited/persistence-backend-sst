# 26 — Coach Data-Sharing Consent (GO-LIVE BLOCKER)

**Status:** Brief for implementer · **Author:** Claude (Opus) · **Date:** 2026-07-20
**Depends on:** spec 25 (offboarding — the withdrawal mechanism already exists).

> **Implementer:** if strict Kiro discipline is wanted, expand this into
> requirements.md / design.md / tasks.md first. Otherwise execute directly — this
> brief is self-contained. Ground every change in the cited files before editing.

## Problem & legal basis (why this blocks launch)

Coaches can read a client's **health data** — weight, body-fat, body
measurements, workout sessions, PRs, nutrition totals, goals, habits. Under **UK
GDPR** this is **special-category data (Art 9)**, whose only realistic lawful
condition for a consumer fitness app is **explicit consent (Art 9(2)(a))** —
which must be _specific, informed, affirmative, recorded, and withdrawable as
easily as given_. Today consent is only _implicit_ in accepting a coach
relationship: no distinct consent step, no stored record, no versioning. Apple
Review Guidelines 5.1.1/5.1.3 also expect clear consent + a privacy policy for
health/fitness data. **This must ship before go-live.**

> ⚖️ NOT legal advice — the wording of the consent copy, the privacy-policy text,
> and the existing-relationship decision (§ Backfill) must be signed off by
> Brad's DPO/solicitor. This brief implements the mechanism; legal owns the words
> and the backfill call.

## Approach (Claude's recommended design, agreed by Brad 2026-07-20)

Capture **explicit, recorded consent at the point the CLIENT agrees to share**,
gate relationship activation on it, and reuse the spec-25 "Leave coach" flow as
the one-tap withdrawal. Keep an **append-only consent log** as the accountability
artifact.

### Data model

New append-only table `data_sharing_consents` (accountability record — Art 5(2)):

```
id            uuid pk default gen_random_uuid()
trainer_id    uuid not null references profiles(id) on delete cascade
client_id     uuid not null references profiles(id) on delete cascade
action        text not null check (action in ('grant','withdraw'))
consent_version text not null           -- e.g. 'v1-2026-07' — bump when copy/scope changes
source        text not null             -- 'invite_accept' | 'invite_code_redeem' | 'leave_coach' | 'coach_removed'
created_at    timestamptz not null default now()
index (client_id, trainer_id, created_at desc)
```

Plus a fast "current state" stamp on `pt_client_relationships` (migration adds
columns, both nullable): `consent_given_at timestamptz`, `consent_version text`.
Set on grant, cleared (NULL) on withdraw/termination.

> Why both: the append-only table demonstrates the full grant/withdraw history
> across re-invite cycles (spec-25 revives the same row, so a column alone would
> lose history); the column gives a cheap "is consent current" read.

### Consent capture points (both are CLIENT actions)

1. **Client accepts a coach's email invite** —
   `trainersRespondToRequestHandler.ts` (POST /clients/me/relationships/:id/respond).
   On `action:"accept"`: require `consent:true` + `consentVersion` in the body.
   Reject the accept with **400 `consent_required`** if absent. In the SAME tx
   that flips `pending→active`: stamp `consent_given_at`/`consent_version` on the
   row + insert a `data_sharing_consents` `grant` row (source `invite_accept`).
   `decline` is unchanged (no consent needed).

2. **Client redeems an invite code** — `trainersAcceptInviteCodeHandler.ts`.
   The client is the actor here (relationship goes active later when the coach
   accepts), so capture consent at REDEMPTION: require `consent:true` +
   `consentVersion`; stamp the (pending) relationship + insert a `grant` row
   (source `invite_code_redeem`). 400 `consent_required` if absent.

3. **Coach accepts a client-initiated request** —
   `trainersRespondToClientRequestHandler.ts`: NO change (the client already
   consented at redemption; the coach isn't the consenting party).

### Withdrawal (reuse spec 25 — mostly done)

- `clientLeaveCoachHandler` / `trainersRemoveClientHandler` →
  `endCoachClientRelationship.ts`: in the teardown tx, also clear
  `consent_given_at` and insert a `data_sharing_consents` `withdraw` row
  (source `leave_coach` when client-initiated, `coach_removed` when
  trainer-initiated). This makes "withdraw as easily as granted" literally true —
  the Leave-coach button IS the withdrawal.

### Guard

No change required: activation is now gated on consent, so an `active`
relationship implies a recorded consent — EXCEPT pre-existing rows (see Backfill).
Optionally add a defensive assertion in `assertTrainerCanActForClient` that an
`active` relationship has `consent_given_at IS NOT NULL`; decide with Backfill.

### ⚠️ Backfill — existing active relationships (LEGAL DECISION, flag to Brad)

Relationships already `active` at deploy have no `consent_given_at`. Two options —
**Brad/legal must choose before this ships:**

- **(A) Re-consent on next interaction (safest):** treat missing consent as
  not-consented; the client is prompted to confirm sharing next time they open
  the coach surface; coach reads are blocked until they do. Higher friction,
  cleanest legal footing.
- **(B) Backfill with notice:** set `consent_given_at = relationship start` and
  notify affected clients that coaching includes data sharing (with an easy
  opt-out = Leave coach). Lower friction, relies on prior acceptance counting as
  consent — legally weaker.
  Implement the mechanism to support whichever legal picks; default to (A) behind a
  config flag if unsure. **Do not silently grandfather without a decision.**

### Mobile

- Consent gate at the two capture screens:
  - `RequestsContainer.tsx` (accept a pending coach request).
  - `AcceptInviteContainer.tsx` / `AcceptInvitePresenter.tsx` (invite-code redeem).
- Add an **explicit affirmative** control (an unticked checkbox or a dedicated
  "Agree & connect" step — NOT pre-ticked), copy naming the data categories
  shared, with a link to the privacy policy. Client cannot accept/redeem without
  it. Pass `consent:true` + the current `consentVersion` to the port/adapter
  calls (`respondToClientRelationship`, invite-code accept).
- Transparency line (trust + data-minimisation story): state that raw Apple
  Health data (sleep, heart rate, steps) is **NOT** shared — only the coaching
  metrics above. (Verified true in the spec-25 audit.)
- Surface withdrawal: near the active-coach row, a hint that "Leave coach" stops
  all data sharing immediately (the mechanism already exists from spec 25).

### Privacy policy (content — Brad/legal own wording)

The app's privacy policy must describe coach data sharing + the categories.
Implementer: ensure the consent screen links to it; do NOT invent legal text —
leave a `PRIVACY_POLICY_URL`/section reference for Brad to fill.

## Tasks (DoD)

- [ ] **Migration + schema:** `data_sharing_consents` table + `consent_given_at`/
      `consent_version` columns on `pt_client_relationships` (idempotent). Drizzle
      schema.ts updated. DoD: typecheck + migration idempotent.
- [ ] **Consent capture (accept-invite):** body validator + `consent_required`
      400 + in-tx stamp + `grant` row in `trainersRespondToRequestHandler`. Tests:
      accept without consent → 400 no activation; with consent → active + grant row +
      stamp.
- [ ] **Consent capture (invite-code redeem):** same in
      `trainersAcceptInviteCodeHandler`. Tests mirror.
- [ ] **Withdrawal:** extend `endCoachClientRelationship` to clear the stamp +
      write a `withdraw` row (source per direction). Tests: leave/remove writes
      withdraw + clears stamp.
- [ ] **Backfill mechanism** per the chosen option (config-flagged). Tests for
      the chosen path (blocked-until-reconsent OR backfilled-with-notice).
- [ ] **Mobile consent gate** on both screens + port/adapter `consent` param.
      Presenter/container tests: can't proceed without ticking; param threaded.
- [ ] **Privacy-policy link wired** (URL/section left for Brad).
- [ ] Gates green (prettier/typecheck/lint/build/test ≥90%), local inspector-brad
      clean, note in PR. Two enum/migration items → MANUAL prod apply.

## Hand to legal

Confirm: (1) the consent copy wording + categories list; (2) the privacy-policy
text; (3) the Backfill option (A or B) for existing relationships; (4) the
`consent_version` string + when it must bump.
