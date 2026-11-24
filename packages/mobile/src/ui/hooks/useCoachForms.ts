import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import {
  COACH_CLIENT_FORMS_TABLES,
  COACH_FORMS_TABLES,
  COACH_FORM_RESPONSES_TABLES,
  COACH_FORM_SCHEDULES_TABLES,
  COACH_FORM_STATS_TABLES,
} from "@/adapters/storage/tables";
import {
  COACH_CLIENT_FORM_SETUP_ENTITY,
  COACH_FORM_ENTITY,
  COACH_FORM_REVIEW_ENTITY,
  COACH_FORM_SCHEDULE_ENTITY,
  reconcileClientForms,
  reconcileCoachFormSchedules,
  reconcileCoachForms,
  reconcileResponses,
  reviewResponseCommand,
  saveFormCommand,
  saveScheduleCommand,
  setClientFormSetupCommand,
} from "@/application/commands/coachForms.command";
import { processSyncQueue } from "@/application/commands/sync.command";
import type {
  ClientForm,
  ClientSetupInput,
  CoachForm,
  CoachFormConflict,
  CoachFormStats,
  CoachFormsLibrary,
  FormDraft,
  FormResponse,
  FormSchedule,
  ScheduleDraft,
} from "@/domain/models/coachForms";
import type { StoragePort, SyncQueueEntry } from "@/domain/ports/storage.port";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * PER-129 (APP-C1): cache-first reads for the coach forms screens, and the
 * offline-first writes behind them. Every read renders the SQLite cache at
 * once (offline too) and refreshes in the background; a read never replaces
 * something with a live queued write (`reconcile*`).
 */

function liveOfType(prefix: string, entityType: string) {
  return (storage: StoragePort): SyncQueueEntry[] =>
    storage
      .getUncompletedMutations()
      .filter(
        (e) =>
          e.entityType === entityType &&
          e.entityId?.startsWith(prefix) === true &&
          isAutoResolvableSyncEntry(e),
      );
}

type Opts = { enabled?: boolean };

/** Library (C10g) — forms with their current version. */
export function useCoachFormsLibrary(
  opts: Opts = {},
): CachedResourceState<CoachFormsLibrary> {
  return useCachedResource<CoachFormsLibrary>({
    read: (s, uid) => ({ value: s.getCachedCoachForms(uid), isStale: true }),
    fetcher: (api) => api.getCoachForms(),
    reconcile: reconcileCoachForms,
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s, uid) => liveOfType(`${uid}:`, COACH_FORM_ENTITY)(s),
    write: (s, uid, v) => s.cacheCoachForms(uid, v),
    tables: COACH_FORMS_TABLES,
    enabled: opts.enabled,
  });
}

/** Send rules. */
export function useCoachFormSchedules(
  opts: Opts = {},
): CachedResourceState<FormSchedule[]> {
  return useCachedResource<FormSchedule[]>({
    read: (s, uid) => ({
      value: s.getCachedCoachFormSchedules(uid),
      isStale: true,
    }),
    fetcher: (api) => api.getCoachFormSchedules(),
    reconcile: reconcileCoachFormSchedules,
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s, uid) =>
      liveOfType(`${uid}:`, COACH_FORM_SCHEDULE_ENTITY)(s),
    write: (s, uid, v) => s.cacheCoachFormSchedules(uid, v),
    tables: COACH_FORM_SCHEDULES_TABLES,
    enabled: opts.enabled,
  });
}

/** C10g "N/M" counts. */
export function useCoachFormStats(
  opts: Opts = {},
): CachedResourceState<CoachFormStats> {
  return useCachedResource<CoachFormStats>({
    read: (s, uid) => ({
      value: s.getCachedCoachFormStats(uid),
      isStale: true,
    }),
    fetcher: (api) => api.getCoachFormStats(),
    write: (s, uid, v) => s.cacheCoachFormStats(uid, v),
    tables: COACH_FORM_STATS_TABLES,
    enabled: opts.enabled,
  });
}

/** One client's "Sent to" list (C3.3b). */
export function useCoachClientForms(
  clientId: string,
  opts: Opts = {},
): CachedResourceState<ClientForm[]> {
  return useCachedResource<ClientForm[]>({
    read: (s, uid) => ({
      value: s.getCachedCoachClientForms(uid, clientId),
      isStale: true,
    }),
    fetcher: (api) => api.getCoachClientForms(clientId),
    reconcile: (s, uid, v) => reconcileClientForms(s, uid, clientId, v),
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s, uid) =>
      liveOfType(`${uid}:${clientId}:`, COACH_CLIENT_FORM_SETUP_ENTITY)(s),
    write: (s, uid, v) => s.cacheCoachClientForms(uid, clientId, v),
    tables: COACH_CLIENT_FORMS_TABLES,
    enabled: opts.enabled,
  });
}

/** One client's responses, newest first (History, compare). */
export function useCoachFormResponses(
  clientId: string,
  opts: Opts = {},
): CachedResourceState<FormResponse[]> {
  return useCachedResource<FormResponse[]>({
    read: (s, uid) => ({
      value: s.getCachedCoachFormResponses(uid, clientId),
      isStale: true,
    }),
    fetcher: async (api) => {
      const page = await api.getCoachFormResponses(clientId, { limit: 50 });
      return page.ok ? { ok: true, value: page.value.responses } : page;
    },
    reconcile: (s, uid, v) => reconcileResponses(s, uid, clientId, v),
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s, uid) =>
      liveOfType(`${uid}:${clientId}:`, COACH_FORM_REVIEW_ENTITY)(s),
    write: (s, uid, v) => s.cacheCoachFormResponses(uid, clientId, v),
    tables: COACH_FORM_RESPONSES_TABLES,
    enabled: opts.enabled,
  });
}

/** 409s the queue resolved by taking the server copy (re-read on change). */
export function useCoachFormConflicts(): {
  conflicts: CoachFormConflict[];
  dismiss: (key: string) => void;
  reload: () => void;
} {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const read = useCallback(
    () => (userId ? storage.getCoachFormConflicts(userId) : []),
    [storage, userId],
  );
  const [conflicts, setConflicts] = useState<CoachFormConflict[]>(read);
  const reload = useCallback(() => setConflicts(read()), [read]);
  useEffect(() => {
    reload();
    return storage.subscribe(["coach_form_conflicts"], reload);
  }, [storage, reload]);
  const dismiss = useCallback(
    (key: string) => {
      if (!userId) return;
      storage.clearCoachFormConflict(userId, key);
      reload();
    },
    [storage, userId, reload],
  );
  return { conflicts, dismiss, reload };
}

export type CoachFormsActions = {
  saveForm: (draft: FormDraft) => Promise<CoachForm | null>;
  saveSchedule: (draft: ScheduleDraft) => Promise<FormSchedule | null>;
  /**
   * C10j writes for one form (Pause / Resume: one per rule), all
   * queued before one drain, so an app killed mid-drain never leaves the
   * client half-paused and the screen never redraws in between.
   */
  setClientSetups: (
    clientId: string,
    formId: string,
    inputs: readonly ClientSetupInput[],
  ) => Promise<boolean>;
  review: (
    clientId: string,
    responseId: string,
    replyText?: string,
  ) => Promise<boolean>;
};

/**
 * The writes: cache + queue first (works offline), then try to drain.
 * `onLocalWrite` runs as soon as the cache holds the change (before the
 * drain, which can take a while with no signal), so screens update at once;
 * callers re-read again once the promise settles.
 */
export function useCoachFormsActions(
  opts: { onLocalWrite?: () => void } = {},
): CoachFormsActions {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const onLocalWrite = useRef(opts.onLocalWrite);
  onLocalWrite.current = opts.onLocalWrite;

  const drain = useCallback(async () => {
    onLocalWrite.current?.();
    try {
      await processSyncQueue(storage, auth, getApiBaseUrl());
    } catch (err) {
      console.error("[useCoachFormsActions] queue flush failed:", err);
    }
  }, [auth, storage]);

  const saveForm = useCallback(
    async (draft: FormDraft) => {
      if (!userId) return null;
      const form = saveFormCommand({ storage, userId }, draft);
      await drain();
      return form;
    },
    [storage, userId, drain],
  );

  const saveSchedule = useCallback(
    async (draft: ScheduleDraft) => {
      if (!userId) return null;
      const schedule = saveScheduleCommand({ storage, userId }, draft);
      await drain();
      return schedule;
    },
    [storage, userId, drain],
  );

  const setClientSetups = useCallback(
    async (
      clientId: string,
      formId: string,
      inputs: readonly ClientSetupInput[],
    ) => {
      if (!userId) return false;
      for (const input of inputs) {
        setClientFormSetupCommand({ storage, userId }, clientId, formId, input);
      }
      await drain();
      return true;
    },
    [storage, userId, drain],
  );

  const review = useCallback(
    async (clientId: string, responseId: string, replyText?: string) => {
      if (!userId) return false;
      reviewResponseCommand(
        { storage, userId },
        clientId,
        responseId,
        replyText,
      );
      await drain();
      return true;
    },
    [storage, userId, drain],
  );

  return { saveForm, saveSchedule, setClientSetups, review };
}
