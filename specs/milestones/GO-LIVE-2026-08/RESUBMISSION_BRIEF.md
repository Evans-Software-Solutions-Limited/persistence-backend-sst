# RESUBMISSION BRIEF — clearing the two App Store rejections

**Written 2026-08-04.** Scope: get build 1.0 back in front of App Review and approved.
**Not** the paid launch — that is [`PLAN.md`](./PLAN.md) Stages 1–4.

⚠ **Read [`STATE.md`](../../../STATE.md) § "▶ START HERE" first.**

---

## The distinction this brief exists to protect

**Resubmission ≠ launch.** Two rejections are fixed and merged. Nothing about pricing,
tiers, Mealprint or the OFF re-seed is needed to clear them, because `premium_plus`
ships `is_active = false` and a reviewer cannot reach any of it.

Conflating the two is how this slips a fortnight. Ship the approval first.

---

## Ground truth (verified 2026-08-04, `main` = `b4a8ba3e`)

| Fact                                                                           | Evidence                            |
| ------------------------------------------------------------------------------ | ----------------------------------- |
| Rejection **2.1** (PassKit / Stripe in the app) — FIXED, merged                | PR #336                             |
| Rejection **4.0** (app-drawn Apple logo on Sign in with Apple) — FIXED, merged | PR #340, `bb99f26b`                 |
| Latest release tag `persistence-v1.11.0`; **`main` is 13 commits ahead**       | `git log persistence-v1.11.0..main` |
| **5 migrations unapplied to prod**                                             | see Task 1                          |
| Mealprint mobile merged, **entitled path has never executed on a device**      | `fa0567fc`, PR #352                 |
| No agent has touched prod or staging data                                      | —                                   |

---

## TASK 0 — Verify the ASC product state. Do this before anything else.

**Nobody has confirmed this, and it decides whether Task 2 is enough.** No agent can
read App Store Connect; this is Brad's, or an agent he pairs with.

Answer three questions and write the answers into `STATE.md`:

1. **Which IAP products exist, and in what state?** (Missing Metadata / Ready to Submit /
   Waiting for Review / Approved / Rejected.)
2. **Is any product attached to the build you intend to resubmit?**
3. **Are the `premium_plus` products still UNSUBMITTED?** They must stay that way — see
   Hazards.

⚠ **Why it matters:** the app renders a subscription paywall. If it is submitted with a
paywall and no reviewable IAP product, that is its own 3.1.1 problem — and conversely,
submitting a product for a tier a reviewer cannot reach (`is_active = false`) is the
rejection the "leave them unsubmitted" rule exists to prevent. **Both failure modes are
live right now and only ASC can tell you which one you are in.**

---

## TASK 1 — Release and deploy to production. This is the step people skip.

**A resubmitted BUILD does not fix a PRODUCTION backend.** This has already bitten: an
Apple reviewer tripped a production Sentry error on 2026-07-30 22:26 UTC while prod was
running an unpatched backend, on an iPad Air 11-inch (M3).

`main` is **13 commits** ahead of `persistence-v1.11.0`, including the whole async-job
spine, the Mealprint backend, and the revised privacy policy. Five migrations are
unapplied:

```
supabase/migrations/20260802120000_ai_jobs.sql
supabase/migrations/20260803120000_foods_mealprint_tags.sql
supabase/migrations/20260803120100_nutrition_preferences.sql
supabase/migrations/20260803120200_mealprint_access.sql
supabase/migrations/20260803180000_client_data_access_log_created_at_idx.sql
```

1. Cut a release PR (`persistence-v1.12.0`) off `main`.
2. **Apply the five migrations to prod MANUALLY** — prod deploys are Brad's, and
   migration application in this repo has always been manual. Prod ref is
   `opcvjypsoivaxerahbal`. Staging is `nxkhlrvjxotyjulodxzk`.
3. Deploy, then confirm the API answers and no new Sentry issues appear.

⚠ **Do NOT flip `is_active` on any tier in this release.** That is PLAN Stage 4.

---

## TASK 2 — A new mobile build. Both fixes are compiled artifacts.

Neither rejection can be cleared by the current binary:

- **PassKit** — the `in-app-payments` entitlement was **compiled into build 38**.
  Removing the dependency only takes effect in a fresh build.
- **Sign in with Apple** — `AppleSignInButton` wraps `expo-apple-authentication`'s
  native `AppleAuthenticationButton`. It cannot render under Jest, so **no test proves
  how it looks.** It must be seen.

Verify on the build, ideally on **iPad** (the review device was an iPad Air 11-inch M3):

- [ ] The SIWA button is Apple's own control — light and dark. **Not re-skinned**: no
      image, icon font or glyph; no `backgroundColor`/`borderRadius` via `style`; no
      overlay. The loading state dims and blocks rather than swapping in a
      "Connecting…" label — obscuring the button is itself a Guideline 4 failure.
- [ ] **No Apple Pay / PassKit sheet is reachable anywhere.** Grep the built app for the
      entitlement if in doubt.
- [ ] The named **"Delete account"** row is present in the profile drawer, and survives a
      failed profile fetch (that was the 5.1.1(v) fix).
- [ ] The profile drawer **scrolls** on a small device.

---

## TASK 3 — Review Notes and the screen recording (Brad's)

The 5.1.1(v) response needs a **physical-device recording** of the account-deletion flow
end to end. Simulator capture is not what was asked for.

Review Notes should state, plainly: Apple Pay / PassKit removed in full; account
deletion reachable from the profile drawer and demonstrated in the attached recording;
test-account credentials.

---

## TASK 4 — Explicitly NOT resubmission-blocking

State this back to Brad if anyone proposes pulling it forward:

| Work                                | Why it can wait                                                   |
| ----------------------------------- | ----------------------------------------------------------------- |
| Mealprint entitled-path device test | `premium_plus` is `is_active = false`; a reviewer cannot reach it |
| spec-29 tiers / £16.99 / £18.99     | No ASC product changes in this submission                         |
| The OFF re-seed                     | Only affects Mealprint results, which are unreachable             |
| Loadout Phase 4                     | PLAN Stage 1                                                      |
| Organisations / B2B rail            | PLAN Stage 5, blocked on an App Review answer                     |

They are all real, and they are all **launch** blockers. `PLAN.md` orders them.

---

## Hazards — every one of these has already cost something

- ⚠ **Do NOT submit the `premium_plus` ASC products with this build.** The tier is
  `is_active = false`, so a reviewer cannot reach it, and an unreachable IAP product is
  its own rejection. Create, leave unsubmitted, attach at the launch build.
- ⚠ **Never `git add -A <dir>`.** On 2026-08-04 that published nine of Brad's private
  commercial drafts — a cash plan with real burn figures among them — to this **PUBLIC**
  repo. Untracked in PR #355; the history is not scrubbed. **Stage named paths only.**
- ⚠ **`specs/stripe-rail-removal/` must NOT be executed.** That rail is the
  organisation-tier plan.
- ⚠ **Never rename a `tier_name`.** RevenueCat entitlement ids _are_ the tier_names and
  `user_subscriptions.tier_name` is an FK.
- ⚠ **Do not fire the `@inspector-brad` CI action.** Brad triggers it. Run the
  `inspector-brad` subagent locally before any PR.
- ⚠ **`eu.anthropic.claude-opus-5` is UNGRANTED in production.** Assuming otherwise
  caused a 30-day silent outage. Check Bedrock model access before changing any model id.
- ⚠ **Use a workspace's own test command** (`bun run test:unit`), never `bunx vitest` —
  there is no root `vitest`, so `bunx` resolves the latest from the registry against a
  repo pinned to 2.1.9 and invents failures.
- ⚠ **`bun run prettier:check` fails at repo root** on untracked files outside your diff.
  Scope it: `bunx prettier --check $(git diff --name-only HEAD)`.
- ⚠ **The staging entitlement trigger demotes a coach or admin to `role = 'user'`.** Use
  a second test account if you touch `user_subscriptions`.

---

## Gates before any PR

```bash
bun run typecheck && bun run lint && bun run build && bun run test:unit
```

Mobile coverage threshold is 90 %. No fake tests — **and when you add a test for a fix,
revert the fix and watch it fail.** Three tests on the Mealprint branch passed against
their own reverted fix before being caught; reading a test is not evidence.

## Done when

An App Review decision on a build whose two rejection causes are demonstrably absent,
running against a production backend at `persistence-v1.12.0` or later.
