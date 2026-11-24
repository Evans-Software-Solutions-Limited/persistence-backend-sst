import type { SetupItem, SetupSection } from "../api/types";

/**
 * Draft rules for the set-up step: when a section's edits differ from what is
 * saved, and whether they can be saved. Pure, so the container's "moving on
 * saves" behaviour is tested without a browser.
 */

/** The 409 state (design A D6): the server copy replaces ours. */
export const CONFLICT_NOTICE =
  "Updated on another device. You're seeing the latest.";

function canonical(items: SetupItem[]): string {
  return JSON.stringify(
    items.map((i, index) => ({
      refId: i.refId ?? null,
      config: sortKeys(i.config ?? {}),
      sortOrder: index,
    })),
  );
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function sameItems(a: SetupItem[], b: SetupItem[]): boolean {
  return canonical(a) === canonical(b);
}

const MAX_KCAL = 20_000;
const MAX_MACRO_G = 2_000;

/** A message when the draft can't be saved as it is; null when it can. */
export function draftError(
  section: SetupSection,
  items: SetupItem[],
): string | null {
  if (section === "nutrition_target" && items.length > 0) {
    const c = items[0].config;
    const keys = ["dailyKcal", "proteinG", "carbsG", "fatG"] as const;
    for (const key of keys) {
      const v = c[key];
      const max = key === "dailyKcal" ? MAX_KCAL : MAX_MACRO_G;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) {
        return "Enter calories and all three macros, or choose who sets them.";
      }
    }
  }
  if (section === "welcome_message" && items.length > 0) {
    const text = String(
      (items[0].config.text as string | undefined) ?? "",
    ).trim();
    if (text.length > 1000) return "Keep the message under 1,000 characters.";
  }
  return null;
}

/** What is sent: trimmed welcome text, an empty one removed. */
export function itemsToSave(
  section: SetupSection,
  items: SetupItem[],
): SetupItem[] {
  const renumbered = items.map((i, index) => ({ ...i, sortOrder: index }));
  if (section === "welcome_message") {
    const text = String(
      (renumbered[0]?.config.text as string | undefined) ?? "",
    ).trim();
    return text ? [{ refId: null, sortOrder: 0, config: { text } }] : [];
  }
  return renumbered;
}

/**
 * Only an invited (or cancelled) profile can still be edited. A 409 resend
 * must not go to a profile the client has just accepted: the 409 handler then
 * stores it and the screen moves to the client's page.
 */
export function stillEditable(profile: { status: string }): boolean {
  return profile.status === "invited" || profile.status === "cancelled";
}
