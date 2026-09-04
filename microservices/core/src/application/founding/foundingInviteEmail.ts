import { FOUNDING_OFFERS, type FoundingTierName } from "./foundingOffer";

/**
 * Plain-text founding-member email (Resend, via the existing leads client).
 * Two variants: the buyer already has an account (their access is live), or
 * they don't yet (their access applies the moment they sign up with this
 * email). Copy rules: sentence case, no emojis, no hype (Brad's preference).
 */
export interface InviteEmailInput {
  tierName: FoundingTierName;
  months: number;
  expiresAt: Date | null;
  hasAccount: boolean;
  email: string;
  webOrigin: string;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

export function buildFoundingInviteEmail(input: InviteEmailInput): {
  subject: string;
  text: string;
} {
  const tier = FOUNDING_OFFERS[input.tierName].label;
  const downloadUrl = `${input.webOrigin.replace(/\/$/, "")}/qr/founding`;
  const subject = `You're a Persistence founding member — ${tier} for ${input.months} months`;

  const access = input.hasAccount
    ? `Your ${tier} access is already on. Open the app and you'll see it under You → Subscription${
        input.expiresAt ? `, active until ${formatDate(input.expiresAt)}` : ""
      }.`
    : `Download Persistence and sign up with this email address (${input.email}). ${tier} switches on automatically the first time the app loads after you sign in — nothing to enter, no code. Please sign up within 90 days of payment — after that we may release your place.`;

  const text = [
    `Thanks for backing Persistence as a founding member.`,
    ``,
    `What you have: ${tier}, ${input.months} months, paid in full. It does not auto-renew — when it ends you choose whether to continue.`,
    ``,
    access,
    ``,
    `Get the app: ${downloadUrl}`,
    ``,
    `If you used a different email in the app, reply to this message and we'll move it across.`,
    ``,
    `Brad`,
    `Persistence`,
  ].join("\n");

  return { subject, text };
}
