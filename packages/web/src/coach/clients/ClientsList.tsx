import { Link } from "react-router";
import type { InviteState } from "../lib/setup";
import { IconChevron, IconClock, IconPlus } from "../ui/icons";
import { Avatar, Notice, OfflineBanner } from "../ui/parts";

/**
 * Clients (C11e on C8): Invited above Active. Active rows keep the C8 columns
 * the web has data for (client, programme, last active); Check-in and
 * Adherence arrive with PER-129 and PER-127.
 */

export interface InvitedRow {
  profileId: string;
  name: string;
  initials: string;
  goal: string | null;
  state: InviteState;
}

export interface ActiveRow {
  clientId: string;
  name: string;
  initials: string;
  programLabel: string | null;
  lastActive: string | null;
}

export interface ClientsListViewProps {
  invited: InvitedRow[];
  active: ActiveRow[];
  busyId: string | null;
  error: string | null;
  offlineAsOf: string | null;
  onResend: (profileId: string) => void;
}

export function InviteStatePill({ state }: { state: InviteState }) {
  if (state === "expired") {
    return (
      <span className="pl plE" style={{ flex: "none" }}>
        <IconClock size={14} />
        Code expired
      </span>
    );
  }
  return (
    <span
      className="pl"
      style={{
        background: "rgba(255,255,255,.06)",
        color: "var(--ink-2)",
        flex: "none",
      }}
    >
      <IconClock size={14} />
      Invited
    </span>
  );
}

export function ClientsListView({
  invited,
  active,
  busyId,
  error,
  offlineAsOf,
  onResend,
}: ClientsListViewProps) {
  const offline = offlineAsOf !== null;
  return (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1 }}>
          <h1 className="h1">Clients</h1>
          <span className="sub">
            {active.length} active · {invited.length} invited
          </span>
        </div>
        <Link to="/coach/clients/new" className="btn v sm">
          <IconPlus size={16} />
          Add client
        </Link>
      </header>
      {offline && <OfflineBanner subject="your clients" asOf={offlineAsOf} />}
      {error && <Notice tone="error">{error}</Notice>}

      {invited.length > 0 && (
        <section aria-labelledby="invited-h">
          <div
            className="divider"
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              paddingTop: 14,
            }}
          >
            <h2
              id="invited-h"
              className="st"
              style={{ margin: 0, flex: "none" }}
            >
              Invited
            </h2>
            <span
              className="mono"
              style={{ fontSize: 12, color: "var(--muted)" }}
            >
              {invited.length}
            </span>
          </div>
          {invited.map((r) => (
            <div className="row" key={r.profileId}>
              <Avatar initials={r.initials} size={36} seed={r.name} />
              <Link
                to={`/coach/clients/invited/${r.profileId}`}
                className="tx"
                style={{ textDecoration: "none" }}
              >
                <span className="n">{r.name}</span>
                {r.goal && <span className="s">{r.goal}</span>}
              </Link>
              <InviteStatePill state={r.state} />
              <button
                type="button"
                className="act"
                style={{ height: 34, marginLeft: 8 }}
                disabled={offline || busyId === r.profileId}
                onClick={() => onResend(r.profileId)}
              >
                {busyId === r.profileId
                  ? "Sending…"
                  : r.state === "none"
                    ? "Send"
                    : "Resend"}
              </button>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="active-h">
        <div
          className="divider"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            paddingTop: 14,
            marginTop: invited.length > 0 ? 4 : 0,
          }}
        >
          <h2 id="active-h" className="st" style={{ margin: 0, flex: "none" }}>
            Active
          </h2>
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--muted)" }}
          >
            {active.length}
          </span>
        </div>
        {active.length === 0 ? (
          <p className="sub">
            No active clients yet. Add a client and they appear here once they
            accept.
          </p>
        ) : (
          <table className="roster">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Programmes</th>
                <th scope="col">Active</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {active.map((r) => (
                <tr key={r.clientId}>
                  <td>
                    <Link to={`/coach/clients/${r.clientId}`} className="who">
                      <Avatar initials={r.initials} size={36} seed={r.name} />
                      {r.name}
                    </Link>
                  </td>
                  <td>{r.programLabel ?? "No programme"}</td>
                  <td className="mono">{r.lastActive ?? "–"}</td>
                  <td style={{ width: 24, color: "var(--muted)" }}>
                    <IconChevron size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
