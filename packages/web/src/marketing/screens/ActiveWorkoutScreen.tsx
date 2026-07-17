/** Live session — mirrors packages/mobile ActiveSessionPresenter + SetLogger. */
const sets = [
  { n: 1, prev: "8 reps • 60 kg", reps: "8", kg: "60" },
  { n: 2, prev: "8 reps • 62.5 kg", reps: "8", kg: "62.5" },
  { n: 3, prev: null, reps: "", kg: "" },
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
        <div className="aw-center">
          <b>Push Day</b>
          <span className="aw-timer">
            <svg viewBox="0 0 24 24" fill="none" stroke="#4FE3F0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2 2M9 2h6" />
            </svg>
            24:18
          </span>
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
          <div className="aw-ex-info">
            <b>Barbell Bench Press</b>
            <span>4 sets × 8–10 reps</span>
          </div>
          <div className="aw-ex-actions">
            <svg viewBox="0 0 24 24" fill="none" stroke="#4FE3F0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4v16h16v-7" />
              <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
            </svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="#87847D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 1l4 4-4 4" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </div>
        </div>

        <div className="aw-cols">
          <span>SET</span>
          <span>PREV</span>
          <span>REPS</span>
          <span>KG</span>
          <span />
        </div>
        {sets.map((s) => (
          <div className="aw-set" key={s.n}>
            <span className="s">{s.n}</span>
            <span className={`p${s.prev ? "" : " none"}`}>{s.prev ?? "—"}</span>
            <span className="box">{s.reps}</span>
            <span className="box">{s.kg}</span>
            <span className="aw-x">✕</span>
          </div>
        ))}

        <div className="aw-actions">
          <span>
            <b>＋</b> ADD SET
          </span>
          <span className="rest">
            <svg viewBox="0 0 24 24" fill="none" stroke="#4FE3F0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2 2M9 2h6" />
            </svg>
            90S REST
          </span>
        </div>
      </div>

      <div className="aw-addex">
        <span className="aw-addex-line" />
        <span className="aw-addex-link">⊕ Add Exercise</span>
      </div>

      <div className="aw-finish">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Finish Workout
      </div>
    </div>
  );
}
