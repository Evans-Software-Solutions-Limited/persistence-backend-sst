import { Link, useLocation } from "react-router";
import type { ReactNode } from "react";

/**
 * Links to an in-page section anchor. On the home route it's a plain hash
 * anchor (smooth-scrolls in place); off-home it's a react-router <Link> to
 * `/#hash` so navigation stays client-side (no full reload) — MarketingLayout's
 * hash effect then scrolls to the target.
 */
export function SectionLink({
  hash,
  className,
  children,
}: {
  hash: string;
  className?: string;
  children: ReactNode;
}) {
  const onHome = useLocation().pathname === "/";
  return onHome ? (
    <a href={`#${hash}`} className={className}>
      {children}
    </a>
  ) : (
    <Link to={`/#${hash}`} className={className}>
      {children}
    </Link>
  );
}
