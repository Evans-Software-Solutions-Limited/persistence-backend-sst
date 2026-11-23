import { useState } from "react";
import { useNavigate } from "react-router";
import { useRoster, useOnline } from "../hooks/coachQueries";
import { useInviteActions } from "../invite/useInviteActions";
import { clockTime, initials, lastActive } from "../lib/people";
import { summaryInviteState } from "../lib/setup";
import { LoadError, Loading } from "../ui/parts";
import { ClientsListView } from "./ClientsList";

export function ClientsListContainer() {
  const roster = useRoster();
  const [now] = useState(() => Date.now());
  const online = useOnline();
  const navigate = useNavigate();
  // Resend only makes a new code; the invite page is where it is shared.
  const invite = useInviteActions((id) =>
    navigate(`/coach/clients/invited/${id}/invite`),
  );

  if (roster.isPending) return <Loading />;
  if (!roster.data) {
    return (
      <LoadError
        message={
          online
            ? "We couldn't load your clients."
            : "You're offline. Your clients load when you're back online."
        }
        onRetry={() => roster.refetch()}
      />
    );
  }
  return (
    <>
      <ClientsListView
        invited={roster.data.invited.map((p) => ({
          profileId: p.profileId,
          name: p.displayName,
          initials: initials(p.displayName),
          goal: p.goal,
          state: summaryInviteState(p.inviteStatus, p.inviteExpiresAt, now),
        }))}
        active={roster.data.data
          .filter((c) => c.status === "active")
          .map((c) => ({
            clientId: c.id,
            name: c.name,
            initials: c.initials || initials(c.name),
            programLabel: c.programLabel,
            lastActive: lastActive(c.lastSeenAt, now),
          }))}
        busyId={invite.busyId}
        error={invite.error}
        offlineAsOf={online ? null : clockTime(roster.dataUpdatedAt)}
        onResend={(id) => {
          void invite.issue(id);
        }}
      />
      {invite.dialog}
    </>
  );
}
