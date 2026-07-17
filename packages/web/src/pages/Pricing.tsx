import { Link } from "react-router";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useReveal } from "@/marketing/hooks";
import { useSeo } from "@/marketing/seo";
import { CheckIcon, SeatsIcon } from "@/marketing/icons";
import { TEAMS_MAILTO } from "@/marketing/config";

type Cycle = "m" | "y";
const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/** GBP formatting: thousands separators, 2dp only when non-integer. */
function fmt(n: number): string {
  return n % 1 === 0
    ? n.toLocaleString("en-GB")
    : n.toLocaleString("en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

function BillingToggle({
  cycle,
  onChange,
}: {
  cycle: Cycle;
  onChange: (c: Cycle) => void;
}) {
  const mRef = useRef<HTMLButtonElement>(null);
  const yRef = useRef<HTMLButtonElement>(null);
  const [knob, setKnob] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    const btn = cycle === "m" ? mRef.current : yRef.current;
    if (!btn) return;
    setKnob({
      width: btn.offsetWidth,
      transform: `translateX(${btn.offsetLeft - 5}px)`,
    });
  }, [cycle]);

  useEffect(() => {
    const onResize = () => {
      const btn = cycle === "m" ? mRef.current : yRef.current;
      if (!btn) return;
      setKnob({
        width: btn.offsetWidth,
        transform: `translateX(${btn.offsetLeft - 5}px)`,
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [cycle]);

  return (
    <div className="toggle-wrap" data-reveal style={d(240)}>
      <div className="toggle">
        <span className="knob" style={knob} />
        <button
          ref={mRef}
          type="button"
          className={cycle === "m" ? "on" : undefined}
          onClick={() => onChange("m")}
        >
          Monthly
        </button>
        <button
          ref={yRef}
          type="button"
          className={cycle === "y" ? "on" : undefined}
          onClick={() => onChange("y")}
        >
          Annual
        </button>
      </div>
      <span className="save-pill">
        Annual saves ~2 months on every paid plan
      </span>
    </div>
  );
}

function PlanPrice({ m, y, cycle }: { m: number; y: number; cycle: Cycle }) {
  const annual = cycle === "y";
  return (
    <>
      <div className="plan-price">
        <span className="cur">£</span>
        <span className="amt">{fmt(annual ? y : m)}</span>
        <span className="per">{annual ? "/yr" : "/mo"}</span>
      </div>
      <div className="plan-sub">
        {annual ? (
          <>
            ≈ £{fmt(Number((y / 12).toFixed(2)))}/mo · <b>2 months free</b>
          </>
        ) : (
          "Billed monthly"
        )}
      </div>
    </>
  );
}

/** Consumer/coach subscription CTA — non-linking until the app is live. */
function SoonCta({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`btn ${className} btn-block cta-soon`}
      aria-disabled="true"
    >
      {label}
    </span>
  );
}

function Feat({ children, head }: { children: ReactNode; head?: boolean }) {
  if (head) return <li className="head">{children}</li>;
  return (
    <li>
      <CheckIcon className="chk" />
      <span>{children}</span>
    </li>
  );
}

export function Pricing() {
  const revealRef = useReveal<HTMLDivElement>();
  const [cycle, setCycle] = useState<Cycle>("m");
  useSeo({
    title:
      "Pricing — Persistence Gym & Coaching App | Free, Premium & Premium+ (GBP)",
    description:
      "Simple GBP pricing for athletes, coaches and teams. Free forever, Premium from £12.99/mo, Premium+ with AnyGym, plus three coach tiers and Persistence for Teams.",
    path: "/pricing",
  });

  return (
    <MarketingLayout current="pricing">
      <div ref={revealRef}>
        {/* ── Header ── */}
        <section className="ph">
          <div className="c">
            <span className="kicker c-accent center" data-reveal>
              Pricing
            </span>
            <h1 className="disp" data-reveal style={d(100)}>
              One app. <span className="it">Every</span> athlete,
              <br />
              coach and team.
            </h1>
            <p className="ph-sub" data-reveal style={d(180)}>
              Start free — including 3 AI workout generations, no card needed.
              Upgrade when you're ready. Coaches and organisations get
              purpose-built plans.
            </p>
            <BillingToggle cycle={cycle} onChange={setCycle} />
          </div>
        </section>

        {/* ── Athlete plans ── */}
        <section className="sec-pad" id="athletes">
          <div className="c">
            <div className="sec-head center" data-reveal>
              <span className="kicker c-accent center">For athletes</span>
              <h2 className="disp">
                Train at your <span className="it">level.</span>
              </h2>
            </div>
            <div className="plans">
              {/* Free */}
              <div className="plan" data-reveal>
                <div className="plan-name">Free</div>
                <div className="plan-status live">Live at launch</div>
                <div className="plan-price">
                  <span className="cur">£</span>
                  <span className="amt">0</span>
                  <span className="per">forever</span>
                </div>
                <div className="plan-sub">No card required</div>
                <p className="plan-desc">
                  Everything you need to log workouts and track nutrition — plus
                  a taste of AI.
                </p>
                <ul className="plan-feats">
                  <Feat>Full workout &amp; set logging</Feat>
                  <Feat>Nutrition tracking &amp; barcode scanner</Feat>
                  <Feat>Streaks, PRs &amp; core progress</Feat>
                  <Feat>
                    <b>3 free AI workout generations</b> — scan your gym and let
                    AnyGym build your first sessions
                  </Feat>
                </ul>
                <SoonCta label="Coming to the App Store" className="btn-line" />
              </div>

              {/* Premium */}
              <div className="plan feature" data-reveal style={d(100)}>
                <span className="plan-ribbon cyan">Most popular</span>
                <div className="plan-name">Premium</div>
                <div className="plan-status live">Live at launch</div>
                <PlanPrice m={12.99} y={129.99} cycle={cycle} />
                <p className="plan-desc">
                  The complete tracking experience with unlimited AI assistance
                  and deep analytics.
                </p>
                <ul className="plan-feats">
                  <Feat head>Everything in Free, plus</Feat>
                  <Feat>Unlimited workouts &amp; history</Feat>
                  <Feat>Advanced analytics + data export</Feat>
                  <Feat>Snap AI nutrition logging</Feat>
                  <Feat>AI session summaries</Feat>
                </ul>
                <SoonCta
                  label="Coming to the App Store"
                  className="btn-accent"
                />
              </div>

              {/* Premium+ */}
              <div className="plan flagship" data-reveal style={d(200)}>
                <span className="plan-ribbon gold">Flagship · AnyGym</span>
                <div className="plan-name">Premium+</div>
                <div className="plan-status soon">Launches w/c 17 Aug</div>
                <PlanPrice m={19.99} y={199.99} cycle={cycle} />
                <p className="plan-desc">
                  The full adaptive suite. Scan your gym and Persistence builds
                  a workout around exactly what's there.
                </p>
                <ul className="plan-feats">
                  <Feat head>Everything in Premium, plus</Feat>
                  <Feat>
                    <b>AI workout generation</b>
                  </Feat>
                  <Feat>
                    <b>AnyGym equipment scan</b> — equipment-aware programming
                  </Feat>
                  <Feat>Smart swap suggestions</Feat>
                  <Feat>Program import</Feat>
                </ul>
                <SoonCta label="Launches w/c 17 Aug" className="btn-line" />
              </div>
            </div>
          </div>
        </section>

        {/* ── Coach plans ── */}
        <section
          className="sec-pad"
          id="coaches"
          style={{ borderTop: "1px solid var(--m-line)" }}
        >
          <div className="c">
            <div className="sec-head center violet" data-reveal>
              <span className="kicker c-violet center">For coaches</span>
              <h2 className="disp">
                Grow your <span className="it">roster.</span>
              </h2>
              <p>
                Every coach plan includes the AI client-insights buddy and
                trainer analytics. Pick the plan that matches your client load.
              </p>
            </div>
            <div className="plans">
              {/* Individual Trainer */}
              <div className="plan coach" data-reveal>
                <div className="plan-name">Individual Trainer</div>
                <div className="plan-status">For getting started</div>
                <PlanPrice m={14.99} y={149.99} cycle={cycle} />
                <span className="seats">
                  <SeatsIcon width={14} height={14} />
                  Up to 2 clients
                </span>
                <ul className="plan-feats">
                  <Feat>Client roster &amp; invite flow</Feat>
                  <Feat>Programme assignment</Feat>
                  <Feat>AI client-insights buddy</Feat>
                  <Feat>Trainer analytics</Feat>
                </ul>
                <SoonCta label="Coming to the App Store" className="btn-line" />
              </div>

              {/* Small Business */}
              <div className="plan coach feature" data-reveal style={d(100)}>
                <span className="plan-ribbon violet">Recommended</span>
                <div className="plan-name">Small Business</div>
                <div className="plan-status">For growing studios</div>
                <PlanPrice m={75} y={750} cycle={cycle} />
                <span className="seats">
                  <SeatsIcon width={14} height={14} />
                  Up to 30 clients
                </span>
                <ul className="plan-feats">
                  <Feat head>Everything in Individual, plus</Feat>
                  <Feat>Manage up to 30 active clients</Feat>
                  <Feat>Reusable programme library</Feat>
                  <Feat>Priority support</Feat>
                </ul>
                <SoonCta
                  label="Coming to the App Store"
                  className="btn-violet"
                />
              </div>

              {/* Enterprise */}
              <div className="plan coach" data-reveal style={d(200)}>
                <div className="plan-name">Enterprise</div>
                <div className="plan-status">For large teams</div>
                <PlanPrice m={300} y={3000} cycle={cycle} />
                <span className="seats">
                  <SeatsIcon width={14} height={14} />
                  Up to 500 clients
                </span>
                <ul className="plan-feats">
                  <Feat head>Everything in Small Business, plus</Feat>
                  <Feat>Manage up to 500 active clients</Feat>
                  <Feat>Multi-coach seats</Feat>
                  <Feat>Dedicated onboarding</Feat>
                </ul>
                <a href={TEAMS_MAILTO} className="btn btn-line btn-block">
                  Talk to us
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ── Teams / B2B ── */}
        <section className="sec-pad teams" id="teams">
          <div className="c">
            <div className="teams-card" data-reveal>
              <div className="teams-grid">
                <div className="teams-left">
                  <span className="kicker c-accent">Persistence for Teams</span>
                  <h2 className="disp">
                    Fitness that <span className="it">travels</span> with your
                    people.
                  </h2>
                  <p>
                    With AnyGym, your people keep their programme no matter
                    where they train — any equipment, any location. Give your
                    organisation Persistence seats and everyone stays
                    consistent, wherever the day takes them.
                  </p>
                  <div className="teams-use">
                    <span>Corporate wellness &amp; HR benefits</span>
                    <span>Sports teams &amp; clubs</span>
                    <span>Physios &amp; clinics</span>
                  </div>
                  <div className="teams-ctas">
                    <a href={TEAMS_MAILTO} className="btn btn-fill">
                      Contact sales
                    </a>
                    <Link to="/#anygym" className="btn btn-line">
                      See how AnyGym works
                    </Link>
                  </div>
                  <p className="teams-fine">
                    Seat pricing set per pilot · billed by invoice · minimum
                    terms apply
                  </p>
                </div>
                <div className="teams-right">
                  <div className="teams-stat">
                    <span className="n">Any gym</span>
                    <span className="l">
                      Programmes adapt to whatever equipment is on site
                    </span>
                  </div>
                  <div className="teams-divide" />
                  <div className="teams-stat">
                    <span className="n">Volume</span>
                    <span className="l">
                      Custom seat bundles for your headcount
                    </span>
                  </div>
                  <div className="teams-divide" />
                  <div className="teams-stat">
                    <span className="n">Pilot-first</span>
                    <span className="l">
                      Start small, prove the value, then roll out
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="sec-pad faq" id="faq">
          <div className="c">
            <div className="sec-head center" data-reveal>
              <h2 className="disp" style={{ marginTop: 0 }}>
                Good to <span className="it">know.</span>
              </h2>
            </div>
            <div className="faq-grid" data-reveal style={d(80)}>
              <div className="faq-item">
                <h4>Do I need a card to start?</h4>
                <p>
                  No. The Free plan is free forever and includes 3 AI workout
                  generations so you can try AnyGym before deciding.
                </p>
              </div>
              <div className="faq-item">
                <h4>What's the difference between Premium and Premium+?</h4>
                <p>
                  Premium gives you unlimited tracking plus Snap AI nutrition
                  logging and AI session summaries. Premium+ adds the full
                  adaptive suite — AI workout generation, AnyGym equipment scan,
                  smart swaps and program import.
                </p>
              </div>
              <div className="faq-item">
                <h4>When does Premium+ arrive?</h4>
                <p>
                  Premium+ launches the week commencing 17 August. Free and
                  Premium are available from launch on the App Store.
                </p>
              </div>
              <div className="faq-item">
                <h4>Is annual really cheaper?</h4>
                <p>
                  Yes — annual billing works out to roughly two months free
                  versus paying monthly, on every paid plan.
                </p>
              </div>
              <div className="faq-item">
                <h4>How do I subscribe and manage billing?</h4>
                <p>
                  Persistence is iPhone-first. Subscriptions are purchased and
                  billed through your Apple account and can be managed or
                  cancelled any time in the App Store.
                </p>
              </div>
              <div className="faq-item">
                <h4>How does Teams billing work?</h4>
                <p>
                  Teams is pilot-driven with per-seat pricing set for your
                  organisation and billed by invoice.{" "}
                  <a href={TEAMS_MAILTO}>Contact sales →</a>
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}

export default Pricing;
