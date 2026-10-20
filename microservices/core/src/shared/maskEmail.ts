/**
 * Mask an address for a public thanks page: `sam•••@ex•••••.test`.
 *
 * The checkout status endpoints (founding, Blue Light Card) are public and
 * keyed only by a Stripe Session id that travels in a URL, so they must
 * confirm "we have your payment" without handing the address to anyone who
 * gets hold of that link.
 *
 * The kept prefix scales with length rather than being a fixed two characters:
 * `jo@company.com` would otherwise be printed in full, which is no masking at
 * all for exactly the short addresses most likely to be someone's name. The
 * domain is masked too, keeping only its first characters and its public
 * suffix — a rare domain identifies a person nearly as well as their name.
 */
function maskPart(value: string, keep: number): string {
  const head = value.slice(0, Math.min(keep, Math.max(0, value.length - 1)));
  return `${head}${"•".repeat(Math.max(1, value.length - head.length))}`;
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const [name, suffix] =
    dot > 0 ? [domain.slice(0, dot), domain.slice(dot)] : [domain, ""];
  return `${maskPart(local, Math.min(3, Math.floor(local.length / 2)))}@${maskPart(
    name,
    2,
  )}${suffix}`;
}
