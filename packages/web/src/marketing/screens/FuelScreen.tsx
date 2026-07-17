/** Nutrition tab — mirrors packages/mobile FuelPresenter (MacroHero → QuickAdd → MealLog). */
const macros = [
  { k: "PROTEIN", v: 148, t: 180, pct: 0.82, color: "#4FE3F0" }, // primary
  { k: "CARBS", v: 190, t: 300, pct: 0.63, color: "#F2C94C" }, // gold
  { k: "FAT", v: 52, t: 80, pct: 0.65, color: "#FF9A5A" }, // ember
];
// Gold calorie ring (viewBox 120, r 40): C = 251.3, 59% consumed → remaining shown.
const RING_C = 251.3;

export function FuelScreen() {
  return (
    <div className="app-ui">
      <div className="app-status">
        <span className="t">9:41</span>
        <span className="d" />
      </div>

      <div className="app-topbar">
        <div className="app-title">
          <span className="app-eyebrow">MONDAY · MAR 25</span>
          <span className="app-greet">Fuel</span>
        </div>
        <span className="fuel-hicons">◎ ▦</span>
      </div>

      {/* Macro hero */}
      <div className="fuel-hero">
        <div className="fuel-top">
          <div className="fuel-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="40" fill="none" stroke="rgba(244,241,234,0.08)" strokeWidth="11" />
              <circle
                className="app-ring-fg"
                cx="60"
                cy="60"
                r="40"
                fill="none"
                stroke="#F2C94C"
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * 0.41}
              />
            </svg>
            <div className="fuel-ring-c">
              <b>1,240</b>
              <span>REMAINING</span>
            </div>
          </div>
          <div className="fuel-macros">
            {macros.map((m) => (
              <div className="fmac" key={m.k}>
                <div className="fmac-top">
                  <span className="fmac-k">{m.k}</span>
                  <span className="fmac-v">
                    <b>{m.v}</b> / {m.t}g
                  </span>
                </div>
                <div className="fmac-bar">
                  <i style={{ width: `${m.pct * 100}%`, background: m.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="fuel-foot">
          <div>
            <span className="fuel-foot-lbl">
              CONSUMED · TARGET <em>Edit</em>
            </span>
            <span className="fuel-foot-val">
              <b>1,760</b> / 3,000 kcal
            </span>
          </div>
          <span className="fuel-log">＋ Log</span>
        </div>
      </div>

      {/* Quick add */}
      <div className="fuel-qa">
        <span className="fuel-qa-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FE3F0" strokeWidth="2" strokeLinecap="round">
            <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
          </svg>
          Scan
        </span>
        <span className="fuel-qa-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="#F2C94C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Snap
          <i className="fuel-qa-lock" />
        </span>
        <span className="fuel-qa-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FE3F0" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          Search
        </span>
        <span className="fuel-qa-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="#4FE3F0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          Recipes
        </span>
      </div>

      {/* Today's log */}
      <div className="fuel-log-title">Today&apos;s log</div>
      <div className="fuel-meal-card">
        <div className="fuel-meal-head">
          <div>
            <b>Breakfast</b>
            <span>520 kcal</span>
          </div>
          <span className="fuel-meal-add">＋</span>
        </div>
        <div className="fuel-meal-entry">
          <div>
            <span className="fm-name">Oats, banana &amp; whey</span>
            <span className="fm-macros">P 30g · C 62g · F 9g</span>
          </div>
          <span className="fm-kcal">520 kcal</span>
        </div>
      </div>
      <div className="fuel-meal-card">
        <div className="fuel-meal-head">
          <div>
            <b>Lunch</b>
            <span>640 kcal</span>
          </div>
          <span className="fuel-meal-add">＋</span>
        </div>
      </div>

      <nav className="app-tabs" aria-hidden="true">
        <span className="app-tab">
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
        <span className="app-tab active">
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
  );
}
