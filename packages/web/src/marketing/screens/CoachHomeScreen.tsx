/** Coach home — mirrors packages/mobile CoachHomePresenter (violet). */
import { CoachTabs, Avatar, StatusBar } from "./coachData";

export function CoachHomeScreen() {
  return (
    <div className="app-ui">
      <StatusBar />

      <div className="app-topbar">
        <Avatar initials="C" tone="linear-gradient(150deg,#CDBCFF,#7C5CE0)" />
        <div className="app-title">
          <span className="app-eyebrow co-vi">MONDAY · MAR 25</span>
          <span className="app-greet">
            Good morning, <b className="co-vi">Coach</b>
          </span>
        </div>
        <span className="app-bell">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      <div className="app-sec">
        <div className="app-sec-head">
          <span className="e">NEEDS YOU TODAY</span>
          <b>3 flagged</b>
          <span className="a co-vi">All clients →</span>
        </div>
        <div className="co-row">
          <Avatar initials="TH" tone="linear-gradient(150deg,#FFC08A,#E07B2E)" />
          <div className="co-row-info">
            <b>Tom Hayward</b>
            <span className="co-ember">4d idle · Cut · wk 6</span>
          </div>
          <span className="co-chev">›</span>
        </div>
        <div className="co-row">
          <Avatar initials="MR" tone="linear-gradient(150deg,#CDBCFF,#7C5CE0)" />
          <div className="co-row-info">
            <b>Marcus Reid</b>
            <span className="co-ember">2 missed · Strength</span>
          </div>
          <span className="co-chev">›</span>
        </div>
      </div>

      <div className="app-sec">
        <div className="app-sec-head">
          <span className="e">PROGRAMME ALERTS</span>
        </div>
        <div className="co-row">
          <span className="co-tile">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
            </svg>
          </span>
          <div className="co-row-info">
            <b>Aisha Williams</b>
            <span>Strength Foundations ends in 2 weeks</span>
          </div>
          <span className="co-chev">›</span>
        </div>
      </div>

      <CoachTabs active="home" />
    </div>
  );
}
