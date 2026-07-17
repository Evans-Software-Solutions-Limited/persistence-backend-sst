/**
 * Pure-CSS iPhone mock for the hero — mirrors the REAL app Home screen
 * (packages/mobile HomePresenter / TodayHeroPresenter): a "TODAY" greeting
 * header, the 3-ring Move/Train/Fuel hero with a Move/Train/Fuel legend, the
 * streak/water/strain/sleep micro strip, a "Your workouts" section, and the
 * Home/Train/Fuel/You tab bar. Values are representative; when a real
 * screenshot is available it renders in place instead (see `screenshot`).
 */
import type { CSSProperties } from "react";

// Ring geometry (viewBox 120): circumference C = 2πr; fg offset = C·(1−pct).
const rings = [
  { r: 52, c: 326.73, pct: 0.85, color: "#4FE3F0" }, // Move
  { r: 41, c: 257.61, pct: 0.62, color: "#FF9A5A" }, // Train
  { r: 30, c: 188.5, pct: 0.8, color: "#F2C94C" }, // Fuel
];

export function PhoneMock({ screenshot }: { screenshot?: string | null }) {
  return (
    <div className="hero-phone" data-reveal style={{ "--d": "300ms" } as CSSProperties}>
      <div className="phone-halo" />
      <div className="phone-frame">
        <div className="phone-notch" />
        <div className="phone-screen">
          {screenshot ? (
            <img className="phone-shot" src={screenshot} alt="Persistence app screen" />
          ) : (
            <div className="app-ui">
              <div className="app-status">
                <span className="t">9:41</span>
                <span className="d" />
              </div>

              {/* Header — TODAY / greeting + name / bell */}
              <div className="app-topbar">
                <span className="app-ava">A</span>
                <div className="app-title">
                  <span className="app-eyebrow">TODAY</span>
                  <span className="app-greet">
                    Good morning, <b>Alex</b>
                  </span>
                </div>
                <span className="app-bell">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>

              {/* 3-ring hero */}
              <div className="app-hero">
                <div className="app-rings">
                  <svg viewBox="0 0 120 120" aria-hidden="true">
                    {rings.map((ring) => (
                      <circle
                        key={`bg-${ring.r}`}
                        cx="60"
                        cy="60"
                        r={ring.r}
                        fill="none"
                        stroke="rgba(244,241,234,0.08)"
                        strokeWidth="7"
                      />
                    ))}
                    {rings.map((ring) => (
                      <circle
                        key={`fg-${ring.r}`}
                        className="app-ring-fg"
                        cx="60"
                        cy="60"
                        r={ring.r}
                        fill="none"
                        stroke={ring.color}
                        strokeWidth="7"
                        strokeLinecap="round"
                        strokeDasharray={ring.c}
                        strokeDashoffset={ring.c * (1 - ring.pct)}
                      />
                    ))}
                  </svg>
                  <div className="app-rings-center">
                    <span className="e">TODAY</span>
                    <b>73%</b>
                  </div>
                </div>
                <div className="app-legend">
                  <div className="leg">
                    <i style={{ background: "#4FE3F0" }} />
                    <span className="lk">MOVE</span>
                    <span className="lv">
                      512 <em>kcal</em>
                    </span>
                  </div>
                  <div className="leg">
                    <i style={{ background: "#FF9A5A" }} />
                    <span className="lk">TRAIN</span>
                    <span className="lv">
                      14 <em>sets</em>
                    </span>
                  </div>
                  <div className="leg">
                    <i style={{ background: "#F2C94C" }} />
                    <span className="lk">FUEL</span>
                    <span className="lv">
                      1,850 <em>kcal</em>
                    </span>
                  </div>
                </div>
              </div>

              {/* Micro strip */}
              <div className="app-micro">
                <span className="mp ember">
                  🔥 23 <i>streak</i>
                </span>
                <span className="mp cyan">
                  1.8L <i>water</i>
                </span>
                <span className="mp violet">
                  12 <i>strain</i>
                </span>
                <span className="mp green">
                  7h20 <i>sleep</i>
                </span>
              </div>

              {/* Your workouts */}
              <div className="app-sec">
                <div className="app-sec-head">
                  <span className="e">TODAY</span>
                  <b>Your workouts</b>
                  <span className="a">View all</span>
                </div>
                <div className="app-wo">
                  <span className="app-wo-ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="2" y="9" width="4" height="6" rx="1" />
                      <rect x="18" y="9" width="4" height="6" rx="1" />
                      <line x1="6" y1="12" x2="18" y2="12" />
                    </svg>
                  </span>
                  <div className="app-wo-info">
                    <b>Upper Push</b>
                    <span>8 exercises · ~55 min</span>
                  </div>
                  <span className="app-wo-go">›</span>
                </div>
              </div>

              {/* Tab bar — Home / Train / Fuel / You */}
              <nav className="app-tabs" aria-hidden="true">
                <span className="app-tab active">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 10.5 12 3l9 7.5" />
                    <path d="M5 9.5V21h14V9.5" />
                  </svg>
                  Home
                </span>
                <span className="app-tab">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="2" y="9" width="4" height="6" rx="1" />
                    <rect x="18" y="9" width="4" height="6" rx="1" />
                    <line x1="6" y1="12" x2="18" y2="12" />
                  </svg>
                  Train
                </span>
                <span className="app-tab">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 7c1-2 3-3 5-2 2 2 1 6-1 9-1 1.5-2 3-4 3s-3-1.5-4-3c-2-3-3-7-1-9 2-1 4 0 5 2z" />
                    <path d="M12 7c0-2 1-4 3-4" />
                  </svg>
                  Fuel
                </span>
                <span className="app-tab">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                  You
                </span>
              </nav>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
