/** Offline previews only: no provider credentials, purchases or outbound email. */
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFoundingInviteEmail } from "../microservices/core/src/application/founding/foundingInviteEmail";
import {
  buildInternalEmail,
  escapeHtml,
} from "../microservices/core/src/application/email/emailShell";
import { authEmailDefinitions, buildAuthEmail } from "./email-auth-templates";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, ".email-previews");
await mkdir(resolve(output, "email"), { recursive: true });
await copyFile(
  resolve(root, "packages/web/public/email/founding-welcome.gif"),
  resolve(output, "email/founding-welcome.gif"),
);
await copyFile(
  resolve(root, "packages/web/public/apple-touch-icon.png"),
  resolve(output, "email/apple-touch-icon.png"),
);
const examples: Array<{
  name: string;
  mail: { subject: string; text: string; html: string };
}> = [];
for (const [tierName, months, amountMinor] of [
  ["premium", 6, 3000],
  ["premium", 12, 6000],
  ["premium_plus", 6, 5000],
  ["premium_plus", 12, 10000],
] as const) {
  for (const hasAccount of [false, true]) {
    examples.push({
      name: `${tierName}-${months}m-${hasAccount ? "active" : "pending"}`,
      mail: buildFoundingInviteEmail({
        tierName,
        months,
        amountMinor,
        currency: "GBP",
        purchaseSource: "web_checkout",
        grantKind: "founding",
        hasAccount,
        email: "preview@example.invalid",
        webOrigin: "https://persistence.evans-software-solutions.com",
        expiresAt: hasAccount
          ? new Date(
              months === 6 ? "2027-03-11T12:00:00Z" : "2027-09-11T12:00:00Z",
            )
          : null,
      }),
    });
  }
}
examples.push({
  name: "complimentary",
  mail: buildFoundingInviteEmail({
    tierName: "premium",
    months: 6,
    amountMinor: 0,
    currency: "GBP",
    purchaseSource: "admin_grant",
    grantKind: "complimentary",
    hasAccount: false,
    expiresAt: null,
    email: "preview@example.invalid",
    webOrigin: "https://persistence.evans-software-solutions.com",
  }),
});
examples.push({
  name: "coach-enquiry",
  mail: buildInternalEmail(
    "New coach enquiry",
    "Email: preview@example.invalid\nName: Example coach\nClient count: 12\nCurrent tool: Spreadsheet\nMessage: I would like to know more.",
  ),
});
examples.push({
  name: "checkout-needs-review",
  mail: buildInternalEmail(
    "Founding checkout needs review",
    "A founding purchase was paid for but access could not be granted.\n\nEmail: preview@example.invalid\nReason: example_failure\nStripe session: cs_example_preview\n\nResolve it by hand in /admin — grant access once any store subscription has expired, or refund the payment in Stripe.",
  ),
});
for (const definition of authEmailDefinitions) {
  const mail = buildAuthEmail(definition, 3600);
  const sample = (content: string) =>
    content
      .replaceAll(
        "{{ .ConfirmationURL }}",
        "https://example.invalid/auth/verify?token=example-not-a-real-token&type=email",
      )
      .replaceAll("{{ .Token }}", "123456");
  examples.push({
    name: `auth-${definition.key}`,
    mail: {
      subject: mail.subject,
      html: sample(mail.html),
      text: sample(mail.text),
    },
  });
}

for (const { name, mail } of examples) {
  // Preview-only asset substitution. Sent HTML retains the stable HTTPS URL.
  const html = mail.html
    .replaceAll(
      "https://persistence.evans-software-solutions.com/apple-touch-icon.png",
      "./email/apple-touch-icon.png",
    )
    .replaceAll(
      "https://persistence.evans-software-solutions.com/email/founding-welcome.gif",
      "./email/founding-welcome.gif",
    );
  await writeFile(resolve(output, `${name}.html`), html);
  await writeFile(resolve(output, `${name}.txt`), mail.text);
  await writeFile(
    resolve(output, `${name}-images-blocked.html`),
    html.replace(
      /<img\b[^>]*alt="([^"]*)"[^>]*>/g,
      '<p style="font-size:16px;line-height:24px;">$1</p>',
    ),
  );
  const boundary = "persistence-preview-alternative";
  const eml = [
    "From: Persistence <no-reply@evans-software-solutions.com>",
    "To: preview@example.invalid",
    `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(mail.text)
      .toString("base64")
      .match(/.{1,76}/g)!
      .join("\r\n"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(mail.html)
      .toString("base64")
      .match(/.{1,76}/g)!
      .join("\r\n"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  await writeFile(resolve(output, `${name}.eml`), eml);
}
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Persistence email previews</title><body style="font:16px/1.6 system-ui;background:#f5f2eb;color:#17161a;margin:24px"><h1>Persistence email previews</h1><p>Sample data only. Draft copy for review. These are browser previews, not email-client certification. EML files demonstrate both MIME parts; they do not prove hosted Auth delivers both.</p><ul>${examples.map(({ name, mail }) => `<li>${escapeHtml(name)} — <a href="${name}.html">HTML</a> · <a href="${name}-images-blocked.html">Images blocked simulation</a> · <a href="${name}.txt">Text</a> · <a href="${name}.eml">EML</a><br>${escapeHtml(mail.subject)}</li>`).join("")}</ul></body></html>`,
);
console.log(
  `Generated ${examples.length} offline previews in ${output}. Serve with: python3 -m http.server 8765 --directory ${output}`,
);
