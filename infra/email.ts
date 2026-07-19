import { emailDomain, emailSender, hostedZoneId } from "./domains";

/**
 * Production-grade transactional email for Supabase Auth (confirmation /
 * reset / magic-link), provisioned as infrastructure-as-code so staging and
 * production behave identically.
 *
 * What this creates, per named stage (production / staging only — dev and
 * personal stages get nothing, guarded on `hostedZoneId` + `emailDomain`
 * exactly like the API/web custom-domain guard):
 *
 *   1. An SES **domain** identity via `sst.aws.Email`, with DKIM CNAMEs and a
 *      `_dmarc` TXT auto-written into the stage's Route 53 zone. Domain-level
 *      DKIM means any address in the domain can send; we only ever use
 *      `no-reply@<domain>` (see `emailSender`).
 *   2. An IAM user + inline policy scoped to **only** `ses:SendRawEmail`
 *      (SMTP always sends raw MIME), plus an access key. Supabase needs SMTP
 *      user/pass, not an IAM SDK identity — so the access key's derived
 *      `sesSmtpPasswordV4` is the SMTP password and the access key id is the
 *      SMTP username.
 *   3. The credentials in SSM Parameter Store (the password as a
 *      `SecureString`) so they never land in a plaintext stack output or the
 *      deploy log. Brad reads them back to configure Supabase custom SMTP.
 *
 * ─── Region ───
 * SES is regional and the SMTP endpoint host encodes the region
 * (`email-smtp.eu-west-2.amazonaws.com`), which must match the region the
 * identity lives in AND the region used to derive the SMTP password. Every
 * resource here — the `sst.aws.Email` identity, the IAM access key (whose
 * `sesSmtpPasswordV4` derivation is region-dependent), and the SSM params —
 * is pinned to an explicit eu-west-2 provider, so the chain agrees on the
 * region regardless of the ambient `AWS_REGION`. A password derived for the
 * wrong region would fail SMTP auth, and an identity verified in the wrong
 * region would leave every auth email rejected.
 *
 * ─── MX / inbound ───
 * SES sending is outbound-only — it relies on DKIM (and optional SPF), never
 * MX — and this module never creates or touches an MX record. As of the live
 * DNS check the apex `evans-software-solutions.com` carries no MX at all (the
 * project's real mail is on a different domain), so there is nothing to
 * preserve; and if the apex ever gains MX (e.g. Google Workspace), SES's
 * DKIM CNAMEs + `_dmarc` TXT coexist with it untouched. No custom MAIL FROM
 * is configured (it would need an apex subdomain) — DKIM alignment alone
 * yields a DMARC pass, so the sender needs no inbound wiring.
 *
 * ─── DMARC ───
 * `sst.aws.Email` always writes a `_dmarc` TXT (default `v=DMARC1; p=none;`
 * — monitoring only, the policy we want to start with). SST's Route 53
 * adapter creates records with `allowOverwrite: false`, so if a `_dmarc`
 * record already exists for the domain the deploy fails loudly rather than
 * clobbering it — the "do not clobber an existing DMARC" requirement is met
 * by construction. Verified against live DNS: neither the apex nor the
 * staging zone currently has a `_dmarc`, so both are created cleanly with no
 * collision.
 */

/** SES region — must match the SMTP endpoint host below and the prod Supabase project region. */
const SES_REGION = "eu-west-2";
/** SMTP submission endpoint for `SES_REGION`. */
const SMTP_HOST = `email-smtp.${SES_REGION}.amazonaws.com`;
/** STARTTLS submission port (Supabase custom SMTP default). */
const SMTP_PORT = "587";
/** Display name in the `From` header; Supabase's "Sender name" dashboard field. */
const EMAIL_SENDER_NAME = "Persistence";

function provisionEmail() {
  // Same guard as the API/web custom-domain wiring: only named stages have a
  // hosted zone (and therefore an email domain). Dev / personal stages skip
  // SES entirely and send no mail.
  if (!hostedZoneId || !emailDomain || !emailSender) {
    return undefined;
  }

  const stage = $app.stage;

  // Explicit eu-west-2 provider for EVERY resource in this module. SES is
  // regional and the whole chain has to agree on the region: the identity
  // (and its DKIM verification) must live in the same region as the SMTP
  // endpoint host (`email-smtp.eu-west-2.amazonaws.com`) and the region
  // Pulumi uses to derive `accessKey.sesSmtpPasswordV4`. If the identity
  // verified in region X while Supabase authenticated against the eu-west-2
  // endpoint, SMTP auth would succeed but no identity would be verified
  // there and every auth email would be rejected. Pinning identity + creds
  // + params to one provider makes that mismatch impossible regardless of
  // the ambient AWS_REGION.
  const provider = new aws.Provider("ses-euw2", { region: SES_REGION });
  const opts = { provider };

  // SES domain identity + DKIM + `_dmarc` (p=none) written into the stage's
  // zone. `dns: sst.aws.dns({ zone })` is passed explicitly for the same
  // reason as infra/api.ts + infra/web.ts: staging's zone is in a different
  // AWS account than the parent, so SST can't auto-walk to it. `opts` pins
  // the identity to eu-west-2 (see the provider comment above); route 53 is
  // global, so the DNS records are unaffected by the region.
  const identity = new sst.aws.Email(
    "PersistenceEmail",
    {
      sender: emailDomain,
      dns: sst.aws.dns({ zone: hostedZoneId }),
    },
    opts,
  );

  // Least-privilege SMTP sender: one IAM user, allowed only to send raw
  // email. `forceDestroy` lets the user be torn down even with the access
  // key still attached (dev/staging stack removal).
  const smtpUser = new aws.iam.User(
    "SesSmtpUser",
    { name: `persistence-${stage}-ses-smtp`, forceDestroy: true },
    opts,
  );

  new aws.iam.UserPolicy(
    "SesSmtpUserPolicy",
    {
      user: smtpUser.name,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "SendRawEmailOnly",
            Effect: "Allow",
            Action: ["ses:SendRawEmail"],
            Resource: "*",
          },
        ],
      }),
    },
    opts,
  );

  const accessKey = new aws.iam.AccessKey(
    "SesSmtpAccessKey",
    { user: smtpUser.name },
    opts,
  );

  // ─── Credentials → SSM Parameter Store (eu-west-2) ───
  // The password is a SecureString (encrypted with the account-default
  // `alias/aws/ssm` KMS key) so it never appears in a plaintext output or
  // the deploy log. Username/host/port/sender are non-secret and also
  // surfaced as stack outputs below.
  const prefix = `/persistence/${stage}/ses`;

  const usernameParam = new aws.ssm.Parameter(
    "SesSmtpUsernameParam",
    { name: `${prefix}/smtp-username`, type: "String", value: accessKey.id },
    opts,
  );

  const passwordParam = new aws.ssm.Parameter(
    "SesSmtpPasswordParam",
    {
      name: `${prefix}/smtp-password`,
      type: "SecureString",
      value: accessKey.sesSmtpPasswordV4,
    },
    opts,
  );

  new aws.ssm.Parameter(
    "SesSmtpHostParam",
    { name: `${prefix}/smtp-host`, type: "String", value: SMTP_HOST },
    opts,
  );

  new aws.ssm.Parameter(
    "SesSmtpPortParam",
    { name: `${prefix}/smtp-port`, type: "String", value: SMTP_PORT },
    opts,
  );

  new aws.ssm.Parameter(
    "SesSenderParam",
    { name: `${prefix}/sender`, type: "String", value: emailSender },
    opts,
  );

  new aws.ssm.Parameter(
    "SesSenderNameParam",
    { name: `${prefix}/sender-name`, type: "String", value: EMAIL_SENDER_NAME },
    opts,
  );

  return {
    identity,
    smtpHost: SMTP_HOST,
    smtpPort: SMTP_PORT,
    // Access key id — the SMTP username. Not secret (the password is), so
    // safe to surface as a stack output.
    smtpUsername: accessKey.id,
    sender: emailSender,
    senderName: EMAIL_SENDER_NAME,
    // SSM param *paths* (never values) so `sst deploy` output tells Brad
    // where to read the credentials for the Supabase dashboard step.
    smtpUsernameParam: usernameParam.name,
    smtpPasswordParam: passwordParam.name,
  };
}

/**
 * The provisioned email resources, or `undefined` on dev / personal stages.
 * Consumed by `sst.config.ts` to surface non-secret SMTP config as outputs.
 */
export const email = provisionEmail();
