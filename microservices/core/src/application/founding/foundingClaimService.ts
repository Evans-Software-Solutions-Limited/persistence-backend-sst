import { randomInt, randomUUID, createHash } from "node:crypto";
import {
  FoundingClaimRepository,
  FoundingClaimError,
} from "../repositories/foundingClaimRepository";
import { VoucherRepository } from "../repositories/voucherRepository";
import { FoundingGrantService } from "./foundingGrantService";
import { getAuthUserIdentity } from "../account/supabaseAdminClient";
import { sendEmail } from "../leads/resendClient";
import { emailParagraph, renderEmailShell } from "../email/emailShell";
export const claimHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function claimEmail(raw: string) {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new FoundingClaimError(
      "invalid_email",
      400,
      "Enter a valid email address.",
    );
  return email;
}
export class FoundingClaimService {
  private readonly repo: FoundingClaimRepository;
  private readonly identity: typeof getAuthUserIdentity;
  private readonly mailer: typeof sendEmail;
  private readonly limits: VoucherRepository;
  private readonly grants: FoundingGrantService;
  constructor(
    repo = new FoundingClaimRepository(),
    identity = getAuthUserIdentity,
    mailer = sendEmail,
    limits = new VoucherRepository(),
    grants = new FoundingGrantService(),
  ) {
    this.repo = repo;
    this.identity = identity;
    this.mailer = mailer;
    this.limits = limits;
    this.grants = grants;
  }
  private async account(id: string) {
    const identity = await this.identity(id);
    if (identity.id !== id || !identity.emailConfirmedAt || !identity.email)
      throw new FoundingClaimError(
        "verified_account_required",
        401,
        "Sign in to a verified account before claiming access.",
      );
    return { id, email: claimEmail(identity.email) };
  }
  async request(id: string, email: string) {
    // Reuse the existing persistent hourly limiter with a disjoint key namespace.
    await this.limits.rateLimit([
      { key: `founding-request-account:${id}`, limit: 10 },
    ]);
    const account = await this.account(id),
      purchaseEmail = claimEmail(email);
    await this.limits.rateLimit([
      { key: `founding-request-email:${purchaseEmail}`, limit: 5 },
    ]);
    const challengeId = randomUUID(),
      otp = String(randomInt(0, 1000000)).padStart(6, "0");
    await this.repo.prepare(
      account,
      purchaseEmail,
      challengeId,
      claimHash(`${challengeId}:${otp}`),
    );
    // Same email and HTTP response whether a pending grant exists or not. The
    // recipient learns only after proving ownership, never through enumeration.
    try {
      const text = `Your Persistence access verification code is ${otp}. It expires in 10 minutes. Enter it only on the Persistence website where you requested it. This will attach any unclaimed access for this email to the signed-in account ${account.email}. If that is not your account or you did not request this code, do not share it and ignore this email.`;
      await this.mailer({
        to: purchaseEmail,
        subject: "Your Persistence access verification code",
        text,
        html: renderEmailShell({
          title: "Verify your access email",
          preheader: "Your one-time verification code",
          bodyHtml: emailParagraph(text),
        }),
      });
    } catch {
      await this.repo.discard(challengeId);
      throw new FoundingClaimError(
        "delivery_failed",
        503,
        "The verification email could not be sent. Please try again.",
      );
    }
    return { challengeId };
  }
  async verify(id: string, challengeId: string, code: string) {
    await this.limits.rateLimit([
      { key: `founding-verify-account:${id}`, limit: 30 },
    ]);
    const account = await this.account(id);
    return this.repo.consume(
      account,
      challengeId,
      claimHash(`${challengeId}:${code}`),
      (grant, tx) => this.grants.applyPendingGrant(grant, account.id, tx),
    );
  }
}
