import {
  MACRO_COLOURS,
  RING_C,
  RING_R,
  type PlanVsTarget,
} from "../lib/mealPlans";

/**
 * The macro wheel and the P / C / F bars (C3, C3.2, C5): planned against the
 * client's own target. Pure.
 */
export function PlanWheel({
  view,
  size = 132,
}: {
  view: PlanVsTarget;
  size?: number;
}) {
  const tone =
    view.centreTone === "ok"
      ? "var(--ok, #34d399)"
      : view.centreTone === "under"
        ? "#fbbf24"
        : view.centreTone === "over"
          ? "#f87171"
          : "inherit";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        flexWrap: "wrap",
      }}
    >
      <div style={{ position: "relative", width: size, height: size }}>
        <svg
          viewBox="0 0 100 100"
          width={size}
          height={size}
          role="img"
          aria-label={view.ringLabel}
          style={{ transform: "rotate(-90deg)" }}
        >
          <circle
            cx="50"
            cy="50"
            r={RING_R}
            fill="none"
            stroke="rgba(255,255,255,.08)"
            strokeWidth="9"
          />
          {view.segments.map((s) => (
            <circle
              key={s.colour}
              cx="50"
              cy="50"
              r={RING_R}
              fill="none"
              stroke={s.colour}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${s.length.toFixed(1)} ${RING_C.toFixed(1)}`}
              strokeDashoffset={s.offset.toFixed(1)}
            />
          ))}
        </svg>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <b className="mono" style={{ fontSize: 22, color: tone }}>
            {view.centre}
          </b>
          <span className="hint">{view.centreLabel}</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 180, display: "grid", gap: 10 }}>
        {view.macros.map((m) => (
          <div key={m.key}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
              }}
            >
              <span style={{ color: MACRO_COLOURS[m.key] }}>{m.label}</span>
              <span className="mono">
                {m.planned}
                {m.target !== null ? ` / ${m.target}g` : "g"}
              </span>
            </div>
            {m.target !== null && (
              <div
                aria-hidden="true"
                style={{
                  height: 6,
                  borderRadius: 9999,
                  background: "rgba(255,255,255,.08)",
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    width: `${m.pct}%`,
                    height: 6,
                    borderRadius: 9999,
                    background: MACRO_COLOURS[m.key],
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Target · Planned · To plan (C3). */
export function TargetStrip({
  targetKcal,
  targetLabel,
  plannedKcal,
  view,
}: {
  targetKcal: string | null;
  targetLabel: string;
  plannedKcal: string;
  view: PlanVsTarget;
}) {
  return (
    <div className="strip" aria-label="Plan against target">
      <div>
        <b className="mono">{targetKcal ?? "—"}</b>
        <span>{targetLabel}</span>
      </div>
      <div>
        <b className="mono">{plannedKcal}</b>
        <span>Planned</span>
      </div>
      <div>
        <b
          className="mono"
          style={{
            color:
              view.centreTone === "ok"
                ? "#34d399"
                : view.centreTone === "under"
                  ? "#fbbf24"
                  : view.centreTone === "over"
                    ? "#f87171"
                    : undefined,
          }}
        >
          {view.left}
        </b>
        <span>{view.leftLabel}</span>
      </div>
    </div>
  );
}
