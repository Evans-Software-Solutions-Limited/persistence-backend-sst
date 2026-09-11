/** Shared email shell. Content helpers escape data; bodyHtml accepts trusted,
 * composed markup only. Auth templates are generated from this shell offline.
 * Inline tables are intentional for Outlook; gradient has a solid fallback. */
export const EMAIL_SUPPORT = "admin@evans-software-solutions.com";
export const EMAIL_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const EMAIL_ORIGIN = "https://persistence.evans-software-solutions.com";
export const COMPANY_TEXT =
  "Evans Software Solutions Limited · Company number 16938357 · Registered in England and Wales\nRegistered office: 320 Loughborough Road, West Bridgford, Nottingham, England, NG2 7FB";

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function emailUrl(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Email links require an absolute HTTP(S) URL");
  return escapeHtml(url.href);
}

export function emailParagraph(text: string): string {
  return `<p style="margin:0 0 20px;font-size:16px;line-height:26px;overflow-wrap:anywhere;">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

export function emailButton(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 28px;"><tr><td bgcolor="#002c62" height="44" style="background-color:#002c62;border-radius:7px;padding:8px 24px;text-align:center;"><a href="${emailUrl(url)}" style="display:inline-block;color:#fffefb;text-decoration:none;font-size:16px;font-weight:700;line-height:44px;">${escapeHtml(label)}</a></td></tr></table>`;
}

export function emailSummary(
  rows: ReadonlyArray<readonly [string, string]>,
): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1ece2;border:1px solid rgba(23,22,26,0.10);border-radius:7px;margin:4px 0 28px;">${rows.map(([label, value]) => `<tr><td bgcolor="#f1ece2" style="background-color:#f1ece2;padding:10px 16px;font-size:14px;line-height:22px;vertical-align:top;width:32%;">${escapeHtml(label)}</td><td bgcolor="#f1ece2" style="background-color:#f1ece2;padding:10px 16px;font-size:15px;line-height:24px;font-weight:600;overflow-wrap:anywhere;">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

export function emailFooterText(webOrigin = EMAIL_ORIGIN): string {
  const origin = new URL(webOrigin).origin;
  return `${COMPANY_TEXT}\nTerms: ${origin}/terms\nPrivacy: ${origin}/privacy`;
}

export function renderEmailShell(input: {
  title: string;
  preheader?: string;
  bodyHtml: string;
  webOrigin?: string;
}): string {
  const origin = new URL(input.webOrigin ?? EMAIL_ORIGIN).origin;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(input.title)}</title></head><body bgcolor="#f5f2eb" style="margin:0;padding:0;background-color:#f5f2eb;color:#17161a;font-family:${escapeHtml(EMAIL_FONT)};"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#f5f2eb" align="center" style="background-color:#f5f2eb;padding:24px 12px;"><!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#fffefb"><![endif]--><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#fffefb;border:1px solid rgba(23,22,26,0.10);border-radius:7px;"><tr><td bgcolor="#892887" height="4" style="height:4px;line-height:4px;font-size:0;background-color:#892887;background-image:linear-gradient(90deg,#892887,#e94258,#f27224);border-radius:7px 7px 0 0;">&nbsp;</td></tr><tr><td bgcolor="#fffefb" style="background-color:#fffefb;padding:28px 24px 12px;font-size:23px;font-weight:800;letter-spacing:-0.5px;">Persistence<span style="color:#006e92;">.</span></td></tr><tr><td bgcolor="#fffefb" style="background-color:#fffefb;padding:12px 24px 28px;">${input.preheader ? emailParagraph(input.preheader) : ""}${input.bodyHtml}</td></tr><tr><td bgcolor="#efeae0" style="background-color:#efeae0;padding:24px;font-size:12px;line-height:20px;border-radius:0 0 7px 7px;">${escapeHtml(COMPANY_TEXT).replace(/\n/g, "<br>")}<br><a href="${emailUrl(`${origin}/terms`)}" style="color:#002c62;">Terms</a> · <a href="${emailUrl(`${origin}/privacy`)}" style="color:#002c62;">Privacy</a></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

/** Internal notifications retain their existing factual body verbatim. */
export function buildInternalEmail(
  subject: string,
  text: string,
): { subject: string; text: string; html: string } {
  return {
    subject,
    text: `${text}\n\n${emailFooterText()}`,
    html: renderEmailShell({
      title: subject,
      bodyHtml: `<h1 style="margin:0 0 20px;font-size:26px;line-height:34px;">${escapeHtml(subject)}</h1>${emailParagraph(text)}`,
    }),
  };
}
