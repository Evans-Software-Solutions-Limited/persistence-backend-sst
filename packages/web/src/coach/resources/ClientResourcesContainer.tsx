import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { newIdempotencyKey } from "../api/coachApi";
import type { ClientResource, CoachResource, RosterClient } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
} from "../hooks/coachQueries";
import { clockTime, firstName } from "../lib/people";
import { pickable, resourceError } from "../lib/resources";
import { LoadError, Loading } from "../ui/parts";
import { ClientResourcesTab } from "./ClientResourcesTab";
import { LinkDialog, UploadDialog } from "./ResourceForms";
import { useNewResource } from "./useNewResource";

/**
 * Client → Resources (C3.7a) on the web. Reads the client's resources, the
 * library and the client's settings (for the C3.9 Resources switch). Upload
 * and Link add to the library and share with this client in one go.
 * Assigning while Resources is off answers 403 `resources_off`, shown as such.
 */
export function ClientResourcesContainer({ client }: { client: RosterClient }) {
  const api = useCoachApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const clientFirst = firstName(client.name);
  const key = coachKeys.clientResources(client.id);
  const assignedQ = useQuery({
    queryKey: key,
    queryFn: () => api.clientResources(client.id),
    networkMode: COACH_NETWORK_MODE,
  });
  const libraryQ = useQuery({
    queryKey: coachKeys.resources,
    queryFn: () => api.resources(),
    networkMode: COACH_NETWORK_MODE,
    staleTime: 60_000,
  });
  const settingsQ = useQuery({
    queryKey: coachKeys.settings(client.id),
    queryFn: () => api.settings(client.id),
    networkMode: COACH_NETWORK_MODE,
  });
  const { addLink, upload } = useNewResource();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"upload" | "link" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ClientResource | null>(
    null,
  );

  const assigned = useMemo(() => assignedQ.data ?? [], [assignedQ.data]);
  const library = useMemo(() => libraryQ.data ?? [], [libraryQ.data]);
  const candidates = useMemo(
    () => pickable(library, assigned, query),
    [library, assigned, query],
  );

  async function assign(ids: string[]): Promise<boolean> {
    setError(null);
    setNotice(null);
    try {
      await api.assignResources(ids, [client.id], newIdempotencyKey());
      await queryClient.invalidateQueries({ queryKey: key });
      return true;
    } catch (e) {
      setError(resourceError(e, clientFirst, "We couldn't share that."));
      return false;
    }
  }

  async function addSelected() {
    const ids = selected.filter((id) => library.some((r) => r.id === id));
    if (ids.length === 0) return;
    setBusy(true);
    try {
      if (await assign(ids)) {
        setSelected([]);
        setNotice(
          `Shared ${ids.length === 1 ? "1 resource" : `${ids.length} resources`} with ${clientFirst}.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  /** A new upload or link: it's in the library now; share it with the client. */
  async function created(resource: CoachResource) {
    setDialog(null);
    setBusy(true);
    try {
      if (await assign([resource.id])) {
        setNotice(`Added ${resource.title} for ${clientFirst}.`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const cr = confirmRemove;
    if (!cr) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.removeClientResource(client.id, cr.assignmentId);
      queryClient.setQueryData<ClientResource[]>(key, (old) =>
        old?.filter((a) => a.assignmentId !== cr.assignmentId),
      );
      setNotice(`Removed ${cr.resource.title} from ${clientFirst}.`);
    } catch (e) {
      setError(resourceError(e, clientFirst, "We couldn't remove that."));
    } finally {
      setConfirmRemove(null);
      setBusy(false);
    }
  }

  if (assignedQ.isPending) return <Loading />;
  if (!assignedQ.data) {
    return (
      <LoadError
        message={
          online
            ? `We couldn't load ${clientFirst}'s resources.`
            : `You're offline. ${clientFirst}'s resources load when you're back online.`
        }
        onRetry={() => assignedQ.refetch()}
      />
    );
  }

  return (
    <>
      <ClientResourcesTab
        clientFirst={clientFirst}
        assigned={assigned}
        candidates={candidates}
        libraryCount={library.length}
        query={query}
        selected={selected}
        resourcesOff={settingsQ.data?.features.resources === false}
        busy={busy}
        offlineAsOf={online ? null : clockTime(assignedQ.dataUpdatedAt)}
        offline={!online}
        notice={notice}
        error={error}
        confirmRemove={confirmRemove}
        onQuery={setQuery}
        onToggle={(id) =>
          setSelected((s) =>
            s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
          )
        }
        onAdd={() => void addSelected()}
        onUpload={() => setDialog("upload")}
        onLink={() => setDialog("link")}
        onAskRemove={setConfirmRemove}
        onCancelRemove={() => setConfirmRemove(null)}
        onConfirmRemove={() => void remove()}
      />
      {dialog === "link" && (
        <LinkDialog
          hint={`Adds to your Library and shares with ${clientFirst}.`}
          onClose={() => setDialog(null)}
          onSave={async (values, keys) =>
            void (await created(await addLink(values, keys)))
          }
        />
      )}
      {dialog === "upload" && (
        <UploadDialog
          offline={!online}
          hint={`Adds to your Library and shares with ${clientFirst}.`}
          onClose={() => setDialog(null)}
          onSave={async (values, keys) =>
            void (await created(await upload(values, keys)))
          }
        />
      )}
    </>
  );
}
