import { Link } from "react-router";
import type { CSSProperties } from "react";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useReveal } from "@/marketing/hooks";
import { useSeo } from "@/marketing/seo";
import { MailIcon, LifeBuoyIcon } from "@/marketing/icons";
import { CONTACT_EMAIL, SUPPORT_MAILTO } from "@/marketing/config";

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const APPLE_SUBSCRIPTIONS = "https://apps.apple.com/account/subscriptions";

export function Support() {
  const revealRef = useReveal<HTMLDivElement>();
  useSeo({
    title:
      "Support — Persistence Workout & Nutrition App | Help, Billing & Account",
    description:
      "Get help with Persistence: account, billing, subscriptions and bug reports. Contact the UK team directly, or manage your subscription in the App Store.",
    path: "/support",
  });

  return (
    <MarketingLayout>
      <div ref={revealRef}>
        {/* ── Header ── */}
        <section className="ph">
          <div className="c">
            <span className="kicker c-accent center" data-reveal>
              Support
            </span>
            <h1 className="disp" data-reveal style={d(100)}>
              We're here to <span className="it">help.</span>
            </h1>
            <p className="ph-sub" data-reveal style={d(180)}>
              Questions about your account, billing, or something not working as
              expected? Reach the team directly — a real person reads every
              message.
            </p>
          </div>
        </section>

        {/* ── Contact + quick links ── */}
        <section className="sec-pad" style={{ paddingTop: 20 }}>
          <div className="c">
            <div className="support-grid">
              <div className="support-card" data-reveal>
                <h3>
                  <MailIcon />
                  Contact us
                </h3>
                <p>
                  Email us and we'll get back to you, usually within two working
                  days. Including your device model and iOS version helps us
                  resolve issues faster.
                </p>
                <a href={SUPPORT_MAILTO} className="support-email">
                  <MailIcon width={16} height={16} />
                  {CONTACT_EMAIL}
                </a>
              </div>
              <div className="support-card" data-reveal style={d(100)}>
                <h3>
                  <LifeBuoyIcon />
                  Quick links
                </h3>
                <div className="support-links">
                  <a
                    href={APPLE_SUBSCRIPTIONS}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Manage your subscription <span className="arw">↗</span>
                  </a>
                  <Link to="/pricing">
                    Plans &amp; pricing <span className="arw">→</span>
                  </Link>
                  <Link to="/privacy">
                    Privacy policy <span className="arw">→</span>
                  </Link>
                  <Link to="/terms">
                    Terms of service <span className="arw">→</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Common questions ── */}
        <section className="sec-pad faq" id="faq">
          <div className="c">
            <div className="sec-head center" data-reveal>
              <h2 className="disp" style={{ marginTop: 0 }}>
                Common <span className="it">questions.</span>
              </h2>
            </div>
            <div className="faq-grid" data-reveal style={d(80)}>
              <div className="faq-item">
                <h4>How do I cancel my subscription?</h4>
                <p>
                  Subscriptions are billed through your Apple account. Open the
                  App Store, tap your profile, choose Subscriptions, then
                  Persistence — or use{" "}
                  <a
                    href={APPLE_SUBSCRIPTIONS}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Apple's subscription settings
                  </a>
                  . Cancelling stops future renewals; access continues to the
                  end of the paid period.
                </p>
              </div>
              <div className="faq-item">
                <h4>How do I delete my account?</h4>
                <p>
                  You can request deletion any time from the app's profile
                  settings. Your account is deactivated immediately and
                  permanently deleted after 30 days; signing back in during that
                  window restores it. See the{" "}
                  <Link to="/privacy">Privacy policy</Link> for details.
                </p>
              </div>
              <div className="faq-item">
                <h4>Something isn't working — how do I report it?</h4>
                <p>
                  Email <a href={SUPPORT_MAILTO}>{CONTACT_EMAIL}</a> with your
                  device model, iOS version and a short description (a
                  screenshot helps). We triage bug reports quickly.
                </p>
              </div>
              <div className="faq-item">
                <h4>Do you support Android?</h4>
                <p>
                  Persistence is built for iPhone first, with deep HealthKit
                  integration. An Android release on Google Play is planned for
                  later.
                </p>
              </div>
              <div className="faq-item">
                <h4>How is my data handled?</h4>
                <p>
                  We don't sell your personal data or use it for advertising.
                  Read exactly what we collect and why in the{" "}
                  <Link to="/privacy">Privacy policy</Link>.
                </p>
              </div>
              <div className="faq-item">
                <h4>Which plan is right for me?</h4>
                <p>
                  Free covers full logging and nutrition tracking. Premium adds
                  unlimited history, analytics and AI logging; Premium+ adds
                  AnyGym. Compare them on the{" "}
                  <Link to="/pricing">pricing page</Link>.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}

export default Support;
