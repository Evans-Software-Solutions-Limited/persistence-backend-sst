import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/** Small shared pieces for the admin pages. */

export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="admin-page-header">
      <h1 className="admin-page-title">{title}</h1>
      {children ? <div className="admin-page-actions">{children}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`admin-panel ${className}`}>
      {title ? <h2 className="admin-panel-title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="admin-stat">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="admin-stat-value">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

export function Meter({ used, cap }: { used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <div className="mt-2" aria-label={`${used} of ${cap} used`}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "active"
      ? "default"
      : status === "pending"
        ? "secondary"
        : status === "revoked"
          ? "destructive"
          : "outline";
  return (
    <Badge
      variant={variant as "default" | "secondary" | "destructive" | "outline"}
    >
      {status === "account_deleted" ? "account deleted" : status}
    </Badge>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}

export function ErrorState({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : "Something went wrong";
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

export function Table({
  head,
  children,
}: {
  head: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="admin-table-scroll"
      role="region"
      aria-label={head.join(", ")}
      tabIndex={0}
    >
      <table className="admin-table">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            {head.map((h) => (
              <th scope="col" key={h} className="px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-2 [&_td]:py-2 [&_tr]:border-b [&_tr]:border-border/60">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
