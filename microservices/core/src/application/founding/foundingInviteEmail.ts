import {
  catalogTier,
  type GrantableTierId,
} from "@persistence/subscription-catalog";
import {
  EMAIL_SUPPORT,
  emailButton,
  emailFooterText,
  emailParagraph,
  emailSummary,
  renderEmailShell,
} from "../email/emailShell";

/** One existing grant/invite email, with active and pending variants. Purchase
 * source is required: native-store offers must never inherit fixed-term copy. */
export interface InviteEmailInput {
  tierName: GrantableTierId;
  grantKind: "founding" | "complimentary";
  months: number;
  expiresAt: Date | null;
  hasAccount: boolean;
  email: string;
  webOrigin: string;
  amountMinor: number;
  currency: string;
  purchaseSource: "web_checkout" | "admin_grant";
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
  html: string;
} {
  if (
    input.purchaseSource !== "web_checkout" &&
    input.purchaseSource !== "admin_grant"
  )
    throw new Error(
      "A supported purchase source is required for renewal wording",
    );
  if (
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor < 0 ||
    !/^[A-Z]{3}$/.test(input.currency)
  )
    throw new Error("Valid actual payment amount and currency are required");
  const tier = catalogTier(input.tierName).name;
  const downloadUrl = `${input.webOrigin.replace(/\/$/, "")}/qr/founding`;
  const claimUrl = `${input.webOrigin.replace(/\/$/, "")}/founding/access`;
  const founding = input.grantKind === "founding";
  const subject = founding
    ? `You're a Persistence founding member — ${tier} for ${input.months} months`
    : `Your Persistence access — ${tier} for ${input.months} months`;
  const title = founding ? "You're in." : "Your access is ready.";
  const introduction = founding
    ? "Thanks for backing Persistence. I'm glad you're here."
    : "I've arranged complimentary Persistence access for you.";
  const pending = `Your ${input.months}-month term starts when you activate access.`;
  const accessUntil = input.hasAccount
    ? input.expiresAt
      ? formatDate(input.expiresAt)
      : "Check You → Subscription in the app"
    : pending;
  // Stripe's minor unit exponent follows its currency; Intl supplies the ISO
  // exponent so JPY and three-decimal currencies are not divided by 100.
  const money = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: input.currency,
  });
  const paid = money.format(
    input.amountMinor /
      10 ** (money.resolvedOptions().maximumFractionDigits ?? 2),
  );
  const rows: Array<[string, string]> = [
    ["Plan", tier],
    ["Term", `${input.months} months`],
    [founding ? "Paid" : "Access", founding ? paid : "Complimentary"],
    ["Access until", accessUntil],
    ["Renewal", "Does not renew"],
  ];
  const access = input.hasAccount
    ? `Your ${tier} access is already on. Open the app and you'll see it under You → Subscription.`
    : `Activate your ${tier} access on our website. Sign in using the same method you use for Persistence, then verify this purchase email (${input.email}). Apple Hide My Email is supported; you do not need a second account.`;
  const steps = input.hasAccount
    ? [
        "Open Persistence and sign in using the same account and sign-in method you used on the website.",
        "If you use Sign in with Apple, continue with the same Apple account, including Hide My Email.",
        "Open You → Subscription to see your access.",
      ]
    : [
        "Open the activation website and sign in to your Persistence account. If you already use Apple or Google, choose that same sign-in method.",
        "Enter the email that received this invite and verify the code sent there. Confirm the account that will receive access.",
        "Open the app with that same account. Find your access under You → Subscription.",
      ];
  const fixedTerm =
    "This access was granted directly and does not auto-renew — when it ends you choose whether to continue.";
  const support = `Your purchase email can differ from your account email. If you need help accessing the correct account, email ${EMAIL_SUPPORT}.`;
  const text = [
    title,
    introduction,
    rows.map(([label, value]) => `${label}: ${value}`).join("\n"),
    fixedTerm,
    access,
    ...(!input.hasAccount ? [`Activate access: ${claimUrl}`] : []),
    `Get the app: ${downloadUrl}`,
    `What happens next\n${steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}`,
    support,
    "Brad\nPersistence",
    emailFooterText(input.webOrigin),
  ].join("\n\n");
  const html = renderEmailShell({
    title: subject,
    webOrigin: input.webOrigin,
    bodyHtml: `${founding ? '<img src="https://persistence.evans-software-solutions.com/email/founding-welcome.gif" width="160" height="96" alt="You’re a founding member" style="display:block;border:0;margin:0 0 20px;">' : ""}<h1 style="font-size:36px;line-height:42px;margin:0 0 16px;">${title}</h1>${emailParagraph(introduction)}${emailSummary(rows)}${emailParagraph(fixedTerm)}${emailButton(input.hasAccount ? "Open the app" : "Activate access on the website", input.hasAccount ? downloadUrl : claimUrl)}${emailParagraph(access)}<h2 style="font-size:21px;line-height:28px;margin:8px 0 16px;">What happens next</h2>${steps.map((step, i) => emailParagraph(`${i + 1}. ${step}`)).join("")}${emailParagraph(support)}${emailParagraph("Brad\nPersistence")}`,
  });
  return { subject, text, html };
}
