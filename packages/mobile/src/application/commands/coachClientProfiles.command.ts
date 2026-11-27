/**
 * PER-125 (APP-A2) — invited clients, their set-up and C3.9 settings,
 * offline-first (design A D6).
 *
 * Every write caches optimistically and goes through the sync queue:
 *
 * | entity type             | request                                                  |
 * | ----------------------- | -------------------------------------------------------- |
 * | `coach_client_profile`  | POST /trainers/me/client-profiles (Idempotency-Key)       |
 * |                         | PATCH /trainers/me/client-profiles/:id + expectedRevision |
 * |                         | DELETE /trainers/me/client-profiles/:id                   |
 * | `coach_client_setup`    | PUT …/client-profiles/:id/setup/:section + revision      |
 * | `coach_client_settings` | PATCH /trainers/me/clients/:clientId/settings + revision |
 *
 * Entity ids are `<userId>:<profileId>[:<section>]` or `<userId>:<clientId>`
 * so the drain knows whose cache to update.
 *
 * Coalescing: an edit folds into a queued row nothing has sent yet for the
 * same entity — a profile edit into its create or PATCH, a section into the
 * section's PUT (the last write wins), a settings change into the queued
 * PATCH. A set-up item may name a form, rule or plan made offline: its
 * create drains first and the storage remap rewrites `refId`
 * (`remapCoachClientSetupRefs`).
 *
 * Revisions: every profile and set-up write moves the profile's revision on.
 * The phone keeps the revision it has; when one queued write succeeds, the
 * later ones based on that revision move to the server's new one (they are
 * this phone's own chain, not a conflict).
 *
 * A 409 `revision_conflict` means another device changed it: the cache takes
 * the server copy (`current`), this phone's queued writes for it are dropped
 * and `conflictAt` is set so the screens say "Updated on another device".
 *
 * Issuing, resending or cancelling a code and copy-from are online only
 * (the hooks call the API directly), as design A D6 says.
 */
import type { StoragePort, SyncQueueEntry } from "@/domain/ports/storage.port";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";
import type {
  CachedClientProfile,
  CachedClientSettings,
  ClientProfile,
  ClientProfileDetail,
  ClientSettings,
  ProfileFields,
  SettingsPatch,
  SetupItem,
  SetupSection,
} from "@/domain/models/coachClientProfiles";
import {
  applySettingsPatch,
  mergeSettingsPatch,
} from "@/domain/services/coachClientProfiles.service";

export const COACH_CLIENT_PROFILE_ENTITY = "coach_client_profile";
export const COACH_CLIENT_SETUP_ENTITY = "coach_client_setup";
export const COACH_CLIENT_SETTINGS_ENTITY = "coach_client_settings";
export const COACH_CLIENT_ENTITIES: readonly string[] = [
  COACH_CLIENT_PROFILE_ENTITY,
  COACH_CLIENT_SETUP_ENTITY,
  COACH_CLIENT_SETTINGS_ENTITY,
];

export const PROFILES_ENDPOINT = "/trainers/me/client-profiles";

export type CoachClientDeps = {
  storage: StoragePort;
  userId: string;
  now?: () => Date;
};

export function isLocalProfileId(id: string): boolean {
  return id.startsWith("local-");
}

/**
 * `local-…` → server id for profiles created while the app has been
 * running, so a screen opened on an offline profile follows it once synced.
 */
const syncedIds = new Map<string, string>();

export function resolveProfileId(id: string): string {
  return syncedIds.get(id) ?? id;
}

/** Test-only: forget the synced ids between tests. */
export function resetSyncedProfileIdsForTest(): void {
  syncedIds.clear();
}

function newLocalId(): string {
  return `local-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function nowIso(deps: { now?: () => Date }): string {
  return (deps.now?.() ?? new Date()).toISOString();
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

/** A queued row nothing has sent yet: safe to fold a newer edit into. */
function isFoldable(e: SyncQueueEntry): boolean {
  return (
    (e.status === "pending" || e.status === "failed") &&
    e.retryCount < e.maxRetries &&
    e.dispatchCount === 0
  );
}

const profileKey = (userId: string, profileId: string) =>
  `${userId}:${profileId}`;

/**
 * Rows for one profile (its own and its sections') that can still reach the
 * server, oldest first.
 */
export function liveProfileEntries(
  storage: StoragePort,
  userId: string,
  profileId: string,
): SyncQueueEntry[] {
  const key = profileKey(userId, profileId);
  return storage
    .getUncompletedMutations()
    .filter(
      (e) =>
        (e.entityType === COACH_CLIENT_PROFILE_ENTITY ||
          e.entityType === COACH_CLIENT_SETUP_ENTITY) &&
        (e.entityId === key || e.entityId?.startsWith(`${key}:`) === true) &&
        isAutoResolvableSyncEntry(e),
    );
}

export function liveSettingsEntries(
  storage: StoragePort,
  userId: string,
  clientId: string,
): SyncQueueEntry[] {
  return storage
    .getQueuedEntriesForEntity(
      COACH_CLIENT_SETTINGS_ENTITY,
      `${userId}:${clientId}`,
    )
    .filter(isAutoResolvableSyncEntry);
}

/** Every live invited-client row for this coach (the list's pending writes). */
export function liveCoachClientEntries(
  storage: StoragePort,
  userId: string,
): SyncQueueEntry[] {
  return storage
    .getUncompletedMutations()
    .filter(
      (e) =>
        (e.entityType === COACH_CLIENT_PROFILE_ENTITY ||
          e.entityType === COACH_CLIENT_SETUP_ENTITY) &&
        e.entityId?.startsWith(`${userId}:`) === true &&
        isAutoResolvableSyncEntry(e),
    );
}

function blankProfile(
  deps: CoachClientDeps,
  id: string,
  fields: ProfileFields,
): CachedClientProfile {
  const now = nowIso(deps);
  return {
    id,
    ...fields,
    status: "invited",
    clientId: null,
    relationshipId: null,
    acceptedAt: null,
    cancelledAt: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    setup: {},
    invite: null,
    conflictAt: null,
  };
}

// ── Profiles ─────────────────────────────────────────────────────────────────

/** C11f Next: the profile exists now (shown as Invited), synced when it can. */
export function createProfileCommand(
  deps: CoachClientDeps,
  fields: ProfileFields,
): CachedClientProfile {
  const id = newLocalId();
  const profile = blankProfile(deps, id, fields);
  deps.storage.cacheCoachClientProfile(deps.userId, profile);
  deps.storage.enqueueMutation({
    entityType: COACH_CLIENT_PROFILE_ENTITY,
    entityId: profileKey(deps.userId, id),
    operation: "create",
    payload: fields,
    endpoint: PROFILES_ENDPOINT,
    method: "POST",
  });
  return profile;
}

/**
 * Edit Who (or private notes): only the fields that changed are sent.
 * `baseRevision` is the revision the edit started from, when the screen
 * knows another device may have changed those fields since (then the
 * server decides: a 409 if it did).
 */
export function updateProfileCommand(
  deps: CoachClientDeps,
  rawId: string,
  patch: Partial<ProfileFields>,
  baseRevision?: number,
): CachedClientProfile | null {
  const { storage, userId } = deps;
  const profileId = resolveProfileId(rawId);
  const cached = storage.getCachedCoachClientProfile(userId, profileId);
  if (!cached) return null;
  const next: CachedClientProfile = {
    ...cached,
    ...patch,
    updatedAt: nowIso(deps),
  };
  storage.cacheCoachClientProfile(userId, next);
  if (Object.keys(patch).length === 0) return next;

  const entityId = profileKey(userId, profileId);
  const foldInto = storage
    .getQueuedEntriesForEntity(COACH_CLIENT_PROFILE_ENTITY, entityId)
    .filter(
      (e) =>
        isAutoResolvableSyncEntry(e) && isFoldable(e) && e.method !== "DELETE",
    )
    .at(-1);
  if (foldInto) {
    storage.updateMutationPayload(foldInto.id, {
      ...(parseObject(foldInto.payload) ?? {}),
      ...patch,
    });
    return next;
  }
  storage.enqueueMutation({
    entityType: COACH_CLIENT_PROFILE_ENTITY,
    entityId,
    operation: "update",
    // 0 = "the create hasn't answered yet"; rebased when it does.
    payload: { ...patch, expectedRevision: baseRevision ?? cached.revision },
    endpoint: `${PROFILES_ENDPOINT}/${profileId}`,
    method: "PATCH",
  });
  return next;
}

/**
 * Back on a section page (C11l–r): replace that section. The queue keeps the
 * latest write per section (design A D3). `baseRevision`: as for
 * `updateProfileCommand`, the revision the page opened on.
 */
export function saveSetupSectionCommand(
  deps: CoachClientDeps,
  rawId: string,
  section: SetupSection,
  items: readonly SetupItem[],
  baseRevision?: number,
): CachedClientProfile | null {
  const { storage, userId } = deps;
  const profileId = resolveProfileId(rawId);
  const cached = storage.getCachedCoachClientProfile(userId, profileId);
  if (!cached) return null;
  const clean = items.map((i, index) => ({
    refId: i.refId,
    config: i.config,
    sortOrder: index,
  }));
  const setup = { ...cached.setup };
  if (clean.length === 0) delete setup[section];
  else setup[section] = clean;
  const next: CachedClientProfile = {
    ...cached,
    setup,
    updatedAt: nowIso(deps),
  };
  storage.cacheCoachClientProfile(userId, next);

  const entityId = `${profileKey(userId, profileId)}:${section}`;
  const foldInto = storage
    .getQueuedEntriesForEntity(COACH_CLIENT_SETUP_ENTITY, entityId)
    .filter((e) => isAutoResolvableSyncEntry(e) && isFoldable(e))
    .at(-1);
  if (foldInto) {
    storage.updateMutationPayload(foldInto.id, {
      ...(parseObject(foldInto.payload) ?? {}),
      items: clean,
    });
    return next;
  }
  storage.enqueueMutation({
    entityType: COACH_CLIENT_SETUP_ENTITY,
    entityId,
    operation: "update",
    payload: {
      items: clean,
      expectedRevision: baseRevision ?? cached.revision,
    },
    endpoint: `${PROFILES_ENDPOINT}/${profileId}/setup/${section}`,
    method: "PUT",
  });
  return next;
}

/**
 * Drop a profile that hasn't been accepted (C11f Cancel on a new client). A
 * profile that never reached the server is simply never sent.
 */
export function deleteProfileCommand(
  deps: CoachClientDeps,
  rawId: string,
): void {
  const { storage, userId } = deps;
  const profileId = resolveProfileId(rawId);
  storage.removeCachedCoachClientProfile(userId, profileId);
  // A create the server may already have seen (sent, or being sent) still
  // needs the DELETE; one nothing sent is simply dropped with the rest.
  const mayExist =
    !isLocalProfileId(profileId) ||
    storage
      .getQueuedEntriesForEntity(
        COACH_CLIENT_PROFILE_ENTITY,
        profileKey(userId, profileId),
      )
      .some(
        (e) =>
          e.method === "POST" &&
          (e.status === "in_flight" || e.dispatchCount > 0),
      );
  // Such a create is kept, so it answers and the DELETE gets its server id.
  const queued = liveProfileEntries(storage, userId, profileId).filter(
    (e) => e.status !== "in_flight" && !(mayExist && e.method === "POST"),
  );
  storage.discardEntries(queued.map((e) => e.id));
  if (!mayExist) return;
  storage.enqueueMutation({
    entityType: COACH_CLIENT_PROFILE_ENTITY,
    entityId: profileKey(userId, profileId),
    operation: "delete",
    payload: {},
    endpoint: `${PROFILES_ENDPOINT}/${profileId}`,
    method: "DELETE",
  });
}

/** The screens have shown "Updated on another device"; stop showing it. */
export function dismissProfileConflict(
  deps: CoachClientDeps,
  profileId: string,
): void {
  const cached = deps.storage.getCachedCoachClientProfile(
    deps.userId,
    profileId,
  );
  if (!cached?.conflictAt) return;
  deps.storage.cacheCoachClientProfile(deps.userId, {
    ...cached,
    conflictAt: null,
  });
}

/** A copy-from or invite answered online: the cache takes the server row. */
export function adoptProfileDetail(
  deps: CoachClientDeps,
  detail: ClientProfileDetail,
): void {
  const cached = deps.storage.getCachedCoachClientProfile(
    deps.userId,
    detail.id,
  );
  deps.storage.cacheCoachClientProfile(deps.userId, {
    ...detail,
    conflictAt: cached?.conflictAt ?? null,
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * `GET …/client-profiles?status=invited` → the cache. Profiles keep their
 * cached set-up and code (the list doesn't carry them); a profile with a
 * live queued write keeps the phone's copy; profiles the server no longer
 * lists as invited leave the cache unless they're still only on this phone.
 */
export function reconcileInvitedProfiles(
  storage: StoragePort,
  userId: string,
  listed: readonly ClientProfile[],
): CachedClientProfile[] {
  const cached = new Map(
    storage.getCachedCoachClientProfiles(userId).map((p) => [p.id, p]),
  );
  const live = new Set(
    liveCoachClientEntries(storage, userId).map(
      (e) => e.entityId!.split(":")[1]!,
    ),
  );
  const listedIds = new Set(listed.map((p) => p.id));
  for (const p of listed) {
    if (live.has(p.id)) continue;
    const prev = cached.get(p.id);
    storage.cacheCoachClientProfile(userId, {
      ...p,
      setup: prev?.setup ?? {},
      invite: prev?.invite ?? null,
      conflictAt: prev?.conflictAt ?? null,
    });
  }
  for (const p of cached.values()) {
    if (listedIds.has(p.id) || live.has(p.id) || isLocalProfileId(p.id)) {
      continue;
    }
    if (p.status === "invited")
      storage.removeCachedCoachClientProfile(userId, p.id);
  }
  return invitedFromCache(storage, userId);
}

/** The cached invited profiles, newest first. */
export function invitedFromCache(
  storage: StoragePort,
  userId: string,
): CachedClientProfile[] {
  return storage
    .getCachedCoachClientProfiles(userId)
    .filter((p) => p.status === "invited")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** `GET …/client-profiles/:id` → the cache, unless a write is still queued. */
export function reconcileProfileDetail(
  storage: StoragePort,
  userId: string,
  detail: ClientProfileDetail,
): CachedClientProfile {
  const cached = storage.getCachedCoachClientProfile(userId, detail.id);
  if (cached && liveProfileEntries(storage, userId, detail.id).length > 0) {
    // The phone's newer edits win; the code and status are the server's.
    const kept = { ...cached, invite: detail.invite, status: detail.status };
    storage.cacheCoachClientProfile(userId, kept);
    return kept;
  }
  const next = { ...detail, conflictAt: cached?.conflictAt ?? null };
  storage.cacheCoachClientProfile(userId, next);
  return next;
}

// ── C3.9 settings ────────────────────────────────────────────────────────────

/** One switch, the target or the alert mode: cached now, queued to send. */
export function patchSettingsCommand(
  deps: CoachClientDeps,
  clientId: string,
  patch: SettingsPatch,
): CachedClientSettings | null {
  const { storage, userId } = deps;
  const cached = storage.getCachedCoachClientSettings(userId, clientId);
  if (!cached) return null;
  const next = applySettingsPatch(cached, patch);
  storage.cacheCoachClientSettings(userId, clientId, next);
  const entityId = `${userId}:${clientId}`;
  const foldInto = liveSettingsEntries(storage, userId, clientId)
    .filter(isFoldable)
    .at(-1);
  if (foldInto) {
    const prev = parseObject(foldInto.payload) ?? {};
    const { expectedRevision, ...older } = prev;
    storage.updateMutationPayload(foldInto.id, {
      ...mergeSettingsPatch(older as SettingsPatch, patch),
      expectedRevision,
    });
    return next;
  }
  storage.enqueueMutation({
    entityType: COACH_CLIENT_SETTINGS_ENTITY,
    entityId,
    operation: "update",
    payload: { ...patch, expectedRevision: cached.revision },
    endpoint: `/trainers/me/clients/${clientId}/settings`,
    method: "PATCH",
  });
  return next;
}

export function reconcileSettings(
  storage: StoragePort,
  userId: string,
  clientId: string,
  server: ClientSettings,
): CachedClientSettings {
  const cached = storage.getCachedCoachClientSettings(userId, clientId);
  if (cached && liveSettingsEntries(storage, userId, clientId).length > 0) {
    return cached;
  }
  return { ...server, conflictAt: cached?.conflictAt ?? null };
}

export function dismissSettingsConflict(
  deps: CoachClientDeps,
  clientId: string,
): void {
  const cached = deps.storage.getCachedCoachClientSettings(
    deps.userId,
    clientId,
  );
  if (!cached?.conflictAt) return;
  deps.storage.cacheCoachClientSettings(deps.userId, clientId, {
    ...cached,
    conflictAt: null,
  });
}

// ── The drain's side ─────────────────────────────────────────────────────────

function userOf(entry: SyncQueueEntry): string | null {
  const userId = entry.entityId?.split(":")[0];
  return userId ? userId : null;
}

function sentRevision(entry: SyncQueueEntry): number {
  const body = parseObject(entry.payload);
  return typeof body?.expectedRevision === "number" ? body.expectedRevision : 0;
}

/**
 * Move this phone's later queued writes from the revision just sent (or 0,
 * "not created yet") to the server's new one. Returns whether any live
 * write is still queued (then the cache keeps the phone's newer content).
 */
function rebaseLater(
  storage: StoragePort,
  later: SyncQueueEntry[],
  from: number,
  to: number,
): boolean {
  for (const e of later) {
    const body = parseObject(e.payload);
    if (
      e.method !== "DELETE" &&
      body &&
      (body.expectedRevision === from || body.expectedRevision === 0)
    ) {
      storage.updateMutationPayload(e.id, { ...body, expectedRevision: to });
    }
  }
  return later.length > 0;
}

function isDetail(value: unknown): value is ClientProfileDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { revision?: unknown }).revision === "number"
  );
}

/**
 * A write synced: take the server's copy, swap an offline create's
 * `local-…` id everywhere, and rebase later queued writes.
 */
export function applyCoachClientSyncSuccess(
  storage: StoragePort,
  entry: SyncQueueEntry,
  data: unknown,
): void {
  const userId = userOf(entry);
  if (!userId) return;
  const ids = entry.entityId!.split(":").slice(1);

  if (entry.entityType === COACH_CLIENT_SETTINGS_ENTITY) {
    const clientId = ids[0];
    if (!clientId || typeof data !== "object" || data === null) return;
    const server = data as ClientSettings;
    if (typeof server.revision !== "number") return;
    const later = liveSettingsEntries(storage, userId, clientId).filter(
      (e) => e.id !== entry.id,
    );
    if (rebaseLater(storage, later, sentRevision(entry), server.revision)) {
      const cached = storage.getCachedCoachClientSettings(userId, clientId);
      if (cached) {
        storage.cacheCoachClientSettings(userId, clientId, {
          ...cached,
          revision: server.revision,
        });
      }
      return;
    }
    storage.cacheCoachClientSettings(userId, clientId, {
      ...server,
      conflictAt: null,
    });
    return;
  }

  if (entry.method === "DELETE") {
    if (ids[0]) storage.removeCachedCoachClientProfile(userId, ids[0]);
    return;
  }
  if (!isDetail(data)) return;
  let profileId = ids[0];
  if (!profileId) return;
  if (
    entry.entityType === COACH_CLIENT_PROFILE_ENTITY &&
    entry.method === "POST"
  ) {
    if (profileId !== data.id) {
      storage.swapLocalCoachClientProfileId(userId, profileId, data.id);
      syncedIds.set(profileId, data.id);
    }
    profileId = data.id;
  }
  const later = liveProfileEntries(storage, userId, profileId).filter(
    (e) => e.id !== entry.id,
  );
  // Deleted on this phone while the create was on its way: stays gone.
  if (later.some((e) => e.method === "DELETE")) {
    storage.removeCachedCoachClientProfile(userId, profileId);
    return;
  }
  const from = entry.method === "POST" ? 0 : sentRevision(entry);
  const cached = storage.getCachedCoachClientProfile(userId, profileId);
  if (rebaseLater(storage, later, from, data.revision) && cached) {
    storage.cacheCoachClientProfile(userId, {
      ...cached,
      revision: data.revision,
      invite: data.invite,
      status: data.status,
    });
    return;
  }
  storage.cacheCoachClientProfile(userId, { ...data, conflictAt: null });
}

/**
 * A 409 from a profile, set-up or settings write. `revision_conflict`: the
 * cache takes the server's copy, the queued writes are dropped and the
 * conflict is shown. `profile_not_editable` (accepted or cancelled since):
 * the queued writes are dropped and the cache takes the new status.
 * Returns false when the body isn't one of those (the drain's usual path).
 */
export function applyCoachClientConflict(
  storage: StoragePort,
  entry: SyncQueueEntry,
  bodyText: string,
  now: () => Date = () => new Date(),
): boolean {
  const userId = userOf(entry);
  const body = parseObject(bodyText);
  if (!userId || !body) return false;
  const ids = entry.entityId!.split(":").slice(1);
  const at = now().toISOString();

  if (entry.entityType === COACH_CLIENT_SETTINGS_ENTITY) {
    const clientId = ids[0];
    const current = body.current as ClientSettings | undefined;
    if (
      !clientId ||
      body.code !== "revision_conflict" ||
      typeof current?.revision !== "number"
    ) {
      return false;
    }
    const stale = liveSettingsEntries(storage, userId, clientId)
      .filter((e) => e.status !== "in_flight")
      .map((e) => e.id);
    storage.discardEntries([entry.id, ...stale]);
    storage.cacheCoachClientSettings(userId, clientId, {
      ...current,
      conflictAt: at,
    });
    return true;
  }

  const profileId = ids[0];
  if (!profileId) return false;
  const dropQueued = () => {
    const stale = liveProfileEntries(storage, userId, profileId)
      .filter((e) => e.status !== "in_flight")
      .map((e) => e.id);
    storage.discardEntries([entry.id, ...stale]);
  };
  if (body.code === "revision_conflict" && isDetail(body.current)) {
    dropQueued();
    storage.cacheCoachClientProfile(userId, {
      ...body.current,
      conflictAt: at,
    });
    return true;
  }
  if (body.code === "profile_not_editable" && typeof body.status === "string") {
    dropQueued();
    const cached = storage.getCachedCoachClientProfile(userId, profileId);
    if (cached) {
      storage.cacheCoachClientProfile(userId, {
        ...cached,
        status: body.status,
      });
    }
    return true;
  }
  return false;
}
