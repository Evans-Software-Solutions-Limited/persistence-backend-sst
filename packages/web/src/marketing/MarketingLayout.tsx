import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import "./fonts";
import "./marketing.css";
import { MarketingNav } from "./MarketingNav";
import { MarketingFooter } from "./MarketingFooter";

/**
 * Shell for every marketing page: scoped `.mkt` root (so its warm editorial
 * theme never leaks onto /privacy, /terms or /login), fixed background glow +
 * film-grain layers, fixed nav and shared footer. Also resolves `#hash`
 * targets after client-side navigation (react-router doesn't scroll to hashes
 * on its own).
 */
export function MarketingLayout({
  children,
  current,
}: {
  children: ReactNode;
  current?: "pricing";
}) {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    // Guard against a bare "#" or any non-selector hash before querySelector.
    if (hash.length > 1) {
      const el = document.querySelector(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    <div className="mkt">
      <div className="mkt-bg" aria-hidden="true" />
      <MarketingNav current={current} />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
