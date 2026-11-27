import type {
  AthleteResource,
  ClientResource,
  CoachResource,
} from "@/domain/models/coachResources";
import type { StoragePort, SyncQueueEntry } from "@/domain/ports/storage.port";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";

/**
 * PER-143 (APP-I1): the offline side of resources (design I, "Offline").
 *
 * Queued, so they work offline:
 *   - a coach's new LINK (`POST /trainers/me/resources`, keyed);
 *   - assigning resources to one client (`POST /trainers/me/resources/assign`);
 *   - the athlete's opened stamp (`POST /users/me/resources/:id/opened`).
 * File uploads, removing from a client and deleting from the library need a
 * connection and go straight to the API from the containers.
 *
 * A link made offline gets a `local-…` id. An assign naming it waits in the
 * queue (the drain defers any payload holding a `local-…` id) until the
 * create syncs and `applyCoachResourcesSyncSuccess` swaps the id everywhere.
 */

export const COACH_RESOURCE_ENTITY = "coach_resource";
export const COACH_RESOURCE_ASSIGN_ENTITY = "coach_resource_assign";
export const MY_RESOURCE_OPENED_ENTITY = "my_resource_opened";
export const COACH_RESOURCES_ENTITIES: readonly string[] = [
  COACH_RESOURCE_ENTITY,
  COACH_RESOURCE_ASSIGN_ENTITY,
  MY_RESOURCE_OPENED_ENTITY,
];

export const RESOURCES_ENDPOINT = "/trainers/me/resources";
export const ASSIGN_ENDPOINT = "/trainers/me/resources/assign";

export type CoachResourcesDeps = {
  storage: StoragePort;
  userId: string;
  now?: () => Date;
};

function nowIso(deps: CoachResourcesDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

export function newLocalId(): string {
  return `local-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/** `local-…` → server id for links synced while the app has been running. */
const syncedIds = new Map<string, string>();

export function resolveResourceId(id: string): string {
  return syncedIds.get(id) ?? id;
}

function parseObject(payload: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(payload) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function userOf(entry: SyncQueueEntry): string | null {
  return entry.entityId?.split(":")[0] || null;
}

/** Queue rows of one type for this user that can still reach the server. */
export function liveResourceEntries(
  storage: StoragePort,
  entityType: string,
  prefix: string,
): SyncQueueEntry[] {
  return storage
    .getUncompletedMutations()
    .filter(
      (e) =>
        e.entityType === entityType &&
        e.entityId?.startsWith(prefix) === true &&
        isAutoResolvableSyncEntry(e),
    );
}

// ── Coach: a new link ─────────────────────────────────────────────────────────

/**
 * Add a link to the library, offline too. Returns it as cached. Pass the
 * `idempotencyKey` an online attempt already sent (e.g. it timed out after
 * the server saved it), so the queued replay can't make a second link.
 */
export function createLinkResourceCommand(
  deps: CoachResourcesDeps,
  input: { title: string; url: string },
  idempotencyKey?: string,
): CoachResource {
  const { storage, userId } = deps;
  const now = nowIso(deps);
  const resource: CoachResource = {
    id: newLocalId(),
    kind: "link",
    title: input.title.trim(),
    url: input.url.trim(),
    mediaId: null,
    mime: null,
    bytes: null,
    revision: 1,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  storage.cacheCoachResources(userId, [
    resource,
    ...(storage.getCachedCoachResources(userId) ?? []),
  ]);
  storage.enqueueMutation({
    entityType: COACH_RESOURCE_ENTITY,
    entityId: `${userId}:${resource.id}`,
    operation: "create",
    payload: { kind: "link", title: resource.title, url: resource.url },
    endpoint: RESOURCES_ENDPOINT,
    method: "POST",
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
  return resource;
}

/**
 * The server's rows for a share it accepted: each replaces this client's row
 * for the same resource (an optimistic `local-…` one included), so Remove
 * works straight away with the real assignment id.
 */
export function upsertAssignedLocally(
  deps: CoachResourcesDeps,
  clientId: string,
  rows: readonly ClientResource[],
): void {
  const { storage, userId } = deps;
  const mine = rows.filter((r) => r.clientId === clientId);
  if (mine.length === 0) return;
  const ids = new Set(mine.map((r) => r.resource.id));
  const cached = storage.getCachedCoachClientResources(userId, clientId) ?? [];
  storage.cacheCoachClientResources(userId, clientId, [
    ...mine,
    ...cached.filter((a) => !ids.has(a.resource.id)),
  ]);
}

/** A resource the server just made (an upload or an online link). */
export function rememberResource(
  deps: CoachResourcesDeps,
  resource: CoachResource,
): void {
  const { storage, userId } = deps;
  storage.cacheCoachResources(userId, [
    resource,
    ...(storage.getCachedCoachResources(userId) ?? []).filter(
      (r) => r.id !== resource.id,
    ),
  ]);
}

// ── Coach: assign to one client ───────────────────────────────────────────────

/** Show these resources on the client's tab now, as not opened. */
export function addAssignedLocally(
  deps: CoachResourcesDeps,
  clientId: string,
  resources: readonly CoachResource[],
  assignmentIdFor: (r: CoachResource) => string = () => newLocalId(),
): void {
  const { storage, userId } = deps;
  const cached = storage.getCachedCoachClientResources(userId, clientId) ?? [];
  const have = new Set(cached.map((a) => a.resource.id));
  const now = nowIso(deps);
  const added: ClientResource[] = resources
    .filter((r) => !have.has(r.id))
    .map((r) => ({
      assignmentId: assignmentIdFor(r),
      clientId,
      resource: r,
      assignedAt: now,
      openedAt: null,
    }));
  storage.cacheCoachClientResources(userId, clientId, [...added, ...cached]);
}

/**
 * Assign offline: the rows show at once and the assign waits in the queue.
 * Used when there's no connection, or when a resource is still `local-…`.
 */
export function queueAssignCommand(
  deps: CoachResourcesDeps,
  clientId: string,
  resources: readonly CoachResource[],
): void {
  if (resources.length === 0) return;
  addAssignedLocally(deps, clientId, resources);
  deps.storage.enqueueMutation({
    entityType: COACH_RESOURCE_ASSIGN_ENTITY,
    entityId: `${deps.userId}:${clientId}:${newLocalId()}`,
    operation: "create",
    payload: {
      resourceIds: resources.map((r) => resolveResourceId(r.id)),
      clientIds: [clientId],
    },
    endpoint: ASSIGN_ENDPOINT,
    method: "POST",
  });
}

/** Take rows off the client's tab (a remove, or a refused assign). */
export function dropAssignedLocally(
  deps: CoachResourcesDeps,
  clientId: string,
  keep: (a: ClientResource) => boolean,
): void {
  const { storage, userId } = deps;
  const cached = storage.getCachedCoachClientResources(userId, clientId);
  if (cached) {
    storage.cacheCoachClientResources(userId, clientId, cached.filter(keep));
  }
}

/** A resource deleted from the library leaves every client's tab. */
export function forgetResourceLocally(
  deps: CoachResourcesDeps,
  resourceId: string,
): void {
  const { storage, userId } = deps;
  const library = storage.getCachedCoachResources(userId);
  if (library) {
    storage.cacheCoachResources(
      userId,
      library.filter((r) => r.id !== resourceId),
    );
  }
  for (const { clientId, value } of storage.getAllCachedCoachClientResources(
    userId,
  )) {
    if (value.some((a) => a.resource.id === resourceId)) {
      storage.cacheCoachClientResources(
        userId,
        clientId,
        value.filter((a) => a.resource.id !== resourceId),
      );
    }
  }
}

/**
 * Queued assigns for this client the server refused with 403
 * `resources_off` (C3.9 switch, PER-150). 403 isn't a permanent error to the
 * drain, so the row may still be retrying; the screen says so either way.
 */
export function refusedAssigns(
  storage: StoragePort,
  userId: string,
  clientId: string,
): SyncQueueEntry[] {
  return storage
    .getUncompletedMutations()
    .filter(
      (e) =>
        e.entityType === COACH_RESOURCE_ASSIGN_ENTITY &&
        e.entityId?.startsWith(`${userId}:${clientId}:`) === true &&
        (e.errorMessage ?? "").includes("resources_off"),
    );
}

/** Dismiss refused assigns: drop the rows from the queue and the tab. */
export function dismissRefusedAssigns(
  deps: CoachResourcesDeps,
  clientId: string,
): void {
  const refused = refusedAssigns(deps.storage, deps.userId, clientId);
  if (refused.length === 0) return;
  const ids = new Set<string>();
  for (const e of refused) {
    const body = parseObject(e.payload);
    const resourceIds = Array.isArray(body?.resourceIds)
      ? (body.resourceIds as string[])
      : [];
    resourceIds.forEach((id) => ids.add(id));
  }
  deps.storage.discardEntries(refused.map((e) => e.id));
  dropAssignedLocally(
    deps,
    clientId,
    (a) => !(a.assignmentId.startsWith("local-") && ids.has(a.resource.id)),
  );
}

// ── Athlete: opened stamp ─────────────────────────────────────────────────────

/** Stamp opened (once) on the phone now; the POST waits in the queue. */
export function markOpenedCommand(
  deps: CoachResourcesDeps,
  assignmentId: string,
): void {
  const { storage, userId } = deps;
  const cached = storage.getCachedMyResources(userId) ?? [];
  const row = cached.find((r) => r.assignmentId === assignmentId);
  if (!row || row.openedAt) return;
  const now = nowIso(deps);
  storage.cacheMyResources(
    userId,
    cached.map((r) =>
      r.assignmentId === assignmentId ? { ...r, openedAt: now } : r,
    ),
  );
  const entityId = `${userId}:${assignmentId}`;
  if (
    liveResourceEntries(storage, MY_RESOURCE_OPENED_ENTITY, entityId).length > 0
  ) {
    return;
  }
  storage.enqueueMutation({
    entityType: MY_RESOURCE_OPENED_ENTITY,
    entityId,
    operation: "update",
    payload: {},
    endpoint: `/users/me/resources/${encodeURIComponent(assignmentId)}/opened`,
    method: "POST",
  });
}

// ── Sync success ──────────────────────────────────────────────────────────────

/**
 * A queued resources write synced. For a link create, take the server's
 * copy and swap its `local-…` id in the library, every client's tab and any
 * queued assign. Non-fatal by contract: the request already succeeded.
 */
export function applyCoachResourcesSyncSuccess(
  storage: StoragePort,
  entry: SyncQueueEntry,
  data: unknown,
): void {
  if (entry.entityType !== COACH_RESOURCE_ENTITY || entry.method !== "POST") {
    return;
  }
  const userId = userOf(entry);
  const localId = entry.entityId?.split(":")[1];
  const server = data as CoachResource | null;
  if (!userId || !localId || !server?.id) return;
  syncedIds.set(localId, server.id);
  const library = storage.getCachedCoachResources(userId);
  if (library) {
    storage.cacheCoachResources(
      userId,
      library
        .filter((r) => r.id !== server.id)
        .map((r) => (r.id === localId ? server : r)),
    );
  }
  for (const { clientId, value } of storage.getAllCachedCoachClientResources(
    userId,
  )) {
    if (value.some((a) => a.resource.id === localId)) {
      storage.cacheCoachClientResources(
        userId,
        clientId,
        value.map((a) =>
          a.resource.id === localId ? { ...a, resource: server } : a,
        ),
      );
    }
  }
  for (const e of storage.getUncompletedMutations()) {
    if (e.entityType !== COACH_RESOURCE_ASSIGN_ENTITY) continue;
    if (e.status === "in_flight") continue;
    const body = parseObject(e.payload);
    const ids = Array.isArray(body?.resourceIds)
      ? (body.resourceIds as unknown[])
      : null;
    if (!body || !ids?.includes(localId)) continue;
    storage.replaceInactiveMutationPayload(e.id, {
      ...body,
      resourceIds: ids.map((id) => (id === localId ? server.id : id)),
    });
  }
}

// ── Reconcile reads with queued intent ────────────────────────────────────────

/** The library read keeps links still waiting to sync, on top. */
export function reconcileCoachResources(
  storage: StoragePort,
  userId: string,
  server: CoachResource[],
): CoachResource[] {
  const waiting = new Set(
    liveResourceEntries(storage, COACH_RESOURCE_ENTITY, `${userId}:`).map(
      (e) => e.entityId!.split(":")[1],
    ),
  );
  const local = (storage.getCachedCoachResources(userId) ?? []).filter((r) =>
    waiting.has(r.id),
  );
  return [...local, ...server];
}

/** A client's tab keeps rows whose assign is still queued. */
export function reconcileClientResources(
  storage: StoragePort,
  userId: string,
  clientId: string,
  server: ClientResource[],
): ClientResource[] {
  const queued = new Set<string>();
  for (const e of liveResourceEntries(
    storage,
    COACH_RESOURCE_ASSIGN_ENTITY,
    `${userId}:${clientId}:`,
  )) {
    const body = parseObject(e.payload);
    const ids = Array.isArray(body?.resourceIds)
      ? (body.resourceIds as string[])
      : [];
    ids.forEach((id) => queued.add(id));
  }
  if (queued.size === 0) return server;
  const onServer = new Set(server.map((a) => a.resource.id));
  const pending = (
    storage.getCachedCoachClientResources(userId, clientId) ?? []
  ).filter(
    (a) =>
      a.assignmentId.startsWith("local-") &&
      queued.has(resolveResourceId(a.resource.id)) &&
      !onServer.has(resolveResourceId(a.resource.id)),
  );
  return [...pending, ...server];
}

/** The athlete's read keeps opened stamps still waiting to sync. */
export function reconcileMyResources(
  storage: StoragePort,
  userId: string,
  server: AthleteResource[],
): AthleteResource[] {
  const waiting = new Set(
    liveResourceEntries(storage, MY_RESOURCE_OPENED_ENTITY, `${userId}:`).map(
      (e) => e.entityId!.split(":")[1],
    ),
  );
  if (waiting.size === 0) return server;
  const cached = new Map(
    (storage.getCachedMyResources(userId) ?? []).map((r) => [
      r.assignmentId,
      r.openedAt,
    ]),
  );
  return server.map((r) =>
    !r.openedAt && waiting.has(r.assignmentId)
      ? {
          ...r,
          openedAt: cached.get(r.assignmentId) ?? new Date().toISOString(),
        }
      : r,
  );
}
