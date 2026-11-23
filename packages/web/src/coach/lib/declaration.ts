/**
 * The coach declaration (design A D6b; Brad, 20 Nov). Confirmed once before a
 * coach's first personal invite, and again whenever the version changes.
 *
 * ⚠ DRAFT WORDING (PER-124). The canvas has no declaration board, so this is
 * a standard statement drafted from common UK practice (CIMSPA-style
 * qualification, professional indemnity + public liability cover, PAR-Q-style
 * screening, scope of practice, data protection). Brad replaces it with the
 * final text. Changing the text means bumping `DECLARATION_VERSION` here AND
 * `COACH_DECLARATION_VERSION` on the API (default `2026-11-v1` in
 * microservices/core/src/application/coaching/declaration.ts), so every coach
 * is asked again. The platform verifies nothing and never says "verified".
 */

export const DECLARATION_VERSION = "2026-11-v1";

export const DECLARATION_TITLE = "Before you invite clients";

export const DECLARATION_INTRO =
  "Persistence doesn't check coaches' qualifications or insurance, and never shows you as verified. Please confirm:";

export const DECLARATION_POINTS: readonly string[] = [
  "I hold recognised qualifications for the coaching I offer, and I only coach within what they cover.",
  "I hold professional indemnity and public liability insurance that covers my coaching, including online and remote coaching.",
  "I'm responsible for screening each client before they start, for example with a health questionnaire such as a PAR-Q, and for asking them to see a doctor or other health professional when their answers call for it.",
  "I won't diagnose or treat medical conditions unless I'm qualified and registered to do so.",
  "I'll keep my clients' information private and only use it to coach them, in line with data protection law.",
];

export const DECLARATION_FOOTNOTE =
  "This doesn't replace your own agreement with each client. We'll ask again if this wording changes.";

export const DECLARATION_CONFIRM_LABEL = "I confirm this is true for me";

/** The exact text the coach confirms, as hashed into their declaration row. */
export function declarationText(): string {
  return [
    DECLARATION_TITLE,
    DECLARATION_INTRO,
    ...DECLARATION_POINTS.map((p) => `- ${p}`),
    DECLARATION_FOOTNOTE,
  ].join("\n");
}

/** SHA-256 hex of the text; undefined where Web Crypto isn't available. */
export async function declarationTextHash(
  text: string = declarationText(),
): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function needsDeclaration(status: {
  currentVersion: string;
  acceptedVersion: string | null;
}): boolean {
  return status.acceptedVersion !== status.currentVersion;
}
