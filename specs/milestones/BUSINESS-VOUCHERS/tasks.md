# Delivery checklist

The [brief](./BRIEF.md) is the scope contract. Unchecked items are not implemented.

## Voucher implementation

- [x] Add batch, voucher, verification-session and immutable redemption records with database constraints, private access and migration/rollback plan.
- [x] Add random-code generation and controlled distribution/export. Use hash-only server storage plus one-time issuance export and temporary account-scoped browser recovery; never use short label-derived referral codes as voucher secrets.
- [x] Add admin-authorized batch creation/list/detail, optional domain policy, optional exact-email assignment per voucher, CSV distribution and revocation.
- [x] Add persistent verification and redemption rate limits, one-time mailbox proof, expiry and retry handling.
- [x] Add customer web sign-in/signup with explicit redemption callback and compatible mobile credentials/onboarding. Keep admin and mobile callback configuration separate.
- [x] Implement same-email default and separately verified eligibility/destination identities; display the destination membership account before confirmation.
- [x] Implement transactionally coupled voucher consumption and business entitlement creation, without founding-pool accounting or referral-code semantics.
- [x] Preserve store-subscription and role protections; reject conflicts without consuming the code.
- [x] Add public `/redeem` and completion screens; membership refresh guidance and app-open fallback.
- [x] Add admin audit and batch summaries showing both emails and permanent redemption state.
- [x] Test concurrency, replay, denied email/domain combinations, empty domain lists, expiry, revocation, double submissions, different-account proof binding and account deletion.
- [ ] Verify staging email delivery and signup/redemption on the currently released mobile app; no native build.
- [ ] Deploy database/backend/web changes and exact HTTPS redirect allowlist entries after release review.

## Admin design

- [x] Restyle existing admin shell, shared components and login using current Persistence tokens and logo.
- [x] Verify desktop, narrow viewport and a non-default interactive state with clearly labelled synthetic data.
- [x] Run web formatting, TypeScript, lint, web build and unit checks; record pre-existing failures separately.

## Decisions carried into implementation

- Business invoices/payment collection remain manual for the first version.
- Membership duration starts at successful redemption.
- Empty domain policy is open; exact-email assignment is independent and optional.
- Work/eligibility email may differ from the account email; proof of both is required.
- Voucher expiry limits claiming; it does not shorten an already activated membership.
- Unused-voucher revocation and active-membership cancellation are separate operations.
- This scope adds no native redemption screen and does not change the mobile Site URL.
