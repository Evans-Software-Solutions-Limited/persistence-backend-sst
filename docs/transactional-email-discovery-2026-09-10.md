# Transactional email discovery — approved inventory

Inventory, internal-email scope and activation-based wording approved by Brad on 11 September 2026. Original discovery follows; implementation/rollout status is in [transactional-emails.md](transactional-emails.md).

Inspected 10 September 2026, source revision `10aa973b`, branch `fix/workout-cap-entitlements`. No styling, application behavior, hosted settings or DNS changed. Existing unrelated working-tree changes preserved.

## Inventory

App paths below are relative to `microservices/core/src/application/`.

| Email                                                                                     | Trigger                                                                                   | System                                      | Template path/location                                                        | Available variables                                                                         |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Founding purchase confirmation / grant invite (one existing email)                        | Paid Stripe checkout → `FoundingGrantService.grant`; admin grant and resend also use this | Resend REST API                             | `founding/foundingInviteEmail.ts`, `buildFoundingInviteEmail`                 | `tierName`, `grantKind`, `months`, nullable `expiresAt`, `hasAccount`, `email`, `webOrigin` |
| Complimentary access confirmation — additional variant                                    | Admin complimentary grant / resend                                                        | Resend                                      | Same builder                                                                  | Same inputs; `grantKind=complimentary`                                                      |
| Founding checkout needs review — additional internal email                                | Paid checkout cannot grant access                                                         | Resend                                      | Inline in `stripe/eventHandlers/checkoutSessionCompleted.ts`, `flagForReview` | Buyer email, failure reason, Stripe session ID                                              |
| New coach enquiry — additional internal email                                             | Successful coach lead submission                                                          | Resend                                      | Inline in `leads/leadsRoutes.ts`                                              | Email, name, client count, current tool, message                                            |
| Signup confirmation                                                                       | Email/password signup                                                                     | Supabase Auth; SES SMTP provisioned in repo | Hosted Auth → Emails → Confirm sign up; no local override                     | Auth variables below                                                                        |
| Magic link / OTP                                                                          | Supabase passwordless sign-in; no app caller found in inspected source                    | Supabase Auth                               | Hosted Magic link                                                             | Auth variables below                                                                        |
| Password reset                                                                            | Mobile `resetPasswordForEmail`                                                            | Supabase Auth                               | Hosted Reset password                                                         | Auth variables below                                                                        |
| Email change confirmation                                                                 | Supabase email-change operation; no app caller found in inspected source                  | Supabase Auth                               | Hosted Change email address                                                   | Auth variables plus `NewEmail`                                                              |
| Supabase user invitation — distinct from grant invite                                     | Supabase admin invitation; no app caller found                                            | Supabase Auth                               | Hosted Invite user                                                            | Auth variables below                                                                        |
| Reauthentication and security notifications — availability flagged, active use unverified | Reauthentication; account/security changes if enabled                                     | Supabase Auth                               | Hosted Reauthentication and security notification templates                   | Reauthentication token; notification-specific fields                                        |

Auth variables documented by Supabase include `ConfirmationURL`, `Token`, `SiteURL`, `Email`, plus `TokenHash`, `RedirectTo`, `Data`; `NewEmail` is email-change-specific. Security notifications include password/email/phone changes, identity linking/unlinking and MFA enrolment/removal. These are platform capabilities, **not evidence they are enabled here**. Keep implementation within the brief's simple inline template constraints. [Supabase template documentation](https://supabase.com/docs/guides/auth/auth-email-templates).

Production project: `opcvjypsoivaxerahbal`; staging: `nxkhlrvjxotyjulodxzk`. Hosted template bodies, enabled notifications, SMTP settings, expiry and MIME plain-text behavior remain unverified: the dashboard redirects to sign-in, and the available Supabase connector has no Auth-configuration read operation. Local `supabase/config.toml` has no active template overrides, confirmations disabled and `otp_expiry=3600`; these are **local settings only**.

## Rendering and data findings

`leads/resendClient.ts` uses native `fetch` to `POST https://api.resend.com/emails`. Its interface sends subject and plain text only: there is no HTML engine or shared HTML shell. From is `Persistence <no-reply@evans-software-solutions.com>`; grant replies go to `admin@evans-software-solutions.com`. The two internal emails omit Reply-To.

The current grant email is an access notification and download link (`/qr/founding`), not a Supabase invitation or token-bearing confirmation. It has no link expiry to display. Creating a separate invitation email would exceed the brief's “no new email types” scope.

Stripe amount/currency and contribution source reach the grant service and records but are not passed to the email renderer. The four lookup keys match the brief. The renderer needs explicit purchase-source/renewal data, with a complimentary variant and no implied payment for gifts. No iOS offer-code caller of this renderer was found.

**Access-until conflict:** `foundingGrantRepository.writeSubscriptionRow` calculates expiry from the time access is applied. Pending grants have no expiry until first eligible `/subscriptions/me` applies them following verified signup. Purchase date + term can therefore misstate actual expiry. Proposed treatment for approval: real stored expiry for active access; explicit “term starts when activated” text for pending access. Leave entitlement logic unchanged.

## Deliverability evidence

Public DNS checked live:

- Apex SPF: `v=spf1 include:_spf.google.com ~all`.
- `send.evans-software-solutions.com` SPF: `v=spf1 include:amazonses.com ~all`.
- `resend._domainkey.evans-software-solutions.com`: public key present.
- Apex DMARC: `v=DMARC1; p=none;` (monitoring).
- Apex MX: `1 smtp.google.com.` This supersedes the old no-MX comment in `infra/email.ts`.

SES infrastructure provisions domain DKIM in `eu-west-2`, with no custom MAIL FROM. Live SES identity verification failed because the `ess-prod` AWS SSO token expired. Published records alone do not prove actual Resend or SES message alignment. Need provider verification and received-message Authentication-Results/Return-Path/DKIM headers; Reply-To mailbox operation also remains untested. No DNS or provider changes made.

## Company details supplied 11 September 2026

Brad supplied the [Companies House record](https://find-and-update.company-information.service.gov.uk/company/16938357). Its live overview confirms:

- Registered name: EVANS SOFTWARE SOLUTIONS LIMITED.
- Company number: 16938357.
- Registered office: 320 Loughborough Road, West Bridgford, Nottingham, England, NG2 7FB.

Footer wording will use “Registered in England and Wales” as specified in Brad's original brief. The supplied company record resolves the company-name, number and registered-office request; it does not constitute approval of the inventory, pending-access wording or cancellation copy.

## Decisions and remaining prerequisites

1. Approve this inventory and whether the two existing internal notifications should be styled too. Preserve the single purchase/grant email with content variants.
2. Approve pending-access wording reflecting activation-time expiry, rather than changing grants to purchase-time expiry.
3. Company details are now supplied above. Confirm support Reply-To and solicitor-approved cancellation/immediate-supply wording. Draft body copy must be approved before shipping.
4. Restore dashboard/SES access for live configuration verification. Confirm existing email-client testing access: browser previews cannot stand in for Gmail Android, Apple Mail or Windows Outlook. The required screenshot matrix, blocked-images and 320px checks remain outstanding.

Discovery approval was received on 11 September 2026. The statements above describe the discovery baseline; see the implementation document for current status.
