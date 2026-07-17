/** Coach client detail — mirrors packages/mobile ClientDetailPresenter (violet). */
import { Avatar, StatusBar } from "./coachData";

const activity = [
  { k: "Workouts", v: "3/4", tone: "#4FE3F0" },
  { k: "Volume", v: "12.4t", tone: "#F4F1EA" },
  { k: "PRs", v: "2", tone: "#F2C94C" },
  { k: "Check-ins", v: "5/7", tone: "#5FD9A6" },
];
const vol = [0.5, 0.8, 0, 0.65, 0.9, 0.3, 0];
const days = ["M", "T", "W", "T", "F", "S", "S"];

export function ClientDetailScreen() {
  return (
    <div className="app-ui">
      <StatusBar />

      <div className="co-back">
        <span>‹ Clients</span>
        <span className="co-back-ic">⋯</span>
      </div>

      <div className="co-detail-head">
        <Avatar initials="MR" tone="linear-gradient(150deg,#CDBCFF,#7C5CE0)" />
        <div>
          <b>Marcus Reid</b>
          <span>Age 34 · 180 cm</span>
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

      <div className="app-sec">
        <div className="app-sec-head">
          <span className="e">THIS WEEK</span>
          <b>Activity</b>
        </div>
        <div className="co-stats">
          {activity.map((a) => (
            <div className="co-stat" key={a.k}>
              <span className="cs-v" style={{ color: a.tone }}>
                {a.v}
              </span>
              <span className="cs-k">{a.k}</span>
            </div>
          ))}
        </div>
        <div className="co-vol">
          {vol.map((h, i) => (
            <div className="co-vol-col" key={i}>
              <div className="co-vol-bar">
                <i style={{ height: `${Math.max(h * 100, 6)}%`, opacity: h ? 1 : 0.25 }} />
              </div>
              <span>{days[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
