import { useEffect, useId, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { IconBack, IconCheck, IconOffline } from "./icons";

/** Small pure presenters shared by the coach screens. */

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="back-link">
      <IconBack size={16} />
      {label}
    </Link>
  );
}

/** Client avatar tints from the C11e board, picked by name. */
const TINTS: [string, string][] = [
  ["rgba(167,139,250,.16)", "#c4b5fd"],
  ["rgba(244,114,182,.14)", "#f9a8d4"],
  ["rgba(250,204,21,.12)", "#fde047"],
  ["rgba(96,165,250,.16)", "#93c5fd"],
  ["rgba(52,211,153,.14)", "#6ee7b7"],
  ["rgba(251,146,60,.14)", "#fdba74"],
];

function tintFor(seed: string): [string, string] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function Avatar({
  initials,
  size = 32,
  seed,
}: {
  initials: string;
  size?: number;
  /** When set, a soft tint per person (client rows); else the coach ring. */
  seed?: string;
}) {
  const tint = seed ? tintFor(seed) : null;
  return (
    <span
      className="av"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.32),
        ...(tint ? { background: tint[0], color: tint[1], border: 0 } : {}),
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/** C9c: "Offline · showing Sam as of 09:14". */
export function OfflineBanner({
  subject,
  asOf,
}: {
  subject: string;
  asOf: string | null;
}) {
  return (
    <div className="banner offline" role="status">
      <IconOffline size={16} />
      {asOf ? `Offline · showing ${subject} as of ${asOf}` : "Offline"}
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={`banner ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function Toast({ text }: { text: string }) {
  return (
    <div className="toast" role="status">
      <IconCheck size={16} />
      {text}
    </div>
  );
}

export function Toggle({
  checked,
  label,
  onChange,
  disabled,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="tg"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

/** A modal dialog: focus moves in, Escape closes. */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="scrim" onClick={onClose}>
      <div
        ref={ref}
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2
          id={titleId}
          className="h2"
          style={{ fontSize: 22, lineHeight: "28px" }}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Who", "Set up", "Invite"];
  return (
    <ol className="steps" aria-label="Steps">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n === current ? "current" : n < current ? "done" : "next";
        return (
          <li
            key={label}
            className={state === "done" ? "done" : undefined}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="dot mono">
              {state === "done" ? <IconCheck size={14} /> : n}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="sub" role="status">
      {label}
    </p>
  );
}

export function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="banner error" role="alert">
      <span style={{ flex: 1 }}>{message}</span>
      <button type="button" className="btn xs ghost" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
