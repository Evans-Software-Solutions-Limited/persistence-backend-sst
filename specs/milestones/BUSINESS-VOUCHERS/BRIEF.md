# Business membership vouchers and admin design

Status: implemented on `codex/business-vouchers-admin`, with local automated and browser verification. Not deployed; live staging email and released-app smoke checks remain release gates.

## Outcome

Brad sells a business a batch of prepaid memberships, generates one voucher per employee in the admin panel, and distributes a CSV. Employees redeem on the website and use their membership in the existing mobile app. No native app release is part of this work.

Referral codes remain attribution-only. Vouchers are a distinct resource that grants paid access and is permanently consumed on successful redemption.

## Accepted requirements

- Admin creates a batch with business name, internal order/reference, quantity, membership tier, duration in months, and optional redemption deadline. Duration starts at successful redemption.
- Generate unpredictable, unique codes. Display/export codes for distribution; retain an audit trail of who generated/exported/revoked them. Do not log plaintext codes or verification secrets.
- Optional allowed-domain list on a batch, inherited by its vouchers. Empty means any valid email domain is allowed. Match normalized domains exactly; subdomains are separate entries. Do not silently infer a domain from the business name.
- Optional exact eligible employee email per code. Empty means no individual-email restriction. If both domain and exact-email restrictions exist, both must pass; reject contradictory assignments in admin.
- Eligibility email and membership account email may differ. Same email is the default, with an explicit “Use a different membership account” choice.
- Restrictions apply to the verified eligibility email, not the destination account email. A permitted work email may activate membership on a personal Persistence account.
- The employee must prove ownership of the eligibility mailbox and authenticate the destination account before final redemption. When the two addresses match, reuse the verified identity rather than asking twice.
- Neither entering an email nor sending a verification message consumes a voucher. Invalid/expired challenges, account creation failures, subscription conflicts, and abandoned flows leave it unredeemed.
- A new destination account can be created during redemption using the normal verified Supabase identity lifecycle, consent and onboarding requirements. Do not create confirmed accounts using service-role shortcuts. Establish a login method supported by the existing app; account creation must not reset an existing account's password or merge accounts by an unverified email.
- Store the destination's immutable user ID, verified eligibility email, business/batch, voucher, grant ID and redemption timestamp. A later email change does not free the voucher or transfer membership.
- Used vouchers cannot be reclaimed, including after referral removal, account deletion, grant expiry or membership revocation. Replacement requires a newly issued voucher with an audit reference.

## Admin experience

Add a distinct “Business vouchers” area with batch creation, optional domain restrictions, per-code email assignment, CSV export, search and status filters. Show business, tier/duration, issued/redeemed/unused/expired/revoked totals. Batch detail shows masked code or suitable identifier, assigned eligibility email, redeemed eligibility email, destination membership account, redemption date and access expiry. These two emails must be labelled unambiguously.

Provide individual and batch revocation with clear behavior: revoking unused vouchers stops future redemption; cancelling already-granted access is a separate explicit action. Never imply that revoking a batch cancels subscriptions unless that operation is specifically selected and implemented. Restrictions cannot silently invalidate completed redemptions. Audit every administrative mutation.

CSV import/assignment validates duplicates, normalization and domain conflicts before applying a batch. CSV export escapes spreadsheet formula prefixes in user-controlled fields. Avoid placing personal emails in shareable redemption URLs.

## Redemption and security contract

1. `/redeem`: enter code and eligibility email; use neutral responses and shared server-side attempt limits to resist guessing and email enumeration.
2. Sign in/create and verify the destination account, then verify the eligibility mailbox using a short-lived, attempt-limited, one-time challenge. Bind proof to voucher, normalized email and redemption session; keep proof server-side or use an opaque handle. Mail scanners must not consume vouchers with a GET request.
3. Default the destination account to the eligibility email, allow a different account explicitly, and show both verified addresses for confirmation. Switching either identity invalidates any incompatible proof.
4. Authenticated final POST: revalidate proof, code status, deadline, restrictions, destination account and existing-subscription rules. In one database transaction, lock/consume the unused voucher, create the entitlement, and record redemption/audit. Concurrent requests can create only one grant; a retry from the same completed flow returns the original success.
5. Show membership tier, expiry and destination account. Offer to open Persistence; provide account-specific sign-in instructions and refresh/reopen guidance.

Use dedicated customer redemption auth state/callbacks; do not reuse the admin session store, change the mobile Site URL or weaken admin authorization. Allowlist the new HTTPS callback separately in staging and production. Cross-device verification must resume a bound redemption safely without exposing voucher secrets in analytics/referrers. No third-party tracking on verification or redemption pages.

The exact-email restriction proves who may redeem, while the destination account determines who receives access. Requiring proof of both prevents accidental or unauthorized account linking; it does not prevent an authorized employee deliberately assigning access to another account they control. That flexibility is explicitly requested.

## Existing subscription behavior

Reuse the existing server-managed entitlement behavior, but add explicit business-voucher provenance rather than labelling purchases as complimentary or consuming founding-offer pools. Preserve protection against replacing live Apple/Google subscriptions. Initially reject incompatible active subscriptions before consuming a voucher and explain how to obtain support; do not promise deferred activation until implemented. Reject duplicate live grants. Coach vouchers may promote a regular user to a coach through the existing subscription trigger; consumer vouchers cannot silently demote an existing coach. Individual admin grants retain explicit role-change confirmation.

## Persistence admin visual criteria

- Use the actual existing Persistence logo, Geist typography and current mobile tokens: background `#0A0B12`, cards `#12141D`, elevated surfaces `#1A1D29`, primary cyan `#22D3EE`, text `#F4F4F8`.
- Clear desktop navigation and a usable compact mobile layout; obvious selected section, readable account controls and keyboard focus.
- Consistent hierarchy across page titles, statistics, panels, field labels, action buttons and dense data tables. Gym-app character comes from the app's design system, not stock fitness imagery.
- Scope visual changes to admin surfaces, preserving marketing pages and operational behavior. Responsive tables scroll inside their panels rather than overflowing the page.
- Verify desktop, narrow mobile and a non-default interaction state with screenshots. Use clearly identified synthetic data for previews, with no production auth bypass or dummy operational controls shipped.

## Delivery and acceptance evidence

Database migration/schema, repository/service/routes, admin batch tools, public redemption/auth pages, transactional verification email, and focused regression/integration tests are required for the full feature. Test race/replay, proof expiry, different emails, both restrictions together, empty domains, exact domain boundaries, wrong-mailbox proofs, subscription conflicts, revocation, account deletion and CSV handling. Verify actual released-app account creation/sign-in/access refresh on staging without initiating a native build.

Deployment requires additive staging/production URL allowlist entries and verified email delivery. A frontend-only mock does not constitute voucher support. Record which deliverables are specification, implemented, tested and deployed separately.

## Expanded membership scope

Duration is selectable from 1 through 120 months, starting when access activates. Both individual complimentary grants and business vouchers support all six memberships recognised by the released app: Premium, Premium+, Start Up Coach, Start Up Coach+, Coach and Coach Pro. A voucher batch may contain one code for an individual or many codes for a business. Founding campaign grants retain their specific offers and seat pools; the broader individual-grant form is not constrained by those offers.

Individual grants attach to the recipient email and activate on sign-in/signup; there is no additional membership code to redeem. Voucher codes for every supported tier use the same website `/redeem` flow, including coach vouchers. Referral codes remain attribution-only. The admin provides a visible redemption-page link.

Studio, Studio Pro and Enterprise are website organisation-plan entries, not implemented app membership products. Their seats, multiple locations and SSO are a separate expansion; this grant change must not label consumer/coach access as those unimplemented capabilities.

## Redemption preflight

Validate code availability and email eligibility before offering membership sign-in/sign-up. Show a specific used-code error and a neutral invalid/unavailable error for unknown, revoked, expired, or ineligible codes. An employee eligibility email can redeem only one code per batch; other employees on the same domain and the same employee in future batches remain eligible. Recheck at preparation and atomic completion; anonymous checks never reserve or consume codes and do not replace mailbox proof.

## Additional issuance

Admins can issue 1–500 additional fresh one-off codes inside an existing batch, inheriting the same membership tier, duration, domain restrictions and redemption deadline. Batch totals include the new codes; employee reuse remains scoped to the original batch. Optional exact employee emails cannot duplicate assignments or previously redeemed eligibility emails within that batch. Expired batches cannot issue more codes. Plaintext codes are returned only for the new issuance; existing code secrets remain unrecoverable, with no encrypted code storage or new entitlement batch.
