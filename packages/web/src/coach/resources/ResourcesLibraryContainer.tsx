import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { newIdempotencyKey } from "../api/coachApi";
import type { CoachResource } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
  useRoster,
} from "../hooks/coachQueries";
import { clockTime } from "../lib/people";
import {
  countByKind,
  filterLibrary,
  resourceError,
  type ResourceFilter,
} from "../lib/resources";
import { LoadError, Loading } from "../ui/parts";
import { LinkDialog, UploadDialog } from "./ResourceForms";
import { ResourcesLibrary, ShareDialog } from "./ResourcesLibrary";
import { useNewResource } from "./useNewResource";

/**
 * Library → Resources (C5b) on the web: the coach's files and links, adding
 * new ones, sharing one with several clients at once, and deleting (which
 * removes it from every client). Sharing with a client who has Resources
 * switched off answers 403 `resources_off`, and nothing is shared.
 */
export function ResourcesLibraryContainer() {
  const api = useCoachApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const roster = useRoster();
  const libraryQ = useQuery({
    queryKey: coachKeys.resources,
    queryFn: () => api.resources(),
    networkMode: COACH_NETWORK_MODE,
  });
  const { addLink, upload } = useNewResource();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"upload" | "link" | "share" | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareQuery, setShareQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [shareError, setShareError] = useState<string | null>(null);

  const library = useMemo(() => libraryQ.data ?? [], [libraryQ.data]);
  const rows = useMemo(
    () => filterLibrary(library, query, filter),
    [library, query, filter],
  );
  const selected = library.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const clients = useMemo(
    () => (roster.data?.data ?? []).filter((c) => c.status === "active"),
    [roster.data],
  );

  function added(resource: CoachResource) {
    setDialog(null);
    setSelectedId(resource.id);
    setFilter("all");
    setQuery("");
    setError(null);
    setNotice(`Added ${resource.title} to your Library.`);
  }

  async function share() {
    if (!selected || picked.length === 0) return;
    setBusy(true);
    setShareError(null);
    try {
      await api.assignResources([selected.id], picked, newIdempotencyKey());
      for (const id of picked) {
        void queryClient.invalidateQueries({
          queryKey: coachKeys.clientResources(id),
        });
      }
      const n = picked.length;
      setNotice(
        `Shared ${selected.title} with ${n === 1 ? "1 client" : `${n} clients`}.`,
      );
      setDialog(null);
      setPicked([]);
    } catch (e) {
      const names = clientNames(e);
      setShareError(
        resourceError(
          e,
          names.length === 1 ? names[0]! : null,
          "We couldn't share that.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  /** The first names of the clients a 403 names (`clientIds`). */
  function clientNames(e: unknown): string[] {
    const ids = (e as { body?: { clientIds?: unknown } } | null)?.body
      ?.clientIds;
    if (!Array.isArray(ids)) return [];
    return clients
      .filter((c) => ids.includes(c.id))
      .map((c) => c.name.split(/\s+/)[0]!);
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.archiveResource(selected.id);
      queryClient.setQueryData<CoachResource[]>(coachKeys.resources, (old) =>
        old?.filter((r) => r.id !== selected.id),
      );
      // Every client who had it loses it (Brad, 26 Nov).
      void queryClient.invalidateQueries({
        queryKey: ["coach", "client-resources"],
      });
      setNotice(`Deleted ${selected.title}.`);
      setSelectedId(null);
    } catch (e) {
      setError(resourceError(e, null, "We couldn't delete that."));
    } finally {
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  if (libraryQ.isPending) return <Loading />;
  if (!libraryQ.data) {
    return (
      <LoadError
        message={
          online
            ? "We couldn't load your resources."
            : "You're offline. Your resources load when you're back online."
        }
        onRetry={() => libraryQ.refetch()}
      />
    );
  }

  return (
    <>
      <ResourcesLibrary
        rows={rows}
        counts={countByKind(library)}
        filter={filter}
        query={query}
        selected={selected}
        busy={busy}
        offlineAsOf={online ? null : clockTime(libraryQ.dataUpdatedAt)}
        offline={!online}
        notice={notice}
        error={error}
        confirmDelete={confirmDelete}
        onQuery={setQuery}
        onFilter={setFilter}
        onSelect={setSelectedId}
        onAddLink={() => setDialog("link")}
        onUpload={() => setDialog("upload")}
        onShare={() => {
          setPicked([]);
          setShareQuery("");
          setShareError(null);
          setDialog("share");
        }}
        onAskDelete={() => setConfirmDelete(true)}
        onCancelDelete={() => setConfirmDelete(false)}
        onConfirmDelete={() => void remove()}
      />
      {dialog === "link" && (
        <LinkDialog
          onClose={() => setDialog(null)}
          onSave={async (values) => added(await addLink(values))}
        />
      )}
      {dialog === "upload" && (
        <UploadDialog
          offline={!online}
          onClose={() => setDialog(null)}
          onSave={async (values) => added(await upload(values))}
        />
      )}
      {dialog === "share" && selected && (
        <ShareDialog
          title={selected.title}
          clients={clients}
          query={shareQuery}
          picked={picked}
          busy={busy}
          error={shareError}
          onQuery={setShareQuery}
          onToggle={(id) =>
            setPicked((s) =>
              s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
            )
          }
          onShare={() => void share()}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
