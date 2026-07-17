import { Link } from "react-router";
import { useScrolled } from "./hooks";
import { useTheme } from "@/components/theme-provider";
import { SunIcon, MoonIcon } from "./icons";
import { SectionLink } from "./SectionLink";

/** Wordmark + gradient "P" glyph, links to home. */
function Logo() {
  return (
    <Link to="/" className="logo">
      <img className="logo-mark" src="/apple-touch-icon.png" alt="" aria-hidden="true" />
      Persistence
    </Link>
  );
}

/**
 * Fixed marketing nav. Section links resolve to in-page hash anchors when
 * already on the home route, or to `/#anchor` (navigate home, then scroll)
 * otherwise. The primary CTA is a non-linking "Coming to the App Store" state
 * until the app is live (see config.appStore).
 */
export function MarketingNav({ current }: { current?: "pricing" }) {
  const scrolled = useScrolled();
  const { theme, setTheme } = useTheme();

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <nav className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="nav-c">
        <Logo />
        <div className="nav-r">
          <div className="nav-links">
            <SectionLink hash="pillars">Product</SectionLink>
            <SectionLink hash="anygym">AnyGym</SectionLink>
            <SectionLink hash="coach">For coaches</SectionLink>
            <Link to="/pricing" className={current === "pricing" ? "current" : undefined}>
              Pricing
            </Link>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
          <span className="nav-btn disabled" aria-disabled="true">
            Coming to App Store
          </span>
        </div>
      </div>
    </nav>
  );
}
