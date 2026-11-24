import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import type { ClientSettings, RosterClient, SettingsPatch } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
  useRoster,
} from "../hooks/coachQueries";
import { CONFLICT_NOTICE } from "../lib/draft";
import { clockTime, firstName, initials, lastActive } from "../lib/people";
import {
  applyPatch,
  clampSessions,
  trainingPatch,
  untouchedBy,
} from "../lib/settings";
import { ClientSettingsView } from "../settings/ClientSettings";
import { CheckinsContainer } from "../checkins/CheckinsContainer";
import { Avatar, BackLink, LoadError, Loading } from "../ui/parts";
import { ClientTabs, type ClientTab } from "./ClientTabs";

/** Tabs built on the web so far, by URL segment. */
const WEB_TABS: Record<string, ClientTab> = {
  "check-ins": "Check-ins", // PER-129 (C3.3)
  settings: "Settings", // PER-124 (C3.9)
};
const OPEN_TABS: ClientTab[] = Object.values(WEB_TABS);
const segmentOf = (tab: ClientTab) =>
  Object.keys(WEB_TABS).find((k) => WEB_TABS[k] === tab) ?? "settings";

/**
 * An active client's page (C3, K layout). On the web so far the Check-ins
 * (C3.3) and Settings (C3.9) tabs are built; the others come with their
 * tickets.
 */
export function ClientPage() {
  const { clientId = "", tab } = useParams();
  const roster = useRoster();
  if (!tab || !WEB_TABS[tab]) {
    return <Navigate to={`/coach/clients/${clientId}/settings`} replace />;
  }
  if (roster.isPending) return <Loading />;
  const client = roster.data?.data.find(
    (c) => c.id === clientId && c.status === "active",
  );
  if (!client) {
    return (
      <>
        <BackLink to="/coach/clients" label="Clients" />
        <LoadError
          message={
            roster.data
              ? "This client isn't one of your active clients."
              : "We couldn't load this client."
          }
          onRetry={() => void roster.refetch()}
        />
      </>
    );
  }
  const selected = WEB_TABS[tab]!;
  return (
    <>
      <BackLink to="/coach/clients" label="Clients" />
      <ClientHeader client={client} />
      <ClientTabs
        selected={selected}
        open={OPEN_TABS}
        locked={false}
        lockedReason=""
        hrefFor={(t) => `/coach/clients/${client.id}/${segmentOf(t)}`}
      />
      {selected === "Check-ins" ? (
        <CheckinsContainer key={client.id} client={client} />
      ) : (
        <ClientSettingsPage client={client} />
      )}
    </>
  );
}

function ClientHeader({ client }: { client: RosterClient }) {
  const active = lastActive(client.lastSeenAt);
  const sub = [client.programLabel, active ? `active ${active} ago` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <Avatar initials={client.initials || initials(client.name)} size={48} />
      <div style={{ flex: 1 }}>
        <h1
          className="h1"
          style={{ fontSize: 24, lineHeight: "30px", letterSpacing: -0.5 }}
        >
          {client.name}
        </h1>
        {sub && (
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{sub}</span>
        )}
      </div>
    </header>
  );
}

function ClientSettingsPage({ client }: { client: RosterClient }) {
  const api = useCoachApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const key = coachKeys.settings(client.id);
  const settingsQ = useQuery({
    queryKey: key,
    queryFn: () => api.settings(client.id),
    networkMode: COACH_NETWORK_MODE,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const clientFirst = firstName(client.name);

  async function save(patch: SettingsPatch) {
    const before = settingsQ.data;
    if (!before) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    queryClient.setQueryData(key, applyPatch(before, patch));
    try {
      let saved: ClientSettings;
      try {
        saved = await api.patchSettings(client.id, patch, before.revision);
      } catch (e) {
        // The revision covers every setting: a change to a different one
        // (e.g. a feature switch on the phone) also gives a 409. If what this
        // patch touches is unchanged on the server, send it once more.
        const latest =
          isCoachApiError(e) && e.code === "revision_conflict"
            ? (e.body?.current as ClientSettings | undefined)
            : undefined;
        if (!latest || !untouchedBy(patch, before, latest)) throw e;
        saved = await api.patchSettings(client.id, patch, latest.revision);
      }
      queryClient.setQueryData(key, saved);
    } catch (e) {
      if (isCoachApiError(e) && e.code === "revision_conflict") {
        const latest = e.body?.current as ClientSettings | undefined;
        queryClient.setQueryData(key, latest ?? before);
        setNotice(CONFLICT_NOTICE);
      } else {
        queryClient.setQueryData(key, before);
        setError(
          isCoachApiError(e) && e.offline
            ? "You're offline. Settings change when you're back online."
            : isCoachApiError(e)
              ? e.message
              : "We couldn't save that change.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function endCoaching() {
    setEnding(true);
    setError(null);
    try {
      await api.endCoaching(client.id);
      await queryClient.invalidateQueries({
        queryKey: coachKeys.roster,
      });
      void navigate("/coach/clients");
    } catch (e) {
      setConfirmEnd(false);
      setError(
        isCoachApiError(e) && e.offline
          ? "You're offline. Ending coaching needs a connection."
          : isCoachApiError(e)
            ? e.message
            : "We couldn't end coaching. Try again.",
      );
    } finally {
      setEnding(false);
    }
  }

  return (
    <>
      {settingsQ.isPending ? (
        <Loading />
      ) : !settingsQ.data ? (
        <LoadError
          message={
            online
              ? "We couldn't load these settings."
              : "You're offline. Settings load when you're back online."
          }
          onRetry={() => void settingsQ.refetch()}
        />
      ) : (
        <ClientSettingsView
          clientFirst={clientFirst}
          settings={settingsQ.data}
          busy={busy}
          offlineAsOf={online ? null : clockTime(settingsQ.dataUpdatedAt)}
          notice={notice}
          error={error}
          confirmEnd={confirmEnd}
          ending={ending}
          onTrackTraining={(on) =>
            void save(trainingPatch(settingsQ.data!, on))
          }
          onTrackCalories={(on) => void save({ trackCalories: on })}
          onSessions={(n) => void save({ sessionsPerWeek: clampSessions(n) })}
          onFeature={(k, on) => void save({ features: { [k]: on } })}
          onAlert={(mode) => void save({ alertMode: mode })}
          onAskEnd={() => setConfirmEnd(true)}
          onKeep={() => setConfirmEnd(false)}
          onConfirmEnd={() => void endCoaching()}
        />
      )}
    </>
  );
}
