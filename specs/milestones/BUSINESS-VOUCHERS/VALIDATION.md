# Validation evidence

Local review on 14 September 2026; no deployment or native build.

- Web: 64 test files, 1,326 tests pass, including customer authentication/redemption, different-email proof, signup consent, callback credential stripping, analytics isolation, CSV handling, and multi-batch receipt recovery across navigation/sign-out.
- Database: real PGlite integration tests cover concurrent consumption, request replay, audit rollback, expiry, restrictions, assignment imports, paid-subscription conflicts, RevenueCat no-entitlement sync, account deletion and bounded cleanup. All new/changed voucher runtime files exceed 90% coverage in each metric.
- Root TypeScript: all 9 packages pass. Root lint: all 6 packages pass; existing warnings remain in mobile and generated coverage files. Changed-file Prettier and git whitespace checks pass. Production web build passes.
- Local Inspector Brad full-diff review: clean after fixing unsaved issuance recovery (including overlapping in-flight batches and per-batch download acknowledgment) and temporary-record cleanup. Independent targeted reruns passed 46 backend and 27 receipt-recovery cases.
- Browser review used clearly labelled local synthetic fixtures: dashboard, grants/new grant, vouchers/new batch/detail, referral codes, marketing/new plan/detail, lookup/result, audit, login/callback and branded action dialog. Reviewed employee sign-in, different-email OTP, final destination confirmation and completion. Desktop and 390px layouts inspected; mobile document width remained 390px with no horizontal overflow. Temporary fixture source was removed.

The full final core-suite result is recorded in the PR. Live email delivery, Supabase allowlist changes and physical released-app verification are outstanding staging release checks, not inferred from mocks. Follow RELEASE.md before rollout.
