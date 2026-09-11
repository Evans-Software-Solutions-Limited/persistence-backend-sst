import { describe, expect, it } from "vitest";
import {
  buildFoundingInviteEmail,
  type InviteEmailInput,
} from "../foundingInviteEmail";
import {
  buildInternalEmail,
  emailButton,
  renderEmailShell,
} from "../../email/emailShell";

const base: InviteEmailInput = {
  tierName: "premium",
  grantKind: "founding",
  months: 6,
  expiresAt: null,
  hasAccount: false,
  email: "buyer@example.com",
  webOrigin: "https://example.test",
  amountMinor: 3000,
  currency: "GBP",
  purchaseSource: "web_checkout",
};

describe("transactional email templates", () => {
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid paid amount %s",
    (amountMinor) => {
      expect(() => buildFoundingInviteEmail({ ...base, amountMinor })).toThrow(
        "payment amount",
      );
    },
  );

  it("rejects missing currency rather than inventing pounds", () => {
    expect(() => buildFoundingInviteEmail({ ...base, currency: "" })).toThrow(
      "currency",
    );
  });

  it("renders safe intro copy and rejects credential-bearing action URLs", () => {
    expect(
      renderEmailShell({
        title: "A < B",
        preheader: "Don't <share> & forward",
        bodyHtml: "",
      }),
    ).toContain("Don&#39;t &lt;share&gt; &amp; forward");
    expect(() =>
      emailButton("Open", "https://user:password@example.test/"),
    ).toThrow("HTTP(S)");
  });
  it.each([
    ["premium", 6, 3000, "Premium", "£30.00"],
    ["premium", 12, 6000, "Premium", "£60.00"],
    ["premium_plus", 6, 5000, "Premium+", "£50.00"],
    ["premium_plus", 12, 10000, "Premium+", "£100.00"],
  ] as const)(
    "renders %s %s-month actual payment and pending activation",
    (tierName, months, amountMinor, label, paid) => {
      const mail = buildFoundingInviteEmail({
        ...base,
        tierName,
        months,
        amountMinor,
        expiresAt: new Date("2027-01-01"),
      });
      expect(mail.text).toContain(
        `Plan: ${label}\nTerm: ${months} months\nPaid: ${paid}`,
      );
      expect(mail.text).toContain(
        `Your ${months}-month term starts when you activate access.`,
      );
      expect(mail.text).not.toContain("1 January 2027");
      expect(mail.html).toContain(paid);
      expect(mail.html).toContain("Does not renew");
      expect(mail.html).toContain('width="160" height="96"');
      expect(
        mail.html.match(/<td\b[^>]*>/g)?.every((td) => td.includes("bgcolor=")),
      ).toBe(true);
    },
  );

  it("uses actual amount/currency rather than the offer catalogue and actual active expiry", () => {
    const mail = buildFoundingInviteEmail({
      ...base,
      amountMinor: 4567,
      currency: "EUR",
      hasAccount: true,
      expiresAt: new Date("2028-04-09T12:00:00Z"),
    });
    expect(mail.text).toContain("Paid: €45.67");
    expect(mail.text).toContain("Access until: 9 April 2028");
    expect(mail.text).not.toContain("starts when");
  });

  it("does not invent an expiry when an active grant has no returned subscription date", () => {
    expect(
      buildFoundingInviteEmail({ ...base, hasAccount: true }).text,
    ).toContain("Access until: Check You → Subscription in the app");
  });

  it("gives complimentary grants neither paid claims nor founding animation", () => {
    const mail = buildFoundingInviteEmail({
      ...base,
      grantKind: "complimentary",
      amountMinor: 0,
      purchaseSource: "admin_grant",
    });
    expect(mail.text).toContain("Access: Complimentary");
    expect(mail.text).not.toContain("Paid:");
    expect(mail.html).not.toContain("<img");
    expect(mail.subject).not.toContain("founding member");
  });

  it("fails loudly for a missing or native-store purchase source", () => {
    for (const purchaseSource of [undefined, "ios_app_store"]) {
      expect(() =>
        buildFoundingInviteEmail({
          ...base,
          purchaseSource,
        } as unknown as InviteEmailInput),
      ).toThrow("purchase source");
    }
  });

  it("escapes dynamic content while retaining readable text and rejects executable URLs", () => {
    const mail = buildFoundingInviteEmail({
      ...base,
      email: '<img src=x onerror="boom">&x',
    });
    expect(mail.html).toContain(
      "&lt;img src=x onerror=&quot;boom&quot;&gt;&amp;x",
    );
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.text).toContain("<img src=x");
    expect(() => emailButton("Go", "javascript:alert(1)")).toThrow("HTTP(S)");
    expect(emailButton("Go", 'https://example.test/?x="&y=1')).toContain(
      "&amp;y=1",
    );
  });

  it("retains internal notification content safely and includes legal footer in both MIME parts", () => {
    const mail = buildInternalEmail(
      "New coach enquiry",
      "Message: <script>alert('x')</script>",
    );
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.text).toContain("Message: <script>");
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("16938357");
      expect(part).toContain("NG2 7FB");
      expect(part).toContain("England and Wales");
    }
  });
});
