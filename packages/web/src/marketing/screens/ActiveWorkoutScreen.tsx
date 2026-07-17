/** Live session screen — mirrors packages/mobile ActiveSessionPresenter. */
const sets = [
  { n: 1, prev: "8×60", reps: "8", kg: "60", state: "done" },
  { n: 2, prev: "8×60", reps: "8", kg: "62.5", state: "done" },
  { n: 3, prev: "8×62.5", reps: "—", kg: "—", state: "active" },
];

export function ActiveWorkoutScreen() {
  return (
    <div className="app-ui">
      <div className="app-status">
        <span className="t">9:41</span>
        <span className="d" />
      </div>

      <div className="aw-head">
        <span className="aw-chev">⌄</span>
        <div className="aw-title">
          <b>Push Day</b>
          <span>24:18 elapsed</span>
        </div>
        <span className="aw-end">End</span>
      </div>

      <div className="aw-ex">
        <div className="aw-ex-head">
          <span className="aw-ex-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="2" y="9" width="4" height="6" rx="1" />
              <rect x="18" y="9" width="4" height="6" rx="1" />
              <line x1="6" y1="12" x2="18" y2="12" />
            </svg>
          </span>
          <div>
            <b>Barbell Bench Press</b>
            <span>4 sets · 8–10 reps</span>
          </div>
        </div>
        <div className="aw-cols">
          <span>SET</span>
          <span>PREV</span>
          <span>REPS</span>
          <span>KG</span>
        </div>
        {sets.map((s) => (
          <div className={`aw-set ${s.state}`} key={s.n}>
            <span className="s">{s.n}</span>
            <span className="p">{s.prev}</span>
            <span className="v">{s.reps}</span>
            <span className="v">{s.kg}</span>
            <span className="chk" />
          </div>
        ))}
        <div className="aw-actions">
          <span>＋ Add set</span>
          <span className="rest">⏱ 90s rest</span>
        </div>
      </div>

      <div className="aw-finish">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Finish workout
      </div>
    </div>
  );
}
