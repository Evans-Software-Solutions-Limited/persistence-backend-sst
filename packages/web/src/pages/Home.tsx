import { Link } from "react-router";
import type { CSSProperties, PointerEvent } from "react";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { PhoneMock } from "@/marketing/PhoneMock";
import { useReveal } from "@/marketing/hooks";
import { useSeo } from "@/marketing/seo";
import { heroScreenshot } from "@/marketing/config";
import {
  AppleIcon,
  GooglePlayIcon,
  CheckIcon,
  DumbbellIcon,
  FlameIcon,
  TrendIcon,
  UsersIcon,
  FileIcon,
  BarsIcon,
  PinIcon,
  WifiOffIcon,
  MarqueeIcon,
} from "@/marketing/icons";

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const MARQUEE: { d: string; label: string }[] = [
  { d: "M9 11l3 3L22 4", label: "Offline-first" },
  { d: "M3 3v18h18", label: "146k UK foods" },
  { d: "M12 2v20M2 12h20", label: "Barcode scanner" },
  { d: "M20 6L9 17l-5-5", label: "Automatic PRs" },
  { d: "M22 12h-4l-3 9L9 3l-3 9H2", label: "HealthKit native" },
  { d: "M17 21v-2a4 4 0 0 0-4-4H5", label: "Coach mode" },
  { d: "M13 2L3 14h9l-1 8 10-12h-9z", label: "Rest timer haptics" },
  { d: "M18 20V10M12 20V4M6 20v-6", label: "Advanced analytics" },
];

/** Cursor-following spotlight on the pillar cards. */
function onPillarMove(e: PointerEvent<HTMLDivElement>) {
  const card = e.currentTarget;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
}

export function Home() {
  const revealRef = useReveal<HTMLDivElement>();
  useSeo({
    title:
      "Persistence — Workout & Nutrition Tracking App (UK) | Train · Fuel · Coach",
    description:
      "The UK workout and nutrition tracking app for serious athletes and coaches. Offline-first logging, 146k UK foods, barcode scanner, automatic PRs, HealthKit sync and built-in coach mode. iPhone-first.",
    path: "/",
  });

  return (
    <MarketingLayout>
      <div ref={revealRef}>
        {/* ── Hero ── */}
        <section className="hero">
          <div className="c">
            <div className="hero-grid">
              <div className="hero-text">
                <span className="kicker c-accent" data-reveal style={d(40)}>
                  Workout · Nutrition · Coaching
                </span>
                <h1 data-reveal style={d(120)}>
                  Train smarter.
                  <br />
                  Fuel better.
                  <br />
                  <span className="it">Track everything.</span>
                </h1>
                <p className="hero-sub" data-reveal style={d(220)}>
                  The training and nutrition companion built for athletes who
                  take it seriously — and the coaches who need real visibility
                  into their clients.
                </p>
                <div className="hero-ctas" data-reveal style={d(300)}>
                  <span className="btn btn-fill cta-soon" aria-disabled="true">
                    <AppleIcon />
                    Coming to the App Store
                  </span>
                  <a href="#coach" className="btn btn-line">
                    For coaches
                  </a>
                </div>
                <div className="hero-proof" data-reveal style={d(380)}>
                  <span className="proof-chip">
                    <WifiOffIcon />
                    <b>Offline-first</b> — train with zero signal
                  </span>
                  <div className="proof-div" />
                  <span className="proof-chip">
                    <CheckIcon />
                    <b>Start free</b> — no card needed
                  </span>
                </div>
              </div>
              <PhoneMock screenshot={heroScreenshot} />
            </div>
          </div>
        </section>

        {/* ── Marquee ── */}
        <div className="strip">
          <div className="strip-mask">
            <div className="marquee">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span className="m-item" key={i}>
                  <MarqueeIcon d={m.d} />
                  {m.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Pillars ── */}
        <section className="sec-pad" id="pillars">
          <div className="c">
            <div className="sec-head">
              <div>
                <span className="kicker" data-reveal>
                  The system
                </span>
                <h2
                  className="disp"
                  data-reveal
                  style={{ ...d(80), marginTop: 20 }}
                >
                  Three disciplines.
                  <br />
                  <span className="it">One loop.</span>
                </h2>
              </div>
              <p data-reveal style={d(160)}>
                Everything an athlete does compounds. Persistence closes the
                loop between the work, the fuel, and the proof.
              </p>
            </div>
            <div className="pillars">
              <div
                className="pillar"
                data-reveal
                style={{ "--glow": "79,227,240" } as CSSProperties}
                onPointerMove={onPillarMove}
              >
                <span className="pillar-num">01</span>
                <div className="pillar-icon cyan">
                  <DumbbellIcon />
                </div>
                <h3>Train</h3>
                <p>
                  Log every set, track every rep. Offline-first, so the gym's
                  dead signal never breaks your flow.
                </p>
                <ul>
                  <li>
                    <CheckIcon />
                    Smart rest timers with haptics
                  </li>
                  <li>
                    <CheckIcon />
                    Automatic PR detection
                  </li>
                  <li>
                    <CheckIcon />
                    Programme templates
                  </li>
                </ul>
              </div>
              <div
                className="pillar"
                data-reveal
                style={{ ...d(120), "--glow": "255,154,90" } as CSSProperties}
                onPointerMove={onPillarMove}
              >
                <span className="pillar-num">02</span>
                <div className="pillar-icon ember">
                  <FlameIcon />
                </div>
                <h3>Fuel</h3>
                <p>
                  Barcode scanner, macro rings and 146k UK foods. Nutrition
                  tracking that never gets in the way.
                </p>
                <ul>
                  <li>
                    <CheckIcon />
                    146k UK food database
                  </li>
                  <li>
                    <CheckIcon />
                    Instant barcode scanning
                  </li>
                  <li>
                    <CheckIcon />
                    Snap AI nutrition logging
                  </li>
                </ul>
              </div>
              <div
                className="pillar"
                data-reveal
                style={{ ...d(240), "--glow": "242,201,76" } as CSSProperties}
                onPointerMove={onPillarMove}
              >
                <span className="pillar-num">03</span>
                <div className="pillar-icon gold">
                  <TrendIcon />
                </div>
                <h3>Progress</h3>
                <p>
                  Streaks, volume trends, body composition and achievements. See
                  the compound effect of the work.
                </p>
                <ul>
                  <li>
                    <CheckIcon />
                    Volume &amp; strength trends
                  </li>
                  <li>
                    <CheckIcon />
                    Body composition tracking
                  </li>
                  <li>
                    <CheckIcon />
                    HealthKit sync
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── AnyGym ── */}
        <section className="sec-pad anygym" id="anygym">
          <div className="c">
            <div className="anygym-grid">
              <div className="anygym-left">
                <span className="kicker c-accent" data-reveal>
                  AnyGym · Premium+
                </span>
                <div className="soon-badge" data-reveal style={d(60)}>
                  Coming soon
                </div>
                <h2 className="disp" data-reveal style={d(80)}>
                  Any gym. Any kit.
                  <br />
                  <span className="it">Same programme.</span>
                </h2>
                <p data-reveal style={d(160)}>
                  Scan your gym or tell Persistence what you've got. AnyGym
                  rebuilds today's session around exactly what's in front of you
                  — a hotel gym, a garage rack, or a single barbell. Never skip
                  a session for the lack of the right machine again.
                </p>
                <div className="anygym-steps" data-reveal style={d(220)}>
                  <div className="anystep">
                    <span className="anystep-n">1</span>
                    <div>
                      <b>Scan or tell it</b>
                      <span>
                        Point your camera at the gym, or pick the kit you have
                        on hand.
                      </span>
                    </div>
                  </div>
                  <div className="anystep">
                    <span className="anystep-n">2</span>
                    <div>
                      <b>AnyGym adapts</b>
                      <span>
                        Your programme is re-mapped to available equipment —
                        same targets, matched movements.
                      </span>
                    </div>
                  </div>
                  <div className="anystep">
                    <span className="anystep-n">3</span>
                    <div>
                      <b>Train &amp; stay on plan</b>
                      <span>
                        Progress keeps counting toward your goals, wherever you
                        are.
                      </span>
                    </div>
                  </div>
                </div>
                <Link
                  to="/pricing#teams"
                  className="anygym-b2b"
                  data-reveal
                  style={d(300)}
                >
                  <span>
                    For teams whose people are always <b>on the move</b>
                  </span>
                  <span className="go">
                    Persistence for Teams <span className="arw">→</span>
                  </span>
                </Link>
              </div>
              <div className="anymock" data-reveal style={d(200)}>
                <div className="anymock-head">
                  <span className="lbl">Today · Upper body</span>
                  <span className="loc">
                    <PinIcon width={12} height={12} />
                    Hotel gym
                  </span>
                </div>
                <div className="anychips">
                  <div className="anychip">
                    <CheckIcon />
                    Dumbbells
                  </div>
                  <div className="anychip">
                    <CheckIcon />
                    Bench
                  </div>
                  <div className="anychip">
                    <CheckIcon />
                    Cable machine
                  </div>
                  <div className="anychip off">No barbell</div>
                  <div className="anychip off">No leg press</div>
                </div>
                <div className="anydivide">
                  <span className="ln" />
                  <span className="tx">↓ Adapted for you</span>
                  <span className="ln" />
                </div>
                <div className="anyworkout">
                  <div className="anyex">
                    <span className="ix">A1</span>
                    <span className="nm">Dumbbell bench press</span>
                    <span className="st">4 × 8</span>
                  </div>
                  <div className="anyex">
                    <span className="ix">A2</span>
                    <span className="nm">Single-arm cable row</span>
                    <span className="st">4 × 10</span>
                  </div>
                  <div className="anyex">
                    <span className="ix">B1</span>
                    <span className="nm">Incline DB press</span>
                    <span className="swap">swapped</span>
                    <span className="st">3 × 12</span>
                  </div>
                  <div className="anyex">
                    <span className="ix">B2</span>
                    <span className="nm">Cable face pull</span>
                    <span className="st">3 × 15</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Coach ── */}
        <section className="sec-pad coach" id="coach">
          <div className="c">
            <div className="coach-card" data-reveal>
              <div className="coach-grid">
                <div className="coach-left">
                  <span className="kicker c-violet">For personal trainers</span>
                  <h2 className="disp">
                    Your clients.
                    <br />
                    Your programmes.
                    <br />
                    <span className="it">One place.</span>
                  </h2>
                  <p>
                    A full coach mode, built in — not bolted on. Move your
                    roster off WhatsApp and spreadsheets and into something your
                    clients actually want to open.
                  </p>
                  <div className="coach-feats">
                    <div className="coach-feat">
                      <span className="dot">
                        <UsersIcon width={15} height={15} />
                      </span>
                      <div>
                        <b>Client roster &amp; invites</b>
                        <span>
                          Onboard clients in seconds with a simple invite flow.
                        </span>
                      </div>
                    </div>
                    <div className="coach-feat">
                      <span className="dot">
                        <FileIcon width={15} height={15} />
                      </span>
                      <div>
                        <b>Programme assignment</b>
                        <span>
                          Build once, assign to many, adjust per athlete.
                        </span>
                      </div>
                    </div>
                    <div className="coach-feat">
                      <span className="dot">
                        <BarsIcon width={15} height={15} />
                      </span>
                      <div>
                        <b>Progress visibility</b>
                        <span>
                          See adherence and results without chasing updates.
                        </span>
                      </div>
                    </div>
                  </div>
                  <Link to="/pricing#coaches" className="coach-cta">
                    See coach plans <span className="arw">→</span>
                  </Link>
                </div>
                <div className="coach-right">
                  <div className="roster-label">Coach dashboard · Today</div>
                  <div className="client-row">
                    <div
                      className="client-av"
                      style={{
                        background: "linear-gradient(150deg,#8EEFF7,#0C99A8)",
                      }}
                    >
                      JM
                    </div>
                    <div className="client-info">
                      <b>James M.</b>
                      <span>Push · Pull · Legs</span>
                    </div>
                    <div className="client-prog">
                      <i style={{ width: "82%" }} />
                    </div>
                    <span className="client-badge">✓ on track</span>
                  </div>
                  <div className="client-row">
                    <div
                      className="client-av"
                      style={{
                        background: "linear-gradient(150deg,#CDBCFF,#7C5CE0)",
                      }}
                    >
                      SR
                    </div>
                    <div className="client-info">
                      <b>Sarah R.</b>
                      <span>Hypertrophy · 5d</span>
                    </div>
                    <div className="client-prog">
                      <i
                        style={{ width: "64%", background: "var(--m-violet)" }}
                      />
                    </div>
                    <span className="client-badge">✓ on track</span>
                  </div>
                  <div className="client-row">
                    <div
                      className="client-av"
                      style={{
                        background: "linear-gradient(150deg,#FFC08A,#E07B2E)",
                      }}
                    >
                      TK
                    </div>
                    <div className="client-info">
                      <b>Tom K.</b>
                      <span>Strength · 4d</span>
                    </div>
                    <div className="client-prog">
                      <i
                        style={{ width: "38%", background: "var(--m-ember)" }}
                      />
                    </div>
                    <span className="client-badge behind">2 days behind</span>
                  </div>
                  <div className="client-row">
                    <div
                      className="client-av"
                      style={{
                        background: "linear-gradient(150deg,#9FE6C4,#3F9E76)",
                      }}
                    >
                      LP
                    </div>
                    <div className="client-info">
                      <b>Leah P.</b>
                      <span>Full body · 3d</span>
                    </div>
                    <div className="client-prog">
                      <i
                        style={{ width: "91%", background: "var(--m-success)" }}
                      />
                    </div>
                    <span className="client-badge">✓ on track</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── App store ── */}
        <section className="sec-pad store">
          <div className="c">
            <span className="kicker c-accent center" data-reveal>
              Available on iPhone
            </span>
            <h2
              className="disp"
              data-reveal
              style={{ ...d(80), marginTop: 22 }}
            >
              Your best training,
              <br />
              <span className="it">in your pocket.</span>
            </h2>
            <p className="store-sub" data-reveal style={d(140)}>
              Built offline-first, so your training never waits for a signal.
              Coming to iPhone — the App Store link lands here the day it goes
              live.
            </p>
            <div className="store-btns" data-reveal style={d(200)}>
              <span className="store-btn disabled" aria-disabled="true">
                <AppleIcon />
                <div className="store-btn-text">
                  <span className="small">Coming soon to</span>
                  <span className="big">App Store</span>
                </div>
              </span>
              <span className="store-btn disabled" aria-disabled="true">
                <GooglePlayIcon />
                <div className="store-btn-text">
                  <span className="small">Coming soon to</span>
                  <span className="big">Google Play</span>
                </div>
              </span>
            </div>
            <ul className="feat-grid" data-reveal style={d(260)}>
              <li>
                <CheckIcon />
                Offline-first with SQLite sync
              </li>
              <li>
                <CheckIcon />
                Barcode food scanner (146k UK foods)
              </li>
              <li>
                <CheckIcon />
                HealthKit integration (iOS)
              </li>
              <li>
                <CheckIcon />
                Automatic personal record detection
              </li>
              <li>
                <CheckIcon />
                Rest timer with haptic feedback
              </li>
              <li>
                <CheckIcon />
                Snap AI nutrition logging
              </li>
              <li>
                <CheckIcon />
                Coach mode with client management
              </li>
              <li>
                <CheckIcon />
                Subscription management via App Store
              </li>
            </ul>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}

export default Home;
