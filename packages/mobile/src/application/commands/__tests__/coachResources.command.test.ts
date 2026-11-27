import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type {
  AthleteResource,
  ClientResource,
  CoachResource,
} from "@/domain/models/coachResources";
import {
  addAssignedLocally,
  applyCoachResourcesSyncSuccess,
  ASSIGN_ENDPOINT,
  COACH_RESOURCE_ASSIGN_ENTITY,
  COACH_RESOURCE_ENTITY,
  createLinkResourceCommand,
  dismissRefusedAssigns,
  dropAssignedLocally,
  forgetResourceLocally,
  markOpenedCommand,
  MY_RESOURCE_OPENED_ENTITY,
  queueAssignCommand,
  reconcileClientResources,
  reconcileCoachResources,
  reconcileMyResources,
  refusedAssigns,
  rememberResource,
  resolveResourceId,
  upsertAssignedLocally,
} from "../coachResources.command";

const COACH = "coach-1";
const NOW = new Date("2026-11-26T10:00:00.000Z");

function res(over: Partial<CoachResource> = {}): CoachResource {
  return {
    id: "r1",
    kind: "file",
    title: "Shopping list",
    url: null,
    mediaId: "m1",
    mime: "application/pdf",
    bytes: 1000,
    revision: 1,
    archivedAt: null,
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...over,
  };
}

function assigned(r: CoachResource, over: Partial<ClientResource> = {}) {
  return {
    assignmentId: `as-${r.id}`,
    clientId: "c1",
    resource: r,
    assignedAt: "2026-10-21T09:00:00.000Z",
    openedAt: null,
    ...over,
  } satisfies ClientResource;
}

function athlete(over: Partial<AthleteResource> = {}): AthleteResource {
  return {
    assignmentId: "a1",
    resourceId: "r1",
    kind: "link",
    title: "Booking",
    url: "https://x.example",
    urlExpiresAt: null,
    mime: null,
    bytes: null,
    coach: { id: "t1", name: "Ellie", avatarUrl: null },
    assignedAt: "2026-11-20T09:00:00.000Z",
    openedAt: null,
    ...over,
  };
}

function setup() {
  const storage = new InMemoryStorageAdapter();
  const deps = { storage, userId: COACH, now: () => NOW };
  return { storage, deps };
}

describe("coachResources.command (PER-143)", () => {
  it("a link made offline is cached on top and queued, keyed", () => {
    const { storage, deps } = setup();
    storage.cacheCoachResources(COACH, [res()]);
    const link = createLinkResourceCommand(deps, {
      title: " Booking ",
      url: " https://studio.example ",
    });
    expect(link.id).toMatch(/^local-/);
    expect(link.title).toBe("Booking");
    expect(storage.getCachedCoachResources(COACH)?.map((r) => r.id)).toEqual([
      link.id,
      "r1",
    ]);
    const [entry] = storage.getUncompletedMutations();
    expect(entry).toMatchObject({
      entityType: COACH_RESOURCE_ENTITY,
      entityId: `${COACH}:${link.id}`,
      endpoint: "/trainers/me/resources",
      method: "POST",
    });
    expect(JSON.parse(entry!.payload)).toEqual({
      kind: "link",
      title: "Booking",
      url: "https://studio.example",
    });
    expect(entry!.idempotencyKey).toBeTruthy();
  });

  it("a link queued after an online try keeps that try's key", () => {
    const { storage, deps } = setup();
    createLinkResourceCommand(
      deps,
      { title: "B", url: "https://b.example" },
      "key-online",
    );
    expect(storage.getUncompletedMutations()[0]!.idempotencyKey).toBe(
      "key-online",
    );
  });

  it("the server's share rows replace optimistic ones for the same resource", () => {
    const { storage, deps } = setup();
    upsertAssignedLocally(deps, "c1", []);
    expect(storage.getCachedCoachClientResources(COACH, "c1")).toBeNull();
    storage.cacheCoachClientResources(COACH, "c1", [
      assigned(res(), { assignmentId: "local-1" }),
      assigned(res({ id: "r2" })),
    ]);
    upsertAssignedLocally(deps, "c1", [
      assigned(res(), { assignmentId: "srv-1" }),
      assigned(res({ id: "r9" }), { clientId: "other" }),
    ]);
    expect(
      storage
        .getCachedCoachClientResources(COACH, "c1")!
        .map((a) => a.assignmentId),
    ).toEqual(["srv-1", "as-r2"]);
  });

  it("rememberResource puts a server resource on top once", () => {
    const { storage, deps } = setup();
    rememberResource(deps, res());
    rememberResource(deps, res({ title: "Renamed" }));
    expect(storage.getCachedCoachResources(COACH)).toEqual([
      res({ title: "Renamed" }),
    ]);
  });

  it("queued assign shows rows at once and skips what the client has", () => {
    const { storage, deps } = setup();
    storage.cacheCoachClientResources(COACH, "c1", [assigned(res())]);
    queueAssignCommand(deps, "c1", []);
    expect(storage.getUncompletedMutations()).toHaveLength(0);
    queueAssignCommand(deps, "c1", [res(), res({ id: "r2", title: "B" })]);
    const rows = storage.getCachedCoachClientResources(COACH, "c1")!;
    expect(rows.map((a) => a.resource.id)).toEqual(["r2", "r1"]);
    expect(rows[0]!.assignmentId).toMatch(/^local-/);
    expect(rows[0]!.assignedAt).toBe(NOW.toISOString());
    const [entry] = storage.getUncompletedMutations();
    expect(entry).toMatchObject({
      entityType: COACH_RESOURCE_ASSIGN_ENTITY,
      endpoint: ASSIGN_ENDPOINT,
      method: "POST",
    });
    expect(entry!.entityId).toMatch(/^coach-1:c1:local-/);
    expect(JSON.parse(entry!.payload)).toEqual({
      resourceIds: ["r1", "r2"],
      clientIds: ["c1"],
    });
  });

  it("addAssignedLocally works on an empty cache with given ids", () => {
    const { storage, deps } = setup();
    addAssignedLocally(deps, "c9", [res()], (r) => `x-${r.id}`);
    expect(storage.getCachedCoachClientResources(COACH, "c9")).toEqual([
      assigned(res(), {
        assignmentId: "x-r1",
        clientId: "c9",
        assignedAt: NOW.toISOString(),
      }),
    ]);
  });

  it("drop and forget remove rows from the tab, the library and every client", () => {
    const { storage, deps } = setup();
    dropAssignedLocally(deps, "none", () => false);
    expect(storage.getCachedCoachClientResources(COACH, "none")).toBeNull();
    storage.cacheCoachResources(COACH, [res(), res({ id: "r2" })]);
    storage.cacheCoachClientResources(COACH, "c1", [
      assigned(res()),
      assigned(res({ id: "r2" })),
    ]);
    storage.cacheCoachClientResources(COACH, "c2", [
      assigned(res({ id: "r2" })),
    ]);
    dropAssignedLocally(deps, "c1", (a) => a.resource.id !== "r1");
    expect(
      storage
        .getCachedCoachClientResources(COACH, "c1")!
        .map((a) => a.resource.id),
    ).toEqual(["r2"]);
    forgetResourceLocally(deps, "r2");
    expect(storage.getCachedCoachResources(COACH)!.map((r) => r.id)).toEqual([
      "r1",
    ]);
    expect(storage.getCachedCoachClientResources(COACH, "c1")).toEqual([]);
    expect(storage.getCachedCoachClientResources(COACH, "c2")).toEqual([]);
    // No library cached: nothing to do.
    const fresh = setup();
    forgetResourceLocally(fresh.deps, "r1");
    expect(fresh.storage.getCachedCoachResources(COACH)).toBeNull();
  });

  it("a synced link swaps its local id in the library, client tabs and queued assigns", () => {
    const { storage, deps } = setup();
    storage.cacheCoachResources(COACH, [res({ id: "srv-1" })]);
    const link = createLinkResourceCommand(deps, {
      title: "Booking",
      url: "https://studio.example",
    });
    storage.cacheCoachClientResources(COACH, "c2", [assigned(res())]);
    queueAssignCommand(deps, "c1", [link, res()]);
    const [create, assign] = storage.getUncompletedMutations();
    const server = res({
      id: "srv-1",
      kind: "link",
      title: "Booking",
      url: "https://studio.example",
    });
    applyCoachResourcesSyncSuccess(storage, create!, server);
    expect(resolveResourceId(link.id)).toBe("srv-1");
    // The library has the server copy once.
    expect(storage.getCachedCoachResources(COACH)).toEqual([server]);
    expect(
      storage.getCachedCoachClientResources(COACH, "c1")![0]!.resource,
    ).toEqual(server);
    const updated = storage
      .getUncompletedMutations()
      .find((e) => e.id === assign!.id)!;
    expect(JSON.parse(updated.payload).resourceIds).toEqual(["srv-1", "r1"]);
  });

  it("sync success ignores other writes and bad answers", () => {
    const { storage, deps } = setup();
    queueAssignCommand(deps, "c1", [res()]);
    const [assign] = storage.getUncompletedMutations();
    applyCoachResourcesSyncSuccess(storage, assign!, { id: "x" });
    applyCoachResourcesSyncSuccess(
      storage,
      { ...assign!, entityType: COACH_RESOURCE_ENTITY, entityId: COACH },
      { id: "x" },
    );
    applyCoachResourcesSyncSuccess(
      storage,
      { ...assign!, entityType: COACH_RESOURCE_ENTITY },
      null,
    );
    // An unreadable or unrelated queued row is left alone.
    storage.enqueueMutation({
      entityType: COACH_RESOURCE_ASSIGN_ENTITY,
      entityId: `${COACH}:c1:z`,
      operation: "create",
      payload: "not json",
      endpoint: ASSIGN_ENDPOINT,
      method: "POST",
    });
    applyCoachResourcesSyncSuccess(
      storage,
      {
        ...assign!,
        entityType: COACH_RESOURCE_ENTITY,
        entityId: `${COACH}:local-q`,
      },
      res({ id: "srv-q" }),
    );
    expect(storage.getCachedCoachResources(COACH)).toBeNull();
    expect(JSON.parse(assign!.payload).resourceIds).toEqual(["r1"]);
  });

  it("reconcile keeps queued links and queued assigns, and drops the rest", () => {
    const { storage, deps } = setup();
    const link = createLinkResourceCommand(deps, {
      title: "Booking",
      url: "https://studio.example",
    });
    expect(
      reconcileCoachResources(storage, COACH, [res()]).map((r) => r.id),
    ).toEqual([link.id, "r1"]);

    // No queued assign: the server's list as is.
    const server = [assigned(res())];
    expect(reconcileClientResources(storage, COACH, "c1", server)).toBe(server);
    queueAssignCommand(deps, "c1", [res({ id: "r2" }), res()]);
    expect(
      reconcileClientResources(storage, COACH, "c1", server).map(
        (a) => a.resource.id,
      ),
    ).toEqual(["r2", "r1"]);
    // Done (no longer live): the optimistic row goes.
    const done = storage
      .getUncompletedMutations()
      .filter((e) => e.entityType === COACH_RESOURCE_ASSIGN_ENTITY);
    done.forEach((e) => storage.markMutationCompleted(e.id));
    expect(reconcileClientResources(storage, COACH, "c1", server)).toBe(server);
  });

  it("opened stamp: once, cached at once, one queued POST", () => {
    const { storage, deps } = setup();
    markOpenedCommand(deps, "a1");
    expect(storage.getUncompletedMutations()).toHaveLength(0);
    storage.cacheMyResources(COACH, [
      athlete(),
      athlete({ assignmentId: "a2" }),
    ]);
    markOpenedCommand(deps, "a1");
    expect(storage.getCachedMyResources(COACH)![0]!.openedAt).toBe(
      NOW.toISOString(),
    );
    const entries = storage.getUncompletedMutations();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entityType: MY_RESOURCE_OPENED_ENTITY,
      endpoint: "/users/me/resources/a1/opened",
      method: "POST",
    });
    // Already opened: nothing more.
    markOpenedCommand(deps, "a1");
    expect(storage.getUncompletedMutations()).toHaveLength(1);
    // A row reset by a read while the stamp is still queued isn't queued twice.
    storage.cacheMyResources(COACH, [
      athlete(),
      athlete({ assignmentId: "a2" }),
    ]);
    markOpenedCommand(deps, "a1");
    expect(storage.getUncompletedMutations()).toHaveLength(1);
    // The read keeps the waiting stamp.
    const merged = reconcileMyResources(storage, COACH, [
      athlete(),
      athlete({ assignmentId: "a2" }),
      athlete({ assignmentId: "a3", openedAt: "2026-11-01T00:00:00Z" }),
    ]);
    expect(merged.map((r) => r.openedAt)).toEqual([
      NOW.toISOString(),
      null,
      "2026-11-01T00:00:00Z",
    ]);
    entries.forEach((e) => storage.markMutationCompleted(e.id));
    const plain = [athlete()];
    expect(reconcileMyResources(storage, COACH, plain)).toBe(plain);
  });

  it("reconcile of a stamp with no cached time uses now", () => {
    const { storage } = setup();
    storage.enqueueMutation({
      entityType: MY_RESOURCE_OPENED_ENTITY,
      entityId: `${COACH}:a1`,
      operation: "update",
      payload: {},
      endpoint: "/users/me/resources/a1/opened",
      method: "POST",
    });
    const [row] = reconcileMyResources(storage, COACH, [athlete()]);
    expect(row!.openedAt).not.toBeNull();
  });

  it("finds and dismisses assigns refused with resources_off", () => {
    const { storage, deps } = setup();
    queueAssignCommand(deps, "c1", [res()]);
    queueAssignCommand(deps, "c2", [res()]);
    expect(refusedAssigns(storage, COACH, "c1")).toEqual([]);
    dismissRefusedAssigns(deps, "c1");
    const [c1] = storage.getUncompletedMutations();
    storage.markMutationFailed(
      c1!.id,
      'HTTP 403: {"code":"resources_off","message":"Resources are switched off"}',
    );
    expect(refusedAssigns(storage, COACH, "c1")).toHaveLength(1);
    expect(refusedAssigns(storage, COACH, "c2")).toHaveLength(0);
    // A real row the server already had stays; the optimistic one goes.
    storage.cacheCoachClientResources(COACH, "c1", [
      ...storage.getCachedCoachClientResources(COACH, "c1")!,
      assigned(res({ id: "r9" })),
    ]);
    dismissRefusedAssigns(deps, "c1");
    expect(refusedAssigns(storage, COACH, "c1")).toEqual([]);
    expect(
      storage
        .getCachedCoachClientResources(COACH, "c1")!
        .map((a) => a.resource.id),
    ).toEqual(["r9"]);
    expect(storage.getUncompletedMutations()).toHaveLength(1);
  });

  it("dismissing tolerates an unreadable refused row", () => {
    const { storage, deps } = setup();
    storage.enqueueMutation({
      entityType: COACH_RESOURCE_ASSIGN_ENTITY,
      entityId: `${COACH}:c1:x`,
      operation: "create",
      payload: "{",
      endpoint: ASSIGN_ENDPOINT,
      method: "POST",
    });
    const [e] = storage.getUncompletedMutations();
    storage.markMutationFailed(e!.id, "resources_off");
    dismissRefusedAssigns(deps, "c1");
    expect(storage.getUncompletedMutations()).toHaveLength(0);
  });
});
