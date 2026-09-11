/** Generate standalone Supabase templates; never contacts or changes a project. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { format } from "prettier";
import {
  EMAIL_SUPPORT,
  emailButton,
  emailFooterText,
  emailParagraph,
  escapeHtml,
  renderEmailShell,
} from "../microservices/core/src/application/email/emailShell";

export const authEmailDefinitions = [
  {
    key: "confirmation",
    subject: "Confirm your email address",
    action: "Confirm email",
    message:
      "Confirm your email address to finish creating your Persistence account.",
  },
  {
    key: "invite",
    subject: "Your Persistence invitation",
    action: "Accept invitation",
    message:
      "You have been invited to create a Persistence account. Accept the invitation to continue.",
  },
  {
    key: "magic_link",
    subject: "Your Persistence sign-in link",
    action: "Sign in",
    message: "Use this link to sign in to your Persistence account.",
  },
  {
    key: "recovery",
    subject: "Reset your Persistence password",
    action: "Reset password",
    message:
      "Use this link to choose a new password for your Persistence account.",
  },
  {
    key: "email_change",
    subject: "Confirm your email change",
    action: "Confirm email change",
    message:
      "Confirm the requested change to your Persistence account email address.",
  },
  {
    key: "reauthentication",
    subject: "Your Persistence verification code",
    action: null,
    message: "Use this code to verify your identity in Persistence.",
  },
] as const;

// This URL is replaced only after composing trusted HTML, preserving Go syntax.
const ACTION_PLACEHOLDER = "https://example.invalid/email-confirmation";

export function buildAuthEmail(
  definition: (typeof authEmailDefinitions)[number],
  expirySeconds: number,
) {
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= 0)
    throw new Error("Auth expiry must be a positive integer in seconds");
  const expiry =
    expirySeconds % 3600 === 0
      ? `${expirySeconds / 3600} hour${expirySeconds === 3600 ? "" : "s"}`
      : expirySeconds % 60 === 0
        ? `${expirySeconds / 60} minute${expirySeconds === 60 ? "" : "s"}`
        : `${expirySeconds} seconds`;
  const expiryText = `This ${definition.action ? "link" : "code"} expires in ${expiry}.`;
  const ignore = "If you did not request this, you can ignore this email.";
  const content = `<h1 style="margin:0 0 20px;font-size:28px;line-height:36px;">${escapeHtml(definition.subject)}</h1>${emailParagraph(definition.message)}${
    definition.action
      ? `${emailButton(definition.action, ACTION_PLACEHOLDER)}${emailParagraph("Or copy and paste this link into your browser:")}<p style="margin:0 0 20px;font-size:16px;line-height:26px;word-break:break-all;"><a href="${ACTION_PLACEHOLDER}" style="color:#002c62;">${ACTION_PLACEHOLDER}</a></p>`
      : '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#f1ece2" style="background-color:#f1ece2;border-radius:7px;padding:20px 12px;font-size:32px;line-height:44px;font-weight:700;letter-spacing:4px;text-align:center;">{{ .Token }}</td></tr></table>'
  }${emailParagraph(expiryText)}${emailParagraph(ignore)}${emailParagraph(`Need help? ${EMAIL_SUPPORT}`)}`;
  return {
    subject: definition.subject,
    html: renderEmailShell({
      title: definition.subject,
      bodyHtml: content,
    })
      .replace("<!DOCTYPE html>", "<!doctype html>")
      .replaceAll(ACTION_PLACEHOLDER, "{{ .ConfirmationURL }}"),
    text: [
      definition.subject,
      definition.message,
      definition.action
        ? `${definition.action}: {{ .ConfirmationURL }}`
        : "Verification code: {{ .Token }}",
      expiryText,
      ignore,
      `Need help? ${EMAIL_SUPPORT}`,
      emailFooterText(),
    ].join("\n\n"),
  };
}

export async function generateAuthTemplates(root: string) {
  const config = await readFile(resolve(root, "supabase/config.toml"), "utf8");
  const expiry = Number(config.match(/^otp_expiry\s*=\s*(\d+)\s*$/m)?.[1]);
  const directory = resolve(root, "supabase/templates");
  await mkdir(directory, { recursive: true });
  for (const definition of authEmailDefinitions) {
    const mail = buildAuthEmail(definition, expiry);
    await writeFile(
      resolve(directory, `${definition.key}.html`),
      await format(mail.html, { parser: "html" }),
    );
    await writeFile(
      resolve(directory, `${definition.key}.txt`),
      mail.text + "\n",
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await generateAuthTemplates(fileURLToPath(new URL("../", import.meta.url)));
  console.log(
    "Generated six Auth HTML templates and text companions; no messages sent.",
  );
}
