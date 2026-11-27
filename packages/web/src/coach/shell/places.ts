/** The rail places a coach path belongs to (PER-131 adds Today and Notifications). */

export function placeFor(
  pathname: string,
): "clients" | "library" | "today" | "notifications" {
  if (pathname.startsWith("/coach/library")) return "library";
  if (pathname.startsWith("/coach/today")) return "today";
  if (pathname.startsWith("/coach/notifications")) return "notifications";
  return "clients";
}
