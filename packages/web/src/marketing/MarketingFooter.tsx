import { Link } from "react-router";
import { COMPANY, COMPANY_URL } from "./config";
import { SectionLink } from "./SectionLink";

export function MarketingFooter() {
  return (
    <footer>
      <div className="c">
        <div className="footer-top">
          <div>
            <Link to="/" className="logo">
              <img
                className="logo-mark"
                src="/apple-touch-icon.png"
                alt=""
                aria-hidden="true"
              />
              Persistence
            </Link>
            <div className="footer-brand-text">
              <p>
                The training and nutrition companion for serious athletes and the coaches
                who guide them.
              </p>
            </div>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <SectionLink hash="pillars">Features</SectionLink>
            <SectionLink hash="anygym">AnyGym</SectionLink>
            <SectionLink hash="coach">For coaches</SectionLink>
            <Link to="/pricing">Pricing</Link>
          </div>
          <div className="footer-col">
            <h4>Company</h4>
            <Link to="/support">Support</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer">
              Evans Software Solutions ↗
            </a>
          </div>
        </div>
        <div className="footer-bar">
          <span className="footer-copy">© 2026 {COMPANY}</span>
          <span className="footer-made">Built in Nottingham, UK</span>
        </div>
      </div>
    </footer>
  );
}
