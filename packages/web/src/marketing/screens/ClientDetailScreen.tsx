/** Coach client detail — mirrors packages/mobile ClientDetailPresenter (violet).
 *  Order: header → current programme → quick actions → AI weekly summary. */
import { Avatar, StatusBar } from "./coachData";

const actions = [
  { k: "Assign", tone: "#4FE3F0" },
  { k: "Macros", tone: "#F2C94C" },
  { k: "Goals", tone: "#B7A0FF" },
  { k: "Brief", tone: "#FF9A5A" },
];

export function ClientDetailScreen() {
  return (
    <div className="app-ui">
      <StatusBar />

      <div className="co-back">
        <span>‹ Clients</span>
        <span className="co-back-ic">✉ ⋯</span>
      </div>

      <div className="co-detail-head">
        <Avatar initials="MR" tone="linear-gradient(150deg,#CDBCFF,#7C5CE0)" />
        <div>
          <b>Marcus Reid</b>
          <span>Age 34 · 180 cm · Strength Foundations</span>
          <div className="co-pills">
            <span className="co-pill ember">2 missed</span>
            <span className="co-pill violet">WK 6/12</span>
          </div>
        </div>
      </div>

      <div className="co-prog">
        <span className="e">
          <i className="co-dot" /> CURRENT PROGRAMME
        </span>
        <b>Strength Foundations</b>
        <span className="co-prog-wk">Week 6 of 12</span>
      </div>

      <div className="cd-qa">
        {actions.map((a) => (
          <span className="cd-qa-btn" key={a.k}>
            <svg viewBox="0 0 24 24" fill="none" stroke={a.tone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="12" cy="12" r="0.5" fill={a.tone} />
            </svg>
            {a.k}
          </span>
        ))}
      </div>

      {/* AI weekly summary — the flagship */}
      <div className="cd-ai">
        <div className="cd-ai-head">
          <span className="cd-ai-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="#B7A0FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
              <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
            </svg>
            AI WEEKLY SUMMARY
          </span>
          <span className="cd-ai-time">Updated 2h ago</span>
        </div>
        <p className="cd-ai-text">
          Marcus hit all 4 sessions — bench and squat each up ~2.5 kg. Protein
          averaged 148 g against a 180 g target, so breakfast is the gap to close.
          Sleep dipped midweek, which lines up with the lighter Thursday session.
          Hold the current block; a deload is due in two weeks.
        </p>
        <span className="cd-ai-btn">Regenerate</span>
      </div>
    </div>
  );
}
