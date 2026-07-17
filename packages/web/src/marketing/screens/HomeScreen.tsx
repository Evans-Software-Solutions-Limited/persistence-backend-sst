/** App "Today" home screen — mirrors packages/mobile HomePresenter/TodayHero. */

// Ring geometry (viewBox 120): circumference C = 2πr; fg offset = C·(1−pct).
const rings = [
  { r: 52, c: 326.73, pct: 0.85, color: "#4FE3F0" }, // Move
  { r: 41, c: 257.61, pct: 0.62, color: "#FF9A5A" }, // Train
  { r: 30, c: 188.5, pct: 0.8, color: "#F2C94C" }, // Fuel
];

const days = ["M", "T", "W", "T", "F", "S", "S"];
// Habit rows: which days are done (specs mirror HabitsGridPresenter "This week").
const habits = [
  { name: "Train", tone: "cyan", done: [true, true, false, true, true, false, false] },
  { name: "Protein", tone: "ember", done: [true, true, true, true, false, false, false] },
  { name: "Steps", tone: "gold", done: [true, false, true, true, true, false, false] },
];

export function HomeScreen() {
  return (
    <div className="app-ui">
      <div className="app-status">
        <span className="t">9:41</span>
        <span className="d" />
      </div>

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
            <path
              d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

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

      {/* This week — habits grid */}
      <div className="app-sec">
        <div className="app-sec-head">
          <span className="e">STREAK</span>
          <b>This week</b>
          <span className="a">🔥 23</span>
        </div>
        <div className="app-habits">
          <div className="app-habit-days">
            <span className="hh" />
            {days.map((day, i) => (
              <span key={i} className="hd">
                {day}
              </span>
            ))}
          </div>
          {habits.map((habit) => (
            <div className="app-habit-row" key={habit.name}>
              <span className="hn">{habit.name}</span>
              {habit.done.map((done, i) => (
                <span key={i} className={`hc ${habit.tone}${done ? " on" : ""}`} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom tab bar */}
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
  );
}
