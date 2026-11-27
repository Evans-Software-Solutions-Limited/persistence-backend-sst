import { useCallback, useRef } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import {
  COACH_CLIENT_RESOURCES_TABLES,
  COACH_RESOURCES_TABLES,
  MY_RESOURCES_TABLES,
} from "@/adapters/storage/tables";
import {
  addAssignedLocally,
  COACH_RESOURCE_ASSIGN_ENTITY,
  COACH_RESOURCE_ENTITY,
  createLinkResourceCommand,
  dismissRefusedAssigns,
  dropAssignedLocally,
  forgetResourceLocally,
  liveResourceEntries,
  markOpenedCommand,
  MY_RESOURCE_OPENED_ENTITY,
  queueAssignCommand,
  reconcileClientResources,
  reconcileCoachResources,
  reconcileMyResources,
  rememberResource,
  resolveResourceId,
} from "@/application/commands/coachResources.command";
import { processSyncQueue } from "@/application/commands/sync.command";
import type {
  AssignRefusal,
  AthleteResource,
  ClientResource,
  CoachResource,
  ResourceSaveError,
} from "@/domain/models/coachResources";
import { isLocalResourceId } from "@/domain/services/coachResources.service";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * PER-143 (APP-I1): cache-first reads for the resources screens and the
 * writes behind them. Lists render the SQLite cache at once (offline too)
 * and refresh in the background; a read never drops a write still queued.
 */

type Opts = { enabled?: boolean };

/** The coach's library (C5b, the C3.7c picker). */
export function useCoachResourceLibrary(
  opts: Opts = {},
): CachedResourceState<CoachResource[]> {
  return useCachedResource<CoachResource[]>({
    read: (s, uid) => ({
      value: s.getCachedCoachResources(uid),
      isStale: true,
    }),
    fetcher: (api) => api.getCoachResources(),
    reconcile: reconcileCoachResources,
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s, uid) =>
      liveResourceEntries(s, COACH_RESOURCE_ENTITY, `${uid}:`),
    write: (s, uid, v) => s.cacheCoachResources(uid, v),
    tables: COACH_RESOURCES_TABLES,
    enabled: opts.enabled,
  });
}

/** One client's Resources tab (C3.7b). */
export function useCoachClientResources(
  clientId: string,
  opts: Opts = {},
): CachedResourceState<ClientResource[]> {
  return useCachedResource<ClientResource[]>({
    read: (s, uid) => ({
      value: s.getCachedCoachClientResources(uid, clientId),
      isStale: true,
    }),
    fetcher: (api) => api.getCoachClientResources(clientId),
    reconcile: (s, uid, v) => reconcileClientResources(s, uid, clientId, v),
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s, uid) =>
      liveResourceEntries(
        s,
        COACH_RESOURCE_ASSIGN_ENTITY,
        `${uid}:${clientId}:`,
      ),
    write: (s, uid, v) => s.cacheCoachClientResources(uid, clientId, v),
    tables: COACH_CLIENT_RESOURCES_TABLES,
    enabled: opts.enabled,
  });
}

/** The athlete's resources from every coach (Coach tab). */
export function useMyResources(
  opts: Opts = {},
): CachedResourceState<AthleteResource[]> {
  return useCachedResource<AthleteResource[]>({
    read: (s, uid) => ({ value: s.getCachedMyResources(uid), isStale: true }),
    fetcher: (api) => api.getMyResources(),
    reconcile: reconcileMyResources,
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s, uid) =>
      liveResourceEntries(s, MY_RESOURCE_OPENED_ENTITY, `${uid}:`),
    write: (s, uid, v) => s.cacheMyResources(uid, v),
    tables: MY_RESOURCES_TABLES,
    enabled: opts.enabled,
  });
}

export type AddLinkResult =
  | { ok: true; resource: CoachResource; queued: boolean }
  | { ok: false; error: ResourceSaveError };

export type AssignResult =
  | { ok: true; queued: boolean }
  | { ok: false; refusal: AssignRefusal };

export type UploadInput = {
  title: string;
  contentType: string;
  /** Reads the picked file (`readLocalFile` in the app). */
  read: () => Promise<Blob>;
};

export type UploadResult =
  | { ok: true; resource: CoachResource }
  | { ok: false; error: ApiError | { kind: "file"; message: string } };

const isTransport = (e: ApiError) =>
  e.code === "network" || e.code === "timeout";

function newKey(): string {
  return `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The coach's resource writes. A link and an assign go straight to the API
 * when online (so a 422 lands on the form and a 403 `resources_off` shows at
 * once) and fall back to the offline queue when there's no connection.
 * Uploads, remove and delete need a connection.
 */
export function useCoachResourceActions(
  opts: { online: boolean; onLocalWrite?: () => void } = { online: true },
) {
  const { api, auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const onLocalWrite = useRef(opts.onLocalWrite);
  onLocalWrite.current = opts.onLocalWrite;
  const online = opts.online;

  const drain = useCallback(async () => {
    onLocalWrite.current?.();
    try {
      await processSyncQueue(storage, auth, getApiBaseUrl());
    } catch (err) {
      console.error("[useCoachResourceActions] queue flush failed:", err);
    }
  }, [auth, storage]);

  const addLink = useCallback(
    async (input: { title: string; url: string }): Promise<AddLinkResult> => {
      if (!userId) {
        return {
          ok: false,
          error: { kind: "api", code: "unauthorized", message: "Signed out" },
        };
      }
      const deps = { storage, userId };
      const value = { title: input.title.trim(), url: input.url.trim() };
      if (online) {
        const result = await api.createCoachResource(
          { kind: "link", ...value },
          newKey(),
        );
        if (result.ok) {
          rememberResource(deps, result.value);
          onLocalWrite.current?.();
          return { ok: true, resource: result.value, queued: false };
        }
        if (!isTransport(result.error))
          return { ok: false, error: result.error };
      }
      const resource = createLinkResourceCommand(deps, value);
      await drain();
      return { ok: true, resource, queued: true };
    },
    [api, storage, userId, online, drain],
  );

  const assign = useCallback(
    async (
      clientId: string,
      picked: readonly CoachResource[],
    ): Promise<AssignResult> => {
      if (!userId || picked.length === 0) return { ok: true, queued: false };
      const deps = { storage, userId };
      const library = storage.getCachedCoachResources(userId) ?? [];
      // A link made offline may have synced since it was picked.
      const resources = picked.map((r) => {
        const id = resolveResourceId(r.id);
        return library.find((x) => x.id === id) ?? { ...r, id };
      });
      const hasLocal = resources.some((r) => isLocalResourceId(r.id));
      if (online && !hasLocal) {
        const result = await api.assignCoachResources(
          resources.map((r) => r.id),
          [clientId],
        );
        if (result.ok) {
          addAssignedLocally(deps, clientId, resources);
          onLocalWrite.current?.();
          return { ok: true, queued: false };
        }
        if (result.error.kind !== "offline") {
          return { ok: false, refusal: result.error };
        }
      }
      queueAssignCommand(deps, clientId, resources);
      await drain();
      return { ok: true, queued: true };
    },
    [api, storage, userId, online, drain],
  );

  /** Library → Share: one resource to several clients (bulk). */
  const assignMany = useCallback(
    async (
      picked: CoachResource,
      clientIds: readonly string[],
    ): Promise<AssignResult> => {
      if (!userId || clientIds.length === 0) return { ok: true, queued: false };
      const deps = { storage, userId };
      const id = resolveResourceId(picked.id);
      const resource = (storage.getCachedCoachResources(userId) ?? []).find(
        (x) => x.id === id,
      ) ?? { ...picked, id };
      if (online && !isLocalResourceId(resource.id)) {
        const result = await api.assignCoachResources(
          [resource.id],
          [...clientIds],
        );
        if (result.ok) {
          for (const clientId of clientIds) {
            if (storage.getCachedCoachClientResources(userId, clientId)) {
              addAssignedLocally(deps, clientId, [resource]);
            }
          }
          onLocalWrite.current?.();
          return { ok: true, queued: false };
        }
        if (result.error.kind !== "offline") {
          return { ok: false, refusal: result.error };
        }
      }
      for (const clientId of clientIds) {
        queueAssignCommand(deps, clientId, [resource]);
      }
      await drain();
      return { ok: true, queued: true };
    },
    [api, storage, userId, online, drain],
  );

  const remove = useCallback(
    async (clientId: string, row: ClientResource) => {
      if (!userId) return { ok: false as const, message: "Signed out" };
      if (isLocalResourceId(row.assignmentId)) {
        return {
          ok: false as const,
          message: "This is still being shared. Try again in a moment.",
        };
      }
      const result = await api.removeCoachClientResource(
        clientId,
        row.assignmentId,
      );
      if (!result.ok)
        return { ok: false as const, message: result.error.message };
      dropAssignedLocally(
        { storage, userId },
        clientId,
        (a) => a.assignmentId !== row.assignmentId,
      );
      onLocalWrite.current?.();
      return { ok: true as const };
    },
    [api, storage, userId],
  );

  const archive = useCallback(
    async (resource: CoachResource) => {
      if (!userId) return { ok: false as const, message: "Signed out" };
      if (isLocalResourceId(resource.id)) {
        return {
          ok: false as const,
          message: "This link is still saving. Try again in a moment.",
        };
      }
      const result = await api.archiveCoachResource(resource.id);
      if (!result.ok)
        return { ok: false as const, message: result.error.message };
      forgetResourceLocally({ storage, userId }, resource.id);
      onLocalWrite.current?.();
      return { ok: true as const };
    },
    [api, storage, userId],
  );

  const upload = useCallback(
    async (input: UploadInput): Promise<UploadResult> => {
      if (!userId) {
        return {
          ok: false,
          error: { kind: "api", code: "unauthorized", message: "Signed out" },
        };
      }
      let file: Blob;
      try {
        file = await input.read();
      } catch {
        return {
          ok: false,
          error: { kind: "file", message: "That photo couldn't be read." },
        };
      }
      const media = await api.createCoachResourceUpload(
        input.contentType,
        file.size,
        newKey(),
      );
      if (!media.ok) return { ok: false, error: media.error };
      if (media.value.upload) {
        const put = await api.putCoachResourceFile(media.value.upload, file);
        if (!put.ok) return { ok: false, error: put.error };
      }
      const created = await api.createCoachResource(
        {
          kind: "file",
          title: input.title.trim(),
          mediaId: media.value.mediaId,
        },
        newKey(),
      );
      if (!created.ok) return { ok: false, error: created.error };
      rememberResource({ storage, userId }, created.value);
      onLocalWrite.current?.();
      return { ok: true, resource: created.value };
    },
    [api, storage, userId],
  );

  const dismissRefused = useCallback(
    (clientId: string) => {
      if (!userId) return;
      dismissRefusedAssigns({ storage, userId }, clientId);
      onLocalWrite.current?.();
    },
    [storage, userId],
  );

  return {
    addLink,
    assign,
    assignMany,
    remove,
    archive,
    upload,
    dismissRefused,
  };
}

/** The athlete opened a resource: stamp it (queued) and send it. */
export function useMarkResourceOpened() {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  return useCallback(
    async (assignmentId: string) => {
      if (!userId) return;
      markOpenedCommand({ storage, userId }, assignmentId);
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useMarkResourceOpened] queue flush failed:", err);
      }
    },
    [auth, storage, userId],
  );
}
