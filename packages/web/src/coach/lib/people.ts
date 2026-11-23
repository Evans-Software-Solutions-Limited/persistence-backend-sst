/**
 * Names and contact details for the add-client flow (C11a). Pure helpers.
 *
 * The canvas writes "her"/"she" for its sample client. The app never knows a
 * client's pronouns, so copy uses the client's first name or "they" instead.
 */

export function joinName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ");
}

/** Split a stored display name back into first / last for editing. */
export function splitName(displayName: string): {
  first: string;
  last: string;
} {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function firstName(displayName: string): string {
  return splitName(displayName).first;
}

export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,}$/;

export type ContactParse =
  | { kind: "empty" }
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "invalid" };

/** The single "Email or mobile" field (C11a) → the profile's two columns. */
export function parseContact(raw: string): ContactParse {
  const value = raw.trim();
  if (value === "") return { kind: "empty" };
  if (value.includes("@")) {
    return EMAIL_RE.test(value) && value.length <= 320
      ? { kind: "email", value }
      : { kind: "invalid" };
  }
  return PHONE_RE.test(value) && value.length <= 40
    ? { kind: "phone", value }
    : { kind: "invalid" };
}

export function contactOf(profile: {
  contactEmail: string | null;
  contactPhone: string | null;
}): string {
  return profile.contactEmail ?? profile.contactPhone ?? "";
}

/** "2h", "3d", "just now": the roster's Active column. */
export function lastActive(
  iso: string | null,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

/** "09:14" in the coach's local time: the offline banner's "as of". */
export function clockTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
