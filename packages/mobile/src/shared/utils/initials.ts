/**
 * initialsOf — derive up-to-two uppercase initials from a full name.
 *
 * Spec: specs/08-profile-settings/design.md § A (hook reality-map — no
 *       `initials` field on the profile payload; derive from `fullName`)
 *
 * Mirrors the avatar-initials behaviour the navigation headers already use.
 * Takes the first letter of the first two whitespace-split tokens, uppercased.
 * Falls back to `"–"` (en dash) when the name is null/empty/whitespace — the
 * same placeholder the drawer's loading state and `<Avatar>` use.
 */
export function initialsOf(fullName: string | null | undefined): string {
  if (fullName == null) return "–";
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "–";

  const letters = tokens
    .slice(0, 2)
    .map((t) => t[0]?.toUpperCase() ?? "")
    .join("");

  return letters.length > 0 ? letters : "–";
}
