/** Coach clients list — mirrors packages/mobile ClientsListPresenter (violet). */
import { CoachTabs, Avatar, StatusBar } from "./coachData";

const roster = [
  { in: "TH", name: "Tom Hayward", pct: 38, band: "Crisis", tone: "#F87171", flag: "4d idle" },
  { in: "MR", name: "Marcus Reid", pct: 64, band: "At risk", tone: "#FF9A5A", flag: "2 missed" },
  { in: "JB", name: "Jonas Berg", pct: 78, band: "Wobbling", tone: "#F2C94C", flag: null },
  { in: "AW", name: "Aisha Williams", pct: 88, band: "Strong", tone: "#5FD9A6", flag: null },
  { in: "PS", name: "Priya Shah", pct: 100, band: "Stellar", tone: "#F2C94C", flag: "New PR" },
];

export function ClientsScreen() {
  return (
    <div className="app-ui">
      <StatusBar />

      <div className="app-topbar">
        <div className="app-title">
          <span className="app-eyebrow co-vi">COACHING · 5 ACTIVE</span>
          <span className="app-greet">Clients</span>
        </div>
        <span className="co-add">＋</span>
      </div>

      <div className="co-chips">
        <span className="co-chip ember">2 need attention</span>
        <span className="co-chip gold">1 new PR</span>
        <span className="co-chip violet">1 ending</span>
      </div>

      <div className="co-roster">
        {roster.map((c) => (
          <div className="co-crow" key={c.in}>
            <Avatar initials={c.in} tone="linear-gradient(150deg,#CDBCFF,#7C5CE0)" />
            <div className="co-crow-main">
              <div className="co-crow-top">
                <b>{c.name}</b>
                {c.flag && <span className="co-flag">{c.flag}</span>}
              </div>
              <div className="co-bar">
                <i style={{ width: `${c.pct}%`, background: c.tone }} />
              </div>
              <span className="co-cap" style={{ color: c.tone }}>
                {c.pct}% · {c.band}
              </span>
            </div>
          </div>
        ))}
      </div>

      <CoachTabs active="clients" />
    </div>
  );
}
