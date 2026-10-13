import { useCallback, useEffect, useState } from "react";
import { Share } from "react-native";
import { Redirect } from "expo-router";
import type { RequestLog, RequestLogEntry } from "@/adapters/api/requestLog";
import { HOME_ROUTE } from "@/application/notifications/deep-link";
import { isDiagnosticsAllowed } from "@/diagnostics/allowed";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { RequestLogPresenter } from "@/ui/presenters/RequestLogPresenter";

/** Hidden screen: what the API client sent, in order. Non-production only. */
export function RequestLogContainer() {
  if (!isDiagnosticsAllowed()) return <Redirect href={HOME_ROUTE} />;
  return <RequestLogSession />;
}

function RequestLogSession() {
  const { api } = useAdapters();
  const log = (api as { requestLog?: RequestLog }).requestLog ?? null;
  const [entries, setEntries] = useState<RequestLogEntry[]>(
    () => log?.entries() ?? [],
  );
  const refresh = useCallback(() => setEntries(log?.entries() ?? []), [log]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const share = useCallback(async () => {
    if (entries.length === 0) return;
    try {
      await Share.share({ message: JSON.stringify(entries, null, 2) });
    } catch {
      // Dismissed share sheets reject on some platforms; nothing to do.
    }
  }, [entries]);
  const clear = useCallback(() => {
    log?.clear();
    setEntries([]);
  }, [log]);
  return (
    <RequestLogPresenter
      entries={entries}
      onRefresh={refresh}
      onShare={share}
      onClear={clear}
    />
  );
}
