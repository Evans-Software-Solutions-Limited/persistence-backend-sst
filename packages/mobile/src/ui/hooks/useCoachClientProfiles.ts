import { useCallback, useMemo, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { getApiBaseUrl } from "@/adapters/api";
import {
  COACH_CLIENT_PROFILES_TABLES,
  COACH_CLIENT_SETTINGS_TABLES,
} from "@/adapters/storage/tables";
import {
  adoptProfileDetail,
  createProfileCommand,
  dismissProfileConflict,
  dismissSettingsConflict,
  invitedFromCache,
  isLocalProfileId,
  liveCoachClientEntries,
  liveProfileEntries,
  liveSettingsEntries,
  patchSettingsCommand,
  reconcileInvitedProfiles,
  reconcileProfileDetail,
  reconcileSettings,
  resolveProfileId,
  saveSetupSectionCommand,
  updateProfileCommand,
} from "@/application/commands/coachClientProfiles.command";
import { processSyncQueue } from "@/application/commands/sync.command";
import type {
  CachedClientProfile,
  CachedClientSettings,
  ClientProfile,
  InviteRefusal,
  ProfileFields,
  SettingsPatch,
  SetupItem,
  SetupMealPlan,
  SetupResource,
  SetupSection,
} from "@/domain/models/coachClientProfiles";
import {
  DECLARATION_VERSION,
  declarationText,
  needsDeclaration,
} from "@/domain/models/coachDeclaration";
import type { CoachClientApiError } from "@/domain/ports/api.port";
import { newIdempotencyKey } from "@/shared/utils/idempotency";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * PER-125 (APP-A2): cache-first reads for the iPhone add-client flow,
 * invited client and C3.9 settings, the offline-first writes behind them,
 * and the online-only invite actions (design A D6).
 */

type Opts = { enabled?: boolean };

/** The coach's invited clients (Clients list, newest first). */
export function useInvitedClients(
  opts: Opts = {},
): CachedResourceState<CachedClientProfile[]> {
  return useCachedResource<CachedClientProfile[]>({
    read: (s, uid) => ({ value: invitedFromCache(s, uid), isStale: true }),
    fetcher: async (api) => {
      const list = await api.getInvitedClientProfiles();
      return list.ok
        ? { ok: true, value: list.value.data as CachedClientProfile[] }
        : list;
    },
    reconcile: (s, uid, v: ClientProfile[]) =>
      reconcileInvitedProfiles(s, uid, v),
    preserveConcurrentCacheWrites: true,
    pendingWrites: liveCoachClientEntries,
    // `reconcile` has already written each profile.
    write: () => {},
    tables: COACH_CLIENT_PROFILES_TABLES,
    enabled: opts.enabled,
  });
}

/** One profile with its set-up and code (C11g–s, C11i). */
export function useClientProfile(
  rawId: string,
  opts: Opts = {},
): CachedResourceState<CachedClientProfile> {
  const id = resolveProfileId(rawId);
  return useCachedResource<CachedClientProfile>({
    read: (s, uid) => ({
      value: s.getCachedCoachClientProfile(uid, resolveProfileId(id)),
      isStale: true,
    }),
    fetcher: (api) => api.getClientProfile(resolveProfileId(id)),
    reconcile: reconcileProfileDetail,
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s, uid) => liveProfileEntries(s, uid, resolveProfileId(id)),
    write: () => {},
    tables: COACH_CLIENT_PROFILES_TABLES,
    // A profile made offline isn't on the server until its create drains.
    enabled: (opts.enabled ?? true) && !isLocalProfileId(id),
  });
}

/** One client's C3.9 settings. */
export function useClientSettings(
  clientId: string,
  opts: Opts = {},
): CachedResourceState<CachedClientSettings> {
  return useCachedResource<CachedClientSettings>({
    read: (s, uid) => ({
      value: s.getCachedCoachClientSettings(uid, clientId),
      isStale: true,
    }),
    fetcher: (api) => api.getClientSettings(clientId),
    reconcile: (s, uid, v) => reconcileSettings(s, uid, clientId, v),
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s, uid) => liveSettingsEntries(s, uid, clientId),
    write: (s, uid, v) => s.cacheCoachClientSettings(uid, clientId, v),
    tables: COACH_CLIENT_SETTINGS_TABLES,
    enabled: opts.enabled,
  });
}

/** The coach's meal plans (C11p). Read online; nothing cached here. */
export function useSetupMealPlans(
  opts: Opts = {},
): CachedResourceState<SetupMealPlan[]> {
  return useCachedResource<SetupMealPlan[]>({
    read: () => ({ value: null, isStale: true }),
    fetcher: (api) => api.getSetupMealPlans(),
    write: () => {},
    enabled: opts.enabled,
  });
}

/** The coach's resources library (C11q). Read online; nothing cached here. */
export function useSetupResources(
  opts: Opts = {},
): CachedResourceState<SetupResource[]> {
  return useCachedResource<SetupResource[]>({
    read: () => ({ value: null, isStale: true }),
    fetcher: (api) => api.getSetupResources(),
    write: () => {},
    enabled: opts.enabled,
  });
}

export type CoachClientActions = {
  createProfile: (fields: ProfileFields) => CachedClientProfile | null;
  updateProfile: (
    id: string,
    patch: Partial<ProfileFields>,
    baseRevision?: number,
  ) => CachedClientProfile | null;
  saveSection: (
    id: string,
    section: SetupSection,
    items: readonly SetupItem[],
    baseRevision?: number,
  ) => CachedClientProfile | null;
  patchSettings: (
    clientId: string,
    patch: SettingsPatch,
  ) => CachedClientSettings | null;
  dismissProfileConflict: (id: string) => void;
  dismissSettingsConflict: (clientId: string) => void;
  /** Send what's queued now (resolves when the drain has finished). */
  flush: () => Promise<void>;
};

/**
 * The writes: cache + queue first (works offline), then a drain in the
 * background. Screens re-read from the cache at once (the resource hooks
 * subscribe to the tables).
 */
export function useCoachClientActions(): CoachClientActions {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const flush = useCallback(async () => {
    try {
      await processSyncQueue(storage, auth, getApiBaseUrl());
    } catch (err) {
      console.error("[useCoachClientActions] queue flush failed:", err);
    }
  }, [auth, storage]);

  return useMemo(() => {
    const deps = userId ? { storage, userId } : null;
    const run = <T>(fn: () => T): T => {
      const out = fn();
      void flush();
      return out;
    };
    return {
      createProfile: (fields) =>
        deps ? run(() => createProfileCommand(deps, fields)) : null,
      updateProfile: (id, patch, baseRevision) =>
        deps
          ? run(() => updateProfileCommand(deps, id, patch, baseRevision))
          : null,
      saveSection: (id, section, items, baseRevision) =>
        deps
          ? run(() =>
              saveSetupSectionCommand(deps, id, section, items, baseRevision),
            )
          : null,
      patchSettings: (clientId, patch) =>
        deps ? run(() => patchSettingsCommand(deps, clientId, patch)) : null,
      dismissProfileConflict: (id) => {
        if (deps) dismissProfileConflict(deps, id);
      },
      dismissSettingsConflict: (clientId) => {
        if (deps) dismissSettingsConflict(deps, clientId);
      },
      flush,
    };
  }, [storage, userId, flush]);
}

/** Map an invite call's refusal to the screen's terms. */
export function inviteRefusalOf(error: CoachClientApiError): InviteRefusal {
  if (error.code === "network" || error.code === "timeout") return "offline";
  if (error.serverCode === "declaration_required") {
    return "declaration_required";
  }
  if (error.code === "entitlement_denied" || error.status === 402) {
    return "no_seats";
  }
  if (error.serverCode === "profile_not_editable") return "not_editable";
  if (error.status === 404) return "not_found";
  return "failed";
}

export const INVITE_REFUSAL_COPY: Record<InviteRefusal, string> = {
  offline: "You're offline. Sending an invite needs a connection.",
  declaration_required: "Confirm the declaration to send invites.",
  no_seats: "No client seats left. Remove a client or change your plan.",
  not_editable: "This client has already accepted or the invite was cancelled.",
  not_found: "We couldn't find this client.",
  failed: "Something went wrong. Try again.",
};

async function textHash(): Promise<string | null> {
  try {
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      declarationText(),
    );
  } catch {
    return null;
  }
}

/**
 * Issue, resend and cancel a personal invite, and copy set-up from a client
 * (design A D3: online only), with the coach declaration asked first when it
 * isn't accepted (D6b). Shared by the invite step (C11h), the invited
 * client (C11i) and the checklist's Copy from a client (C11g).
 */
export function useInviteActions() {
  const { api, netInfo, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const actions = useCoachClientActions();
  const keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<InviteRefusal | null>(null);
  const [declarationFor, setDeclarationFor] = useState<string | null>(null);

  /** The profile's server id, once its create has drained (else null). */
  const serverId = useCallback(
    async (rawId: string): Promise<string | null> => {
      if (!(await netInfo.isConnected())) {
        setRefusal("offline");
        return null;
      }
      let id = resolveProfileId(rawId);
      if (isLocalProfileId(id)) {
        await actions.flush();
        id = resolveProfileId(rawId);
      }
      if (isLocalProfileId(id)) {
        setRefusal("offline");
        return null;
      }
      return id;
    },
    [actions, netInfo],
  );

  const refetch = useCallback(
    async (id: string) => {
      const detail = await api.getClientProfile(id);
      if (detail.ok && userId)
        adoptProfileDetail({ storage, userId }, detail.value);
    },
    [api, storage, userId],
  );

  const send = useCallback(
    async (id: string): Promise<boolean> => {
      // Reuse the key until a send succeeds, so a retry never makes two codes.
      const key = keys.current.get(id) ?? newIdempotencyKey("invite");
      keys.current.set(id, key);
      const result = await api.issueClientInvite(id, key);
      if (!result.ok) {
        const why = inviteRefusalOf(result.error);
        if (why === "declaration_required") setDeclarationFor(id);
        else setRefusal(why);
        return false;
      }
      keys.current.delete(id);
      await refetch(id);
      return true;
    },
    [api, refetch],
  );

  const issue = useCallback(
    async (rawId: string): Promise<boolean> => {
      setRefusal(null);
      setBusy(true);
      try {
        const id = await serverId(rawId);
        if (!id) return false;
        const status = await api.getCoachDeclaration();
        if (status.ok && needsDeclaration(status.value)) {
          setDeclarationFor(id);
          return false;
        }
        // A failed read falls through: the invite route checks it (403).
        return await send(id);
      } finally {
        setBusy(false);
      }
    },
    [api, send, serverId],
  );

  /** The declaration sheet's Confirm; returns the refusal to show on it. */
  const confirmDeclaration =
    useCallback(async (): Promise<CoachClientApiError | null> => {
      const id = declarationFor;
      if (!id) return null;
      setBusy(true);
      try {
        const accepted = await api.acceptCoachDeclaration(
          DECLARATION_VERSION,
          await textHash(),
          newIdempotencyKey("declaration"),
        );
        if (!accepted.ok) return accepted.error;
        setDeclarationFor(null);
        await send(id);
        return null;
      } finally {
        setBusy(false);
      }
    }, [api, declarationFor, send]);

  const cancel = useCallback(
    async (rawId: string): Promise<boolean> => {
      setRefusal(null);
      setBusy(true);
      try {
        const id = await serverId(rawId);
        if (!id) return false;
        const result = await api.cancelClientInvite(id);
        if (!result.ok) {
          setRefusal(inviteRefusalOf(result.error));
          return false;
        }
        await refetch(id);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [api, refetch, serverId],
  );

  const copyFrom = useCallback(
    async (rawId: string, sourceClientId: string): Promise<boolean> => {
      setRefusal(null);
      setBusy(true);
      try {
        const id = await serverId(rawId);
        if (!id) return false;
        // Queued section edits go first, so the copy starts from them.
        await actions.flush();
        const result = await api.copyClientSetup(id, sourceClientId);
        if (!result.ok) {
          setRefusal(inviteRefusalOf(result.error));
          return false;
        }
        if (userId) adoptProfileDetail({ storage, userId }, result.value);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [actions, api, serverId, storage, userId],
  );

  return {
    issue,
    cancel,
    copyFrom,
    confirmDeclaration,
    closeDeclaration: () => setDeclarationFor(null),
    declarationOpen: declarationFor !== null,
    busy,
    refusal,
  };
}
