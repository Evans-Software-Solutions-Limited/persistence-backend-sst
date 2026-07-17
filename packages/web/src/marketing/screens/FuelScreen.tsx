/** Nutrition tab — mirrors packages/mobile FuelPresenter (gold accent). */
const macros = [
  { k: "PROTEIN", v: 148, t: 180, pct: 0.82 },
  { k: "CARBS", v: 190, t: 300, pct: 0.63 },
  { k: "FAT", v: 52, t: 80, pct: 0.65 },
];
const meals = [
  { name: "Breakfast", kcal: 520 },
  { name: "Lunch", kcal: 640 },
  { name: "Snack", kcal: 210 },
  { name: "Dinner", kcal: 390 },
];
// Gold calorie ring (viewBox 120, r 40): C = 251.3, 59% consumed.
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
      </div>

      <div className="fuel-hero">
        <div className="fuel-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="40" fill="none" stroke="rgba(244,241,234,0.08)" strokeWidth="9" />
            <circle
              className="app-ring-fg"
              cx="60"
              cy="60"
              r="40"
              fill="none"
              stroke="#F2C94C"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * 0.41}
            />
          </svg>
          <div className="fuel-ring-c">
            <b>1,240</b>
            <span>kcal left</span>
          </div>
        </div>
        <div className="fuel-macros">
          {macros.map((m) => (
            <div className="fmac" key={m.k}>
              <div className="fmac-top">
                <span className="fmac-k">{m.k}</span>
                <span className="fmac-v">
                  {m.v} / {m.t}g
                </span>
              </div>
              <div className="fmac-bar">
                <i style={{ width: `${m.pct * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="fuel-sub">
        <span>
          <b>1,760</b> / 3,000 kcal
        </span>
        <span className="fuel-log">＋ Log</span>
      </div>

      <div className="fuel-meals">
        {meals.map((meal) => (
          <div className="fuel-meal" key={meal.name}>
            <span className="fm-name">{meal.name}</span>
            <span className="fm-kcal">{meal.kcal} kcal</span>
            <span className="fm-add">＋</span>
          </div>
        ))}
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
