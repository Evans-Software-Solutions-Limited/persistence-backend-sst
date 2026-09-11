# Browser preview evidence — 11 September 2026

These are in-app Chromium browser viewport captures, **not** Gmail, Apple Mail or Outlook screenshots. Sample data only; draft copy. Each capture shows the top 900px; a separate founding footer capture is linked below. Full-page stitching produced duplicate fragments in this environment, so those captures were discarded.

Visual criteria: paper background and near-white card; 600px maximum card; navy action with readable text; clear live-data summary; no horizontal overflow at 320px; message/action present without images. The DOM check log records all 51 width/image checks. Blocked-image previews replace images with their alt text as a simulation, not client-specific behavior. Browser previews do not simulate forced dark mode.

| Variant                  | 600px                                       | 320px                                       | Images blocked, 320px                               |
| ------------------------ | ------------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| premium-6m-pending       | [Capture](premium-6m-pending-600.png)       | [Capture](premium-6m-pending-320.png)       | [Capture](premium-6m-pending-blocked-320.png)       |
| premium-6m-active        | [Capture](premium-6m-active-600.png)        | [Capture](premium-6m-active-320.png)        | [Capture](premium-6m-active-blocked-320.png)        |
| premium-12m-pending      | [Capture](premium-12m-pending-600.png)      | [Capture](premium-12m-pending-320.png)      | [Capture](premium-12m-pending-blocked-320.png)      |
| premium-12m-active       | [Capture](premium-12m-active-600.png)       | [Capture](premium-12m-active-320.png)       | [Capture](premium-12m-active-blocked-320.png)       |
| premium_plus-6m-pending  | [Capture](premium_plus-6m-pending-600.png)  | [Capture](premium_plus-6m-pending-320.png)  | [Capture](premium_plus-6m-pending-blocked-320.png)  |
| premium_plus-6m-active   | [Capture](premium_plus-6m-active-600.png)   | [Capture](premium_plus-6m-active-320.png)   | [Capture](premium_plus-6m-active-blocked-320.png)   |
| premium_plus-12m-pending | [Capture](premium_plus-12m-pending-600.png) | [Capture](premium_plus-12m-pending-320.png) | [Capture](premium_plus-12m-pending-blocked-320.png) |
| premium_plus-12m-active  | [Capture](premium_plus-12m-active-600.png)  | [Capture](premium_plus-12m-active-320.png)  | [Capture](premium_plus-12m-active-blocked-320.png)  |
| complimentary            | [Capture](complimentary-600.png)            | [Capture](complimentary-320.png)            | [Capture](complimentary-blocked-320.png)            |
| coach-enquiry            | [Capture](coach-enquiry-600.png)            | [Capture](coach-enquiry-320.png)            | [Capture](coach-enquiry-blocked-320.png)            |
| checkout-needs-review    | [Capture](checkout-needs-review-600.png)    | [Capture](checkout-needs-review-320.png)    | [Capture](checkout-needs-review-blocked-320.png)    |
| auth-confirmation        | [Capture](auth-confirmation-600.png)        | [Capture](auth-confirmation-320.png)        | [Capture](auth-confirmation-blocked-320.png)        |
| auth-invite              | [Capture](auth-invite-600.png)              | [Capture](auth-invite-320.png)              | [Capture](auth-invite-blocked-320.png)              |
| auth-magic_link          | [Capture](auth-magic_link-600.png)          | [Capture](auth-magic_link-320.png)          | [Capture](auth-magic_link-blocked-320.png)          |
| auth-recovery            | [Capture](auth-recovery-600.png)            | [Capture](auth-recovery-320.png)            | [Capture](auth-recovery-blocked-320.png)            |
| auth-email_change        | [Capture](auth-email_change-600.png)        | [Capture](auth-email_change-320.png)        | [Capture](auth-email_change-blocked-320.png)        |
| auth-reauthentication    | [Capture](auth-reauthentication-600.png)    | [Capture](auth-reauthentication-320.png)    | [Capture](auth-reauthentication-blocked-320.png)    |

[Founding steps and statutory footer at 320px](premium-6m-pending-footer-320.png). [Measured DOM checks](browser-checks.json).

Still outstanding: Gmail web light/forced dark, Gmail Android, Apple Mail macOS/iOS, Windows Outlook desktop and Outlook.com. No claim of client-matrix completion.
