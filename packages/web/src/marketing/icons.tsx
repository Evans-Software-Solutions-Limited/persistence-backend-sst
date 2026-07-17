/**
 * Inline SVG icon set for the marketing site — recreated from the design
 * handoff prototypes. Kept inline (no icon library) so paths match the
 * references exactly. All icons inherit `currentColor`.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const stroke = {
  fill: "none",
  stroke: "currentColor" as const,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function AppleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

export function GooglePlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M3.6 1.8l10.3 10.2L3.6 22.2c-.3-.2-.5-.6-.5-1V2.8c0-.4.2-.8.5-1zm11.4 11.3l2.7 2.7-3.3 1.9-2.1-2.1 2.7-2.5zm0-2.2L12.3 8.4l2.1-2.1 3.3 1.9-2.7 2.7zm5.4-1.1l1.7 1c.6.4.6 1.4 0 1.8l-1.7 1-3-1.9 3-1.9z" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} aria-hidden="true" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function DumbbellIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.8} aria-hidden="true" {...props}>
      <rect x="2" y="9" width="4" height="6" rx="1" />
      <rect x="18" y="9" width="4" height="6" rx="1" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="8" y1="10" x2="8" y2="14" />
      <line x1="16" y1="10" x2="16" y2="14" />
    </svg>
  );
}

export function FlameIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.8} aria-hidden="true" {...props}>
      <path d="M12 2C8 6 4 10 4 14a8 8 0 0016 0c0-4-4-8-8-12z" />
      <path d="M12 22c-2 0-4-2-4-4 0-2 2-4 4-6 2 2 4 4 4 6 0 2-2 4-4 4z" />
    </svg>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.8} aria-hidden="true" {...props}>
      <polyline points="4 18 9 12 13 15 20 6" />
      <polyline points="16 6 20 6 20 10" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  );
}

export function SeatsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export function BarsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function WifiOffIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <path d="M1 1l22 22" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function LifeBuoyIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="m4.9 4.9 4.2 4.2M14.9 14.9l4.2 4.2M14.9 9.1l4.2-4.2M4.9 19.1l4.2-4.2" />
    </svg>
  );
}

/** Marquee feature-tag icons, keyed by tag label. */
export function MarqueeIcon({ d, ...props }: IconProps & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.8} aria-hidden="true" {...props}>
      <path d={d} />
    </svg>
  );
}
