import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import type { CoachResource } from "@/domain/models/coachResources";
import {
  matchesQuery,
  resourcesOffMessage,
} from "@/domain/services/coachResources.service";
import {
  useCoachResourceActions,
  useCoachResourceLibrary,
} from "@/ui/hooks/useCoachResources";
import { useGetTrainerClients } from "@/ui/hooks/useGetTrainerClients";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  LinkResourceSheetPresenter,
  NameResourceSheetPresenter,
} from "@/ui/presenters/coachResources/ResourceFormSheets";
import {
  ResourcesLibraryPresenter,
  ShareResourceSheetPresenter,
  type ResourceFilter,
} from "@/ui/presenters/coachResources/ResourcesLibraryPresenter";
import { refusalMessage } from "./ClientResourcesContainer";
import { useNewResourceFlow } from "./useNewResourceFlow";

/**
 * Library → Resources on iPhone. Cache-first (works offline); a link made
 * offline waits in the queue. Upload, Share and Delete need a connection
 * (Share falls back to the queue only when the connection drops mid-way).
 * Deleting removes it from every client (Brad, 26 Nov).
 */
export function CoachResourcesLibraryContainer() {
  const online = useOnlineStatus();
  const library = useCoachResourceLibrary();
  const clientsQ = useGetTrainerClients();
  const reload = library.reload;
  const actions = useCoachResourceActions({ online, onLocalWrite: reload });
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sharing, setSharing] = useState<CoachResource | null>(null);
  const [shareQuery, setShareQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const all = useMemo(() => library.data ?? [], [library.data]);
  const rows = useMemo(
    () =>
      library.data === null
        ? null
        : all.filter(
            (r) =>
              (filter === "all" || r.kind === filter) && matchesQuery(r, query),
          ),
    [library.data, all, filter, query],
  );
  const counts = useMemo(
    () => ({
      all: all.length,
      file: all.filter((r) => r.kind === "file").length,
      link: all.filter((r) => r.kind === "link").length,
    }),
    [all],
  );
  const clients = useMemo(
    () =>
      (clientsQ.data ?? [])
        .filter((c) => c.status === "active")
        .map((c) => ({ id: c.id, name: c.name })),
    [clientsQ.data],
  );

  const flow = useNewResourceFlow({
    online,
    actions,
    onCreated: (resource) => {
      setFilter("all");
      setQuery("");
      setNotice(`Added ${resource.title} to your Library.`);
    },
  });

  const share = useCallback(async () => {
    if (!sharing || picked.length === 0) return;
    setBusy(true);
    setShareError(null);
    try {
      const result = await actions.assignMany(sharing, picked);
      if (!result.ok) {
        const names = clients
          .filter((c) =>
            "clientIds" in result.refusal
              ? result.refusal.clientIds.includes(c.id)
              : false,
          )
          .map((c) => c.name.split(/\s+/)[0]!);
        setShareError(
          result.refusal.kind === "resources_off"
            ? resourcesOffMessage(names.length === 1 ? names[0]! : null)
            : refusalMessage(result.refusal, "That client"),
        );
        return;
      }
      const n = picked.length;
      setNotice(
        `Shared ${sharing.title} with ${n === 1 ? "1 client" : `${n} clients`}.`,
      );
      setSharing(null);
    } finally {
      setBusy(false);
    }
  }, [actions, sharing, picked, clients]);

  const onRow = useCallback(
    (resource: CoachResource) => {
      Alert.alert(resource.title, undefined, [
        {
          text: "Share with clients",
          onPress: () => {
            setPicked([]);
            setShareQuery("");
            setShareError(null);
            setSharing(resource);
          },
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            Alert.alert(
              `Delete ${resource.title}?`,
              "It's removed from your Library and from every client who has it.",
              [
                { text: "Keep", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    if (!online) {
                      Alert.alert(
                        "You're offline",
                        "Deleting needs a connection. Try again when you're back online.",
                      );
                      return;
                    }
                    const result = await actions.archive(resource);
                    if (!result.ok) {
                      Alert.alert("Couldn't delete it", result.message);
                      return;
                    }
                    setNotice(`Deleted ${resource.title}.`);
                  },
                },
              ],
            ),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [actions, online],
  );

  return (
    <>
      <ResourcesLibraryPresenter
        rows={rows}
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        offline={!online}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        isRefreshing={library.isRefreshing}
        onRefresh={() => void library.refresh()}
        onUpload={() => void flow.startUpload()}
        onLink={flow.startLink}
        onRow={onRow}
      />
      <ShareResourceSheetPresenter
        visible={sharing !== null}
        onClose={() => setSharing(null)}
        title={sharing?.title ?? ""}
        clients={clients}
        query={shareQuery}
        onQuery={setShareQuery}
        picked={picked}
        onToggle={(id) =>
          setPicked((s) =>
            s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
          )
        }
        busy={busy}
        error={shareError}
        onShare={() => void share()}
      />
      <LinkResourceSheetPresenter
        {...flow.linkSheet}
        hint="Adds to your Library. Share it with clients from here or from a client's Resources tab."
      />
      <NameResourceSheetPresenter
        {...flow.nameSheet}
        hint="Adds to your Library. Share it with clients from here or from a client's Resources tab."
      />
    </>
  );
}
