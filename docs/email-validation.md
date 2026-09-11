# Email PR validation — 11 September 2026

## Website branding follow-up

After the logo-only update, 15 app template tests and 15 Auth artifact tests pass;
typecheck passes across all nine workspaces and changed-file formatting passes.
The shared shell remains at 100% coverage across all metrics. The 34 normal-width
browser captures verify the actual website logo loaded; all 52 captures were
refreshed. The existing full-suite and rollout limitations below are unchanged.

## Passing checks

```text
bun run prettier:check
All matched files use Prettier code style!

bun run typecheck
Tasks: 9 successful, 9 total

bun run lint
Tasks: 6 successful, 6 total
(existing warnings; zero errors)

bun run build
Tasks: 14 successful, 14 total
(mobile package delegates native builds to EAS; this is not a native build)
```

The full core run passed 366 files / 4,747 tests. Following the last added payment-validation cases, the five affected email/grant/lead/checkout suites passed **144 tests**. The Auth generator/artifact suite passed **15 tests**, including action-token preservation and generated-file drift checks.

Focused renderer coverage:

| File                   | Statements | Branches | Functions | Lines |
| ---------------------- | ---------- | -------- | --------- | ----- |
| emailShell.ts          | 100%       | 100%     | 100%      | 100%  |
| foundingInviteEmail.ts | 100%       | 97.22%   | 100%      | 100%  |

Other changed-file coverage from the full core run: Resend client 100% across all metrics; leads routes 99.07% statements/lines, 95.65% branches, 100% functions. **Whole-file branch coverage remains below the 90% target** for the large existing grant service (82.14%) and checkout handler (87.76%). Those figures were collected before the final added web-checkout plumbing case; do not claim all changed files meet 90%. No coverage exclusions or thresholds were weakened.

## Full-suite failure and diagnostic rerun

```text
bun run test:unit
Tasks: 20 successful, 21 total
Failed: @persistence/mobile#test:unit
Test Suites: 2 failed, 525 passed, 527 total
Tests: 1 failed, 6765 passed, 6766 total
```

- `CoachHomePresenter.test.tsx`: Jest worker terminated by `SIGSEGV`.
- `SubscriptionSelectionContainer.iosRail.test.tsx`: expected `ios-purchase-restore`; still rendered `ios-purchase-loading` when the wait expired.

Both files are unchanged by this PR. A serial diagnostic rerun of those two files passed **13/13 tests**, with Jest warning about open asynchronous handles. This is a **flaky full-run result**, not a clean replacement for the failed gate. It remains reported in the draft PR; no unrelated mobile behavior or timeouts were changed.

Web: 46 files / 1,173 tests passed. Scripts: 4 files / 131 tests passed in the full run. Core aggregate coverage was 97.13% statements/lines, 92.64% branches and 96.69% functions.

## Visual and delivery status

[52 browser screenshots](email-screenshots/README.md) cover every preview at 600px, 320px and a blocked-images simulation, plus the founding footer. All 51 DOM width checks reported no horizontal overflow. GIF generator verified 29,301 bytes, 14 frames, 1,700ms, one playback and matching first/last resting frames.

Inspector Brad's local full-diff review returned `INSPECTOR_VERDICT: CLEAN`; it also inspected the narrow purchase/footer and verification-code screenshots. Real-client delivery, hosted Auth MIME, legal copy and provider alignment are still the [rollout blockers](transactional-emails.md). No production deployment or test messages were sent.
