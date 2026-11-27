import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { refusedAssigns } from "@/application/commands/coachResources.command";
import type {
  AssignRefusal,
  ClientResource,
  CoachResource,
} from "@/domain/models/coachResources";
import {
  pickable,
  resourcesOffMessage,
} from "@/domain/services/coachResources.service";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import {
  useCoachClientResources,
  useCoachResourceActions,
  useCoachResourceLibrary,
} from "@/ui/hooks/useCoachResources";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { AddResourcesSheetPresenter } from "@/ui/presenters/coachResources/AddResourcesSheetPresenter";
import { ClientResourcesTabPresenter } from "@/ui/presenters/coachResources/ClientResourcesTabPresenter";
import {
  LinkResourceSheetPresenter,
  NameResourceSheetPresenter,
} from "@/ui/presenters/coachResources/ResourceFormSheets";
import { useNewResourceFlow } from "./useNewResourceFlow";

export function firstNameOf(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || "your client";
}

/** One line for a refused share. */
export function refusalMessage(
  refusal: AssignRefusal,
  clientFirst: string,
): string {
  switch (refusal.kind) {
    case "resources_off":
      return resourcesOffMessage(clientFirst);
    case "not_your_client":
      return `${clientFirst} isn't one of your active clients any more.`;
    case "not_found":
      return "That resource was deleted. Refresh and try again.";
    case "offline":
      return "You're offline. Try again when you're back online.";
    case "other":
      return refusal.message;
  }
}

/**
 * C3.7b/c on iPhone — the client's Resources tab and the "Add resources"
 * sheet. Reads the SQLite cache first (works offline); a share or a link
 * made offline waits in the queue. Upload, Remove need a connection. A share
 * refused with 403 `resources_off` (C3.9 switch) says so at once, or, for a
 * queued one, as a note on the tab.
 */
export function ClientResourcesContainer(p: {
  clientId: string;
  clientName: string | null;
  /** Bumped by the page's pull-to-refresh. */
  refreshKey?: number;
}) {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const online = useOnlineStatus();
  const firstName = firstNameOf(p.clientName);
  const rows = useCoachClientResources(p.clientId);
  const library = useCoachResourceLibrary();
  const reloadRows = rows.reload;
  const reloadLibrary = library.reload;
  const actions = useCoachResourceActions({
    online,
    onLocalWrite: () => {
      reloadRows();
      reloadLibrary();
    },
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshRows = rows.refresh;
  const refreshLibrary = library.refresh;
  useEffect(() => {
    if (p.refreshKey) {
      void refreshRows();
      void refreshLibrary();
    }
  }, [p.refreshKey, refreshRows, refreshLibrary]);

  const assigned = useMemo(() => rows.data ?? [], [rows.data]);
  const candidates = useMemo(
    () => pickable(library.data ?? [], assigned, query),
    [library.data, assigned, query],
  );
  const refused =
    userId !== null &&
    rows.data !== null &&
    refusedAssigns(storage, userId, p.clientId).length > 0;

  const share = useCallback(
    async (resources: CoachResource[]): Promise<boolean> => {
      const result = await actions.assign(p.clientId, resources);
      if (!result.ok) {
        setSheetError(refusalMessage(result.refusal, firstName));
        return false;
      }
      if (!result.queued) void refreshRows({ silent: true });
      return true;
    },
    [actions, p.clientId, firstName, refreshRows],
  );

  const flow = useNewResourceFlow({
    online,
    actions,
    onCreated: (resource) => {
      void (async () => {
        if (await share([resource])) {
          setNotice(`Added ${resource.title} for ${firstName}.`);
        } else {
          setOpen(true);
        }
      })();
    },
  });

  const addSelected = useCallback(async () => {
    const picked = (library.data ?? []).filter((r) => selected.includes(r.id));
    if (picked.length === 0) return;
    setBusy(true);
    setSheetError(null);
    try {
      if (await share(picked)) {
        setSelected([]);
        setOpen(false);
        setNotice(
          `Shared ${picked.length === 1 ? "1 resource" : `${picked.length} resources`} with ${firstName}.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }, [library.data, selected, share, firstName]);

  const onRow = useCallback(
    (row: ClientResource) => {
      Alert.alert(
        `Remove ${row.resource.title}?`,
        `${firstName} won't see it any more. It stays in your Library.`,
        [
          { text: "Keep", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              if (!online) {
                Alert.alert(
                  "You're offline",
                  "Removing needs a connection. Try again when you're back online.",
                );
                return;
              }
              const result = await actions.remove(p.clientId, row);
              if (!result.ok) {
                Alert.alert("Couldn't remove it", result.message);
                return;
              }
              setNotice(`Removed ${row.resource.title} from ${firstName}.`);
            },
          },
        ],
      );
    },
    [actions, firstName, online, p.clientId],
  );

  const hint = `Adds to your Library and shares with ${firstName}.`;

  return (
    <>
      <ClientResourcesTabPresenter
        firstName={firstName}
        rows={rows.data}
        offline={!online}
        refused={refused}
        notice={notice}
        onAdd={() => {
          setSheetError(null);
          setQuery("");
          setOpen(true);
        }}
        onRow={onRow}
        onDismissRefused={() => actions.dismissRefused(p.clientId)}
        onDismissNotice={() => setNotice(null)}
      />
      <AddResourcesSheetPresenter
        visible={open}
        onClose={() => setOpen(false)}
        firstName={firstName}
        candidates={candidates}
        libraryCount={library.data?.length ?? 0}
        query={query}
        onQuery={setQuery}
        selected={selected}
        onToggle={(id) =>
          setSelected((s) =>
            s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
          )
        }
        busy={busy || flow.busy}
        offline={!online}
        error={sheetError}
        onUpload={() => {
          setOpen(false);
          void flow.startUpload();
        }}
        onLink={() => {
          setOpen(false);
          flow.startLink();
        }}
        onAdd={() => void addSelected()}
      />
      <LinkResourceSheetPresenter {...flow.linkSheet} hint={hint} />
      <NameResourceSheetPresenter {...flow.nameSheet} hint={hint} />
    </>
  );
}
