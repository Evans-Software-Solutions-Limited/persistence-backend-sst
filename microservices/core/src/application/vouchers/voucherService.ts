import { randomInt, randomUUID } from "node:crypto";
import { getAuthUserIdentity } from "../account/supabaseAdminClient";
import { sendEmail } from "../leads/resendClient";
import { emailParagraph, renderEmailShell } from "../email/emailShell";
import {
  VoucherRepository,
  type VerifiedAccount,
} from "../repositories/voucherRepository";
import {
  canonicalCode,
  hashSecret,
  normalizeEmail,
  VoucherError,
} from "./voucherRules";
export class VoucherService {
  private repo: VoucherRepository;
  private identity: typeof getAuthUserIdentity;
  private mailer: typeof sendEmail;
  constructor(
    repo = new VoucherRepository(),
    identity = getAuthUserIdentity,
    mailer = sendEmail,
  ) {
    this.repo = repo;
    this.identity = identity;
    this.mailer = mailer;
  }
  private async account(id: string): Promise<VerifiedAccount> {
    const identity = await this.identity(id);
    if (identity.id !== id || !identity.emailConfirmedAt || !identity.email)
      throw new VoucherError(
        "verified_account_required",
        401,
        "Verify your membership account email before continuing.",
      );
    return { id, email: normalizeEmail(identity.email) };
  }
  async check(code: string, email: string, sourceIp: string = "unknown") {
    // Source IP is overwritten from the Lambda request context at the API boundary.
    // A workplace NAT can represent all 500 employees in a batch plus retries.
    await this.repo.rateLimit([{ key: `check-ip:${sourceIp}`, limit: 2000 }]);
    const eligibility = normalizeEmail(email);
    await this.repo.rateLimit([
      { key: `check-email:${sourceIp}:${eligibility}`, limit: 20 },
      { key: `check-voucher:${canonicalCode(code)}`, limit: 30 },
    ]);
    return this.repo.check(code, eligibility);
  }
  async prepare(id: string, code: string, email: string) {
    await this.repo.rateLimit([{ key: `prepare-account:${id}`, limit: 20 }]);
    const account = await this.account(id);
    const eligibility = normalizeEmail(email);
    await this.repo.rateLimit([
      { key: `prepare-email:${eligibility}`, limit: 10 },
      { key: `prepare-voucher:${canonicalCode(code)}`, limit: 20 },
    ]);
    const challengeId = randomUUID();
    const otp = String(randomInt(0, 1000000)).padStart(6, "0");
    const challenge = await this.repo.prepare(
      account,
      code,
      eligibility,
      account.email === eligibility
        ? null
        : hashSecret(`${challengeId}:${otp}`),
      challengeId,
    );
    if (!challenge.verified) {
      try {
        const text = `Your Persistence employee verification code is ${otp}. It expires in 10 minutes. Enter this code only on the Persistence redemption page. This verifies eligibility; membership will be assigned to ${account.email}. If you did not request this, ignore this email.`;
        await this.mailer({
          to: eligibility,
          subject: "Your Persistence employee verification code",
          text,
          html: renderEmailShell({
            title: "Verify your employee email",
            preheader: "Your one-time verification code",
            bodyHtml: emailParagraph(text),
          }),
        });
      } catch {
        await this.repo.discardChallenge(challengeId);
        throw new VoucherError(
          "delivery_failed",
          503,
          "The verification email could not be sent. Please try again.",
        );
      }
    }
    return challenge;
  }
  async verify(id: string, challengeId: string, otp: string) {
    await this.repo.rateLimit([{ key: `verify-account:${id}`, limit: 30 }]);
    return this.repo.verify(
      await this.account(id),
      challengeId,
      hashSecret(`${challengeId}:${otp}`),
    );
  }
  async redeem(id: string, challengeId: string) {
    await this.repo.rateLimit([{ key: `redeem-account:${id}`, limit: 30 }]);
    return this.repo.redeem(await this.account(id), challengeId);
  }
}
