# Agent Brief — Enforce `trainer_client_limit` (revenue-leak fix)

**Written:** 2026-07-10 · **Updated:** 2026-07-11 (Brad's three v1 decisions
locked: block over-invite at send time, trainer notification IN, trainer-side
no-seats UI warning IN) · **Scope:** backend + mobile — suggest 2 PRs
(backend gate + migration first, mobile UI/notification second) · **Size:** medium
**Standalone** — not part of the GTM-EXPANSION milestones; can run any time.
Found during GTM planning grounding (see `GTM-EXPANSION/BRIEF.md` §1).

## Problem

The subscription catalog advertises per-tier client caps
(`subscription_tiers.trainer_client_limit`: individual_trainer **2**,
small_business **30**, medium_enterprise **500**) but NOTHING enforces them at
the application layer:

- `microservices/core/src/application/entitlement/assertEntitlement.ts` —
  the `trainer_clients` feature is a **stub returning `{allowed:true}`**
  (~line 237 as of main @ `4bda7d1`; re-verify).
- `trainersAcceptInviteCodeHandler.ts` (code accept) and the email-invitation
  accept path create `pt_client_relationships` rows without ever counting
  active relationships against the cap.
- SQL helpers exist from `supabase/migrations/004_subscriptions_and_roles.sql`
  (`check_professional_slots(p_user_id, p_role_type)` at ~line 489 does the
  `trainer_client_limit` slot check; a `check_trainer_slot_limit()` trigger
  sits at ~line 765) but nothing calls them from TS — and the repo rule is
  Drizzle, not raw SQL, so implement in TS rather than wiring the SQL
  functions.

Net effect: a trainer on the cheapest trainer tier (£14.99) can build an
unlimited roster — the entire price ladder between trainer tiers is
unenforced. This matters MORE once B2B seats exist (M21 prices orgs on
capacity).

## Recon first (do not skip)

1. Enumerate EVERY path that creates or re-activates a
   `pt_client_relationships` row (code accept, email-invite accept, any
   admin/coach-initiated path, any re-accept of a previously ended
   relationship). The cap must hold at all of them.
2. Read the dual-authority memory (`project_trainer_eligibility_dual_authority`):
   "is-a-trainer" = tier (client-side) vs `profiles.role` (backend), synced by
   the `update_subscription_limits` trigger — decide the expired-sub semantics
   consistently with the PR #130 coach-mode-403 handling.
3. Confirm what transaction primitives the accept handlers already use
   (they have an in-tx TOCTOU rowcount pattern) and what
   `assertEntitlement`'s conventions are for cancelled/expired
   (reverts-to-free-rules, not hard-block).

## Design

**1. Implement the `trainer_clients` entitlement check** in
`assertEntitlement.ts` (replacing the stub): resolve the trainer's effective
tier via the existing resolution (including the cancelled/expired → free-rules
convention), take `trainer_client_limit` (NULL = unlimited), count ACTIVE
`pt_client_relationships` for the trainer, and deny with
`reason: "limit"` + `upgradeTo` = next tier up
(individual_trainer → small_business → medium_enterprise; medium_enterprise
at cap → no upgrade target, plain limit denial). Free/non-trainer tier →
`reason: "tier"`, `upgradeTo: individual_trainer`. Follow the existing
verdict shape exactly (`currentTier`, `upgradePriceMonthly`, …).

**2. Enforce at relationship-creation time, concurrency-safe.** The
entitlement pre-check alone is racy (two clients accepting concurrently at
cap−1 both pass the read). Inside the accept transaction: take a per-trainer
mutex (e.g. `SELECT id FROM profiles WHERE id = $trainerId FOR UPDATE` via
the Drizzle builder — short-lived, single-row; respects the "no long-lived
transactions" Neon rule), THEN count, THEN insert. Mirror the handler's
existing atomic-accept structure; do not restructure the handler beyond the
insertion of the gate.

**3. Enforce at INVITE CREATION too (Brad decision 2026-07-11: a trainer
must not be able to invite more people than they have seats available).**
Gate `trainersInviteCodeCreateHandler` and the email-invitation SEND path on
the same `trainer_clients` entitlement check BEFORE creating the
invite/code. Semantics: available seats = `trainer_client_limit` minus
ACTIVE relationships minus OUTSTANDING invitations (pending email invites +
an unexpired active code's remaining capacity — recon how invite codes model
multi-use before deciding how they count; if a code is multi-accept, the
accept-time gate from §2 remains the hard backstop). At-cap invite attempts
return the standard **402 EntitlementError with the upgrade verdict** — here
the failing actor IS the trainer, so the upsell is correct.

**4. Error surface on ACCEPT — mind WHO sees it.** On the accept paths the
failing actor is the **client**, not the trainer. Do NOT return the standard
402 entitlement upsell (it would upsell the wrong user). Return an explicit
conflict-style error (409 or 422, match the handler's existing error
vocabulary, e.g. `{ error: "coach_client_limit_reached" }`) with copy-safe
semantics: "this coach's client list is full". This path stays reachable
despite §3 (races, pre-existing outstanding invites, downgrades after invites
were sent) — it is the hard backstop, not dead code.

**5. Trainer notification (Brad decision 2026-07-11: IN for v1).** When an
accept is rejected at cap, best-effort post-commit (never-throw) notification
to the TRAINER via the existing `NotificationDispatcher.createAndDispatch`:
a join failed due to their plan limit, with the upgrade pointer. Requires an
idempotent `notification_type` ADD VALUE migration (pattern:
`20260709120000_...`; ⚠ prod apply manual, staging auto-applies on merge) +
the mobile notification-type registration set (union/labels/CATEGORIES/
notificationVisual — follow the `coach_brief` example end-to-end).

**6. Trainer-side UI warning (Brad decision 2026-07-11: IN for v1).** On the
coach client-management surfaces (Clients list and/or the invite affordance —
recon where invites are initiated on mobile), when the trainer is at cap show
a clear warning state: **"No client seats available — remove a client or
change your subscription"**, with the invite action disabled and the two
paths surfaced (manage clients / upgrade via the existing `useFeatureGate` →
subscription-selection routing). Implement `trainer_clients` in the mobile
`useFeatureGate` feature table (mirroring the backend rule: active-client
count vs `trainerClientLimit` from the cached tier catalog) so the gate is
consistent with every other gated feature rather than bespoke. Show a
"N of M client slots used" line on the same surface — it's now required
context for the warning, not optional polish.

## Tests (90% coverage floor; no fake tests)

- Verdict matrix: under-cap allow / at-cap deny / NULL-limit unlimited /
  free-tier deny / cancelled-expired reverts to free rules / medium_enterprise
  at 500.
- Both accept paths: at-cap → the chosen 4xx + NO relationship row + invite
  code NOT consumed (verify rollback covers the code-consumption update).
- Concurrency: two simultaneous accepts at cap−1 admit exactly one (drive via
  the transaction seam like the existing TOCTOU tests).
- Re-accept of an ENDED relationship counts against the cap as a new active
  row; already-active duplicate accept keeps its existing 409 behaviour.
- Invite-creation gate: at-cap code create / email invite send → 402 with
  upgrade verdict + NO invite row; outstanding invites count against
  available seats per the §3 semantics; under-cap unaffected.
- PgDialect render-guard tests on the count queries (mocked-getDb blind spot —
  per `reference_drizzle_groupby_param_bug` memory).
- Trainer notification: fires post-commit on a cap-rejected accept, never
  fails the response; mobile registration renders it (type/label/visual).
- Mobile: at-cap trainer sees the no-seats warning + disabled invite action +
  "N of M slots used"; under-cap trainer sees normal invite affordance;
  `useFeatureGate('trainer_clients')` verdict matrix mirrors the backend
  (incl. NULL = unlimited and cancelled→free-rules).

## Gates + PR

`bun run prettier:check` (repo-level) · `typecheck` · `lint` · `build` ·
`test:unit` ≥90% on changed files. Inspector Brad LOCAL sweep before the PR
(fix or justify every 🔴/🟠/🟡; note `🕵️ Inspector Brad (local): clean @ <sha>`
in the PR body). Do NOT fire the `@inspector-brad` CI action. Conventional
commit: `fix(trainers): enforce trainer_client_limit on client join`.
This touches user-data relationship creation — treat as a data-isolation
dangerous area (two-trainer isolation assertions in tests).
