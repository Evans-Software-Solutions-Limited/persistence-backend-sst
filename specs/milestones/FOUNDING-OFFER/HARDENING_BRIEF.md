# FOUNDING-OFFER — hardening brief (post security review)

> **2026-09-04 product amendment:** the approved grant model in `BRIEF.md`
> replaces the build-time founding-seat variable and mandatory payment record.
> Security constraints in this brief still apply where they do not conflict.

You are continuing PR #432 (`feat: launch founding offer and referral administration`) on its
existing branch `feat/founding-offer-admin` in `Evans-Software-Solutions-Limited/persistence-backend-sst`.
Base: `origin/feat/founding-offer-admin` @ `16831151` or later — `git fetch && git reset --hard origin/feat/founding-offer-admin`
first. Do **not** open a new PR; push commits to the same branch and update the existing PR body.

Read, in order:

1. `scratchpad/founding-offer-security-review-2026-09-04.md` — the review this brief implements.
   Findings are referenced below as F1–F10. Every decision here comes from that document; if
   the two disagree, the review wins.
2. `specs/milestones/FOUNDING-OFFER/BRIEF.md` (decisions D1–D9 remain binding), `BACKEND_BRIEF.md`,
   `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`, `AGENT_BRIEF.md`.
3. Root `CLAUDE.md`, `STATE.md` (top entries dated 2026-09-03), `.claude/skills/elysia-route-change/SKILL.md`.

Decisions already made by Brad (do not re-open):

- Payments are taken **out of band** and recorded by hand. The website carries **no** bank
  details and **no** Stripe Payment Link buttons. Privately sent Payment Links are still a
  valid payment method, so `stripe_link` stays in `FOUNDING_PAYMENT_METHODS`.
- Admins record **pending grants keyed by email**. Admins never create Supabase Auth users.
  Do not add any admin "create user" or "invite user" action.
- Supabase "Confirm email" is ON in production (confirmed 2026-09-04). It is OFF in staging;
  turning it on there is Brad's dashboard task, listed in § Handback.
- Commit the review and this brief into the milestone folder as part of WP7 so the history
  travels with the repo (`specs/milestones/FOUNDING-OFFER/SECURITY_REVIEW-2026-09-04.md` and
  `HARDENING_BRIEF.md`).

Gate for every commit: `bun run typecheck && bun run lint && bun run test:unit` green at the
repo root; Prettier on touched files; web `vite build` green when web files change. Coverage on
changed files ≥ 90%, no fake tests, revert-check each new test. Before pushing the final
commit, run the local `inspector-brad` subagent on the full branch diff vs `main` and fix every
🔴/🟠/🟡. Never trigger the `@inspector-brad` CI action.

Work packages, in order. One commit per package, conventional commit messages.

---

## WP1 — Remove public payment configuration (F9)

Remove entirely (not "leave unset"):

- `packages/web/src/pages/Founding.tsx`: `FoundingPaymentLinks`, `paymentLinks()`, `PaymentLink`,
  `bankDetails`, all three `<PaymentLink>` usages, the `founding-bank` section. Keep the hook,
  the two consumer cards, the coach line, the counter, "What the money funds", the 14-day
  sentence and the terms link. Replace "How redemption works" with two short sections:
  - **How to get a place** — in person at the events Brad attends, or by emailing the
    monitored address (use the value behind `RESEND_NOTIFICATION_TO` — expose it as a plain
    string constant in the web package; it is public contact info, not a secret).
  - **How access is switched on** — "We record your payment. You sign up in the app with the
    same email address and confirm it. Access is on the first time the app loads after that.
    Places must be redeemed within 90 days of payment." Sentence case, no emojis, no hype.
- `packages/web/src/vite-env.d.ts`: `VITE_FOUNDING_BANK_DETAILS`, `VITE_FOUNDING_STRIPE_PREMIUM_URL`,
  `VITE_FOUNDING_STRIPE_PREMIUM_PLUS_URL`, `VITE_FOUNDING_STRIPE_COACH_URL`.
- `infra/web.ts`: the same four `environment` entries.
- `.github/workflows/deploy-staging.yml` and `.github/workflows/production-deploy.yml`: the same
  four `${{ vars.… }}` lines. Keep `VITE_SUPABASE_ANON_KEY` and `VITE_FOUNDING_SEATS_USED`.
- `packages/web/src/marketing/marketing.css`: `.founding-bank` and any payment-button rule that
  becomes unused (check with grep before deleting).
- `packages/web/src/pages/__tests__/Founding.test.tsx`: delete the env-driven payment-link and
  bank cases; add assertions that no `Pay for` button and no bank section render, and that the
  new sections render.

Keep `VITE_FOUNDING_SEATS_USED`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## WP2 — Refuse grants that a RevenueCat sync would undo (F2)

Problem: `FoundingGrantRepository.writeSubscriptionRow` cancels the user's live `rc_*` row; the
next `syncRevenueCatCustomer` (`revenueCatSync.ts`) calls `cancelLiveSubscriptions` and re-upserts
the `rc_` row active, silently cancelling the founding row.

Backend:

1. `SubscriptionRepository` (`repositories/subscriptionRepository.ts`): add
   `findLiveStoreSubscription(userId): Promise<{ id: string; tierName: string; expiresAt: Date | null } | null>`
   — a row in `LIVE_SUBSCRIPTION_STATUSES` whose `externalSubscriptionId` starts with `rc_`.
2. `FoundingGrantService.grant`: after resolving `profile` and before the referral checks, if a
   live store subscription exists and `req.allowSupersedeStoreSubscription !== true`, return
   `{ ok: false, error: { code: "active_store_subscription", subscription: { tierName, expiresAt } } }`.
   Add the code to `GrantError` and `allowSupersedeStoreSubscription?: boolean` to `GrantRequest`.
3. `adminFoundingGrantsHandler`: body gains `allowSupersedeStoreSubscription: t.Optional(t.Boolean())`;
   `grantErrorResponse` maps the new code to 409 with
   `{ message: "This account has a live App Store subscription. A founding grant would be undone by the next store sync. Grant after it expires, or confirm the override.", code: "active_store_subscription", subscription }`.
4. `FoundingGrantService.applyPendingForUser`: before `applyPending`, if a live store subscription
   exists for `userId`, do **not** apply; write one audit row
   `founding_grant.apply_deferred` with `after: { userId, reason: "active_store_subscription" }`
   (guard against writing it on every read: only when no `apply_deferred` row exists yet for that
   grant — add `AdminAuditRepository.exists({ action, entityId })`), log a warning, and continue.
   The grant stays pending and visible in the admin panel.
5. Document the override in the service docstring: the override is for an admin who has told the
   buyer their store subscription will be superseded and understands the sync behaviour.

Web (`packages/web/src/admin/pages/NewGrantForm.tsx`, `adminApi.ts`): when the lookup shows a
subscription and `account.subscription` came from the store (expose `externalSubscriptionId`
prefix or a boolean `fromStore` in `GET /admin/users` → `adminUsersLookupHandler`), render a
warning box with a checkbox exactly like the coach-demotion one; submit is disabled until
ticked; pass `allowSupersedeStoreSubscription`. Map the 409 body's `code` to a readable error.

Tests: service (refuses, overrides, defers pending with a single audit row), handler status
mapping, repository query, form (warning, disabled submit, flag sent). Extend
`foundingReferralTransactions.integration.test.ts` if the PGlite harness can seed an `rc_` row
cheaply; otherwise unit-level is acceptable.

## WP3 — Payment records survive account deletion (F3)

The migration `supabase/migrations/20260904120000_founding_offer_referrals.sql` has not been
applied to staging or production (verified 2026-09-04: tables absent in staging). Edit it in
place. If you find it has since been applied anywhere (`list_migrations` / `information_schema`),
stop and write a follow-up `ALTER TABLE` migration instead.

1. `founding_grants.user_id … REFERENCES profiles(id) ON DELETE SET NULL` (was CASCADE). Mirror in
   `packages/db/src/schema.ts` (`onDelete: "set null"`).
2. "Pending" must mean **not yet applied**, not **no user**. A deleted user's grant has
   `user_id NULL` and `applied_at NOT NULL`, and must never be re-applied to a new account that
   signs up with the same email. Change everywhere:
   - partial unique index `founding_grants_email_pending_uq`: `WHERE revoked_at IS NULL AND applied_at IS NULL`
     (SQL + schema.ts).
   - `FoundingGrantRepository.findPendingByEmail`: `applied_at IS NULL` instead of `user_id IS NULL`.
   - `applyPending` conditional update: add `isNull(foundingGrants.appliedAt)`.
   - `create` duplicate check: exclude rows where `user_id IS NULL AND applied_at IS NOT NULL`
     (a person who deleted their account and pays again may be granted again).
   - `statusOf`: `revoked` → `"revoked"`; `appliedAt === null` → `"pending"`;
     `userId === null` → new status `"account_deleted"`; then `expired` / `active`.
     Add `"account_deleted"` to `GrantListRow.status`, `adminApi.ts` `GrantRow.status`, and the
     status badge in `AdminGrants.tsx` (muted, non-actionable: no resend, no revoke).
   - `summary()`: `pending` counts `applied_at IS NULL`; seats still count every non-revoked row
     (a deleted user's paid seat stays used — the money was taken).
3. Add a comment on the column explaining why: sales records are kept for six years for
   accounting and dispute evidence; the row is anonymised only by the loss of `user_id`.
4. Tests: PGlite integration test — create grant for a profile, delete the profile, assert the
   grant row survives with `user_id NULL`, status `account_deleted`, seat still counted, and that
   a fresh sign-up with the same email does **not** get it applied; a new paid grant for that
   email is allowed.

## WP4 — Mandatory evidence on grants (F7)

`FoundingGrantService.grant`: when `paymentMethod` is `bank_transfer` or `stripe_link`,
`paymentReference` must be a non-empty string after trim; otherwise return
`{ code: "payment_reference_required" }` → 400 "Enter the bank or Stripe reference for this payment".
`card_in_person` and `other` stay optional. Form: mark the field required and switch the label
when those methods are selected. Tests on service, handler and form.

## WP5 — Redemption deadline in buyer-facing copy (F4)

`foundingInviteEmail.ts`: add to the no-account variant "Please sign up within 90 days of
payment — after that we may release your place." Keep the has-account variant unchanged.
`/founding` copy already carries it from WP1. Do **not** add a `redeem_by` column or an expiry
job — out of scope. Update the invite-email tests.

## WP6 — Privacy policy line (F8)

Both copies change together (web `packages/web/src/pages/Privacy.tsx` and the in-app copy —
find it with `grep -rn "Privacy" packages/mobile/src` and the legacy copy at
`../persistence-mobile` if the mobile text is still a port). Add under the data-we-hold /
retention section, sentence case:

> Founding offer purchases: if you buy a founding place, we keep a record of your email
> address, the tier bought, the amount, the payment method and reference, and the date, for six
> years after purchase to meet accounting and legal obligations. This record is kept even if you
> later delete your account; the account link itself is removed. If you paid before creating an
> account, we hold your email address until the place is redeemed or released.

Update the "last updated" date on both. If the in-app copy is not in this repo (mobile OTA
branch `codex/founding-referral-ota` may own it), leave a note in the PR body and the STATE.md
entry rather than editing another branch.

## WP7 — Docs, smoke test, ledger

- Move `scratchpad/founding-offer-security-review-2026-09-04.md` →
  `specs/milestones/FOUNDING-OFFER/SECURITY_REVIEW-2026-09-04.md` and this file →
  `specs/milestones/FOUNDING-OFFER/HARDENING_BRIEF.md` (`git mv`, fix relative links).
- `BRIEF.md` § 1 and D2, `FRONTEND_BRIEF.md` § W3, `AGENT_BRIEF.md` § A.1 and § C.4: remove the
  bank-details / public Payment Link instructions; state that payment is out of band and
  Payment Links are sent privately only.
- `SMOKE_TEST.md`: add (a) "Supabase Confirm email is ON in this environment" as the first
  precondition in both the staging and Release sections; (b) the negative redemption test —
  sign up with a pending grant's email, do not confirm, `GET /subscriptions/me` shows free,
  confirm, next read shows the tier, a second concurrent read applies nothing; (c) grant to a
  user with a live `rc_` row → 409 and the override path; (d) delete the account of a granted
  user → grant row survives with status `account_deleted`, seat still counted; (e) grant with
  `bank_transfer` and empty reference → 400; (f) production checklist items from the review § 9.
- `STATE.md`: add a 2026-09-04 session entry summarising the review outcome and the seven
  packages, with gate output.

## WP8 — Finish

1. Full gates at the repo root, pasted into the PR body.
2. Local `inspector-brad` on `git diff main...HEAD` including uncommitted changes; iterate to
   clean; note `🕵️ Inspector Brad (local): clean @ <short-sha>` in the PR body.
3. Update the PR #432 body: link the security review, list the packages, and replace the old
   ops notes (bank details, public Payment Links) with the operational flow from review § 7.
4. Ping Brad via the `slack-progress-updates` skill when the branch is green.

## Out of scope — do not start

MFA / `aal2` enforcement on admin routes (F6), an admin "attach pending grant to account"
action (F1/F5), a `redeem_by` column or expiry job (F4), Stripe-reference uniqueness index (F7,
later), a live public seat counter, Stripe webhooks, any mobile change, any Terms wording change
(Brad is taking the immediate-supply sentence to a solicitor).

## Handback — Brad's side, not the agent's

- Turn **Confirm email** ON in the staging Supabase project before running `SMOKE_TEST.md`.
- Delete the four public payment variables from the GitHub `staging` and `production`
  environments if they were ever set.
- Approve the privacy-policy wording (WP6) and decide the redemption window if not 90 days.
- Terms: immediate-supply / 14-day wording with a solicitor.
- After merge: `set-admin` on prod, redirect allow-list, first grant to your own account, then one
  fresh-mailbox pending grant end to end on a store build, before the first paying customer.
