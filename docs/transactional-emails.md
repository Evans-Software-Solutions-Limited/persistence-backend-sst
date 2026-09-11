# Transactional emails

Draft PR for copy/design review. Brad approved the discovery inventory (including the two internal notifications) and activation-based wording for pending grants on 11 September 2026. Company details are verified in the [discovery record](transactional-email-discovery-2026-09-10.md). No grant/entitlement rules or send triggers are changed.

## Website brand match

The published website stylesheet (`/assets/index-Bvr-zIZC.css`) was checked against these emails: the paper `#f5f2eb`, card `#fffefb`, inset `#f1ece2`, footer `#efeae0`, ink `#17161a` and navy `#002c62` match its light-theme/brand tokens exactly, as requested in the original brief. The header now uses the same `/apple-touch-icon.png` P mark as `MarketingNav.tsx`, at the site's 30×30 size beside the Persistence wordmark. The image has explicit dimensions, block display and alt text; the wordmark remains live text when images are blocked. No recreated or recoloured logo is used. This is the website's light palette, not its alternate dark theme.

## Maintenance and preview

`microservices/core/src/application/email/emailShell.ts` owns the shared light-paper shell, escaping, URL validation, button, summary and company footer. Pass only composed trusted markup to `bodyHtml`; use the escaping helpers for all data. App sends provide HTML **and** text to Resend. Purchase source is explicit and unsupported sources fail rendering; native store offer codes do not enter this grant renderer. Active access uses the stored expiry; pending access describes when the term begins. Complimentary grants do not display a paid amount.

```sh
bun run email:templates
bun run email:preview
python3 -m http.server 8765 --bind 127.0.0.1 --directory .email-previews
```

Open `http://127.0.0.1:8765/`. There are 17 variants: four offers, each active/pending; complimentary; two internal notifications; six Auth templates. Each has HTML, plain text, a blocked-images simulation and a multipart EML preview. All use synthetic data. These commands do not send mail or make purchases. EML shows the intended MIME structure, not evidence of provider delivery.

The Auth generator composes the same shell at build time, then writes standalone files to `supabase/templates`. No Go partials or runtime includes are used. It preserves `ConfirmationURL` or `Token` verbatim and includes no animation or offer copy. Local `supabase/config.toml` references the HTML files; the adjacent `.txt` files are review artifacts, **not automatically used by Supabase SMTP**. No additional Auth notification type is enabled. Check which optional security notifications are enabled in each hosted project before claiming complete coverage.

Auth expiry text is generated from local `otp_expiry` (currently one hour). Before publishing, verify the expiry for **each action** in the target project's actual Auth version/configuration; do not assume the local value matches hosted settings. Regenerate if it differs. Preserve the hosted project's existing Site URL and redirects. Back up the original hosted template bodies/subjects before manual replacement in Auth → Emails. Reverting the config/template changes and restoring that backup rolls back styling.

## Celebration asset

`packages/web/public/email/founding-welcome.gif` is deterministic, 160×96, 29,301 bytes, 14 frames and 1.7 seconds. First and last frames are the same resting tick. It contains no repeat extension: in GIF semantics this plays once; `loop=1` would play twice. This intentionally implements the brief's one-playback intent. Regenerate with `python3 scripts/email-celebration.py` using Pillow. The script checks dimensions, size, duration, repeat metadata and identical first/last frames.

The sent URL is `https://persistence.evans-software-solutions.com/email/founding-welcome.gif`. Deploy the web asset and verify a public `200` with GIF content **before** deploying the mailer; the URL is not live merely because this file is in git. Keep this URL stable for already-delivered messages. Preview HTML alone substitutes a local asset path. The text headline, summary and action remain readable without the image.

## Review and rollout blockers

- **Copy approval:** the renderer and generated text files are the concrete copy draft. In particular, review the first-person introductions, activation instructions and support promise. Existing Reply-To remains `admin@evans-software-solutions.com`; confirm the mailbox is monitored. The exact solicitor-approved 14-day cancellation/immediate-supply clause is still missing and must be supplied before shipping; no substitute legal wording has been invented.
- **Auth plain-text delivery:** the inspected [Supabase SMTP implementation](https://github.com/supabase/auth/blob/master/internal/mailer/mailmeclient/mailmeclient.go) calls `SetBody("text/html", body)` with no text alternative. Hosted version behavior still requires a received MIME inspection. HTML template configuration alone therefore cannot satisfy the brief's multipart requirement. A Send Email Hook/custom delivery path would be a separate implementation decision; this PR does not introduce one or claim the `.txt` companions solve delivery.
- **Deliverability:** the discovery records live SPF, Resend DKIM and monitoring-only DMARC. Restore the expired `ess-prod` AWS SSO session and hosted Supabase access, check SES DKIM verification and actual SMTP settings, then inspect received Authentication-Results, Return-Path and DKIM alignment for both providers. Verify provider-level open/click tracking is disabled; no tracking pixel is added in code. Do not change DNS silently.
- **Client matrix:** [browser evidence](email-screenshots/README.md) covers all variants at 600px/320px and an images-blocked simulation. It is not Gmail or Outlook evidence. Still required: Gmail web light and forced dark, Gmail Android, Apple Mail macOS/iOS, Outlook Windows desktop and Outlook.com, with images blocked and narrow widths. No connected mail-client test service or Windows session is available in this task. Attach the real-client captures before marking ready to ship.

Do not merge/deploy until these blockers are resolved. This PR is intentionally draft; the original brief's definition of done is not yet met.
