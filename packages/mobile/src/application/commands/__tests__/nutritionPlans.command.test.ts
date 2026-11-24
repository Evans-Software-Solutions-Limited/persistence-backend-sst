/**
 * PER-133 — list meal plans offline-first, against a fake server that
 * behaves like the merged PER-118 backend: creates and duplicates are
 * idempotent on their Idempotency-Key, PUT checks `expectedRevision` (stale →
 * 409 with `current`), and food logs are idempotent on their own key (the
 * PER-109 batch route).
 */
import { processSyncQueue } from "../sync.command";
import {
  NUTRITION_PLAN_ASSIGNMENT_ENTITY,
  NUTRITION_PLAN_ENTITY,
  SHOPPING_LIST_PLAN_ENTITY,
  addPlanToDayCommand,
  answerCoachPlanCommand,
  applyNutritionPlanConflict,
  applyNutritionPlanSynced,
  applyShoppingListRead,
  clearPlanConflictCommand,
  createPlanCommand,
  deletePlanCommand,
  duplicatePlanCommand,
  livePlanEdits,
  markCoachPlanSeenCommand,
  readPlansCache,
  readShoppingCache,
  savePlanCommand,
  setPlanInShoppingListCommand,
  toggleShoppingTickCommand,
} from "../nutritionPlans.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import type {
  NutritionPlan,
  PlanFromCoach,
  PlanItem,
  PlansShoppingList,
} from "@/domain/models/nutritionPlans";
import { emptyPlansCache } from "@/domain/models/nutritionPlans";
import type { UserMeal } from "@/domain/models/userMeals";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";
import {
  findPlan,
  mergePlansResponse,
  planItemCustom,
  recomputePlan,
  toPlanInput,
  withServings,
} from "@/domain/services/nutritionPlans.service";
import { captureSyncFailure } from "@/lib/sentry";

jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));

const BASE = "https://api.test";
const USER = "athlete-1";
const COACH = "coach-1";
const DAY = "2026-11-23";
const LOGGED_AT = `${DAY}T12:00:00.000Z`;

const userMeals: UserMeal[] = (
  [
    ["um-b", "Breakfast", "breakfast"],
    ["um-l", "Lunch", "lunch"],
    ["um-s", "Snack", "snack"],
    ["um-d", "Dinner", "dinner"],
  ] as const
).map(([id, name, slot], i) => ({
  id,
  name,
  logSlot: slot,
  sortOrder: i,
  defaultKey: slot,
  clientRequestId: null,
  archivedAt: null,
  updatedAt: "2026-11-20T00:00:00.000Z",
}));

function item(id: string, name: string, kcal: number): PlanItem {
  return planItemCustom(id, name, {
    kcal,
    proteinG: kcal / 20,
    carbsG: kcal / 10,
    fatG: kcal / 40,
  });
}

function foodItem(id: string, foodId: string, kcal: number): PlanItem {
  return {
    ...item(id, "Chicken breast", kcal),
    kind: "food",
    foodId,
    custom: null,
    logEntry: { foodId, servings: 1 },
  };
}

function plan(
  id: string,
  ownerId: string,
  revision: number,
  meals: [string, string, PlanItem[]][],
): NutritionPlan {
  return recomputePlan({
    id,
    ownerId,
    name: "Training day",
    notes: null,
    source: "manual",
    sourcePlanId: null,
    revision,
    archivedAt: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    meals: meals.map(([mid, name, items], i) => ({
      id: mid,
      name,
      logSlot: name === "Breakfast" ? "breakfast" : "lunch",
      sortOrder: i,
      totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      items,
    })),
  });
}

function fromCoach(p: NutritionPlan, extra: Partial<PlanFromCoach> = {}) {
  return {
    plan: p,
    coach: { id: COACH, name: "Ellie Hart", avatarUrl: null },
    assignmentId: "asg-1",
    note: "Use this on lifting days.",
    status: "sent" as const,
    sentAt: "2026-11-21T00:00:00.000Z",
    addedAt: null,
    updatedSinceSeen: false,
    ...extra,
  };
}

type Reply = { status: number; json: unknown };

/** The PER-118/PER-109 backend, in memory. */
class FakeServer {
  plans = new Map<string, NutritionPlan>();
  planKeys = new Map<string, string>();
  entries: { key: string; body: Record<string, unknown> }[] = [];
  assignments: Record<string, unknown>[] = [];
  shoppingPlans: string[] = [];
  calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  offline = false;
  loseNextResponse = false;
  private seq = 0;

  private storePlan(
    ownerId: string,
    body: Record<string, unknown>,
    id?: string,
    revision = 1,
  ): NutritionPlan {
    const meals = (body.meals as Record<string, unknown>[]).map((m) => ({
      id: `srv-meal-${++this.seq}`,
      name: m.name as string,
      logSlot: m.logSlot as "lunch",
      sortOrder: m.sortOrder as number,
      totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      items: (m.items as Record<string, unknown>[]).map((it) => {
        const c = it.custom as
          | {
              name: string;
              kcal: number;
              proteinG: number;
              carbsG: number;
              fatG: number;
            }
          | undefined;
        // Like `resolvePlanInput`: a one-off's macros are PER SERVING; the
        // item stores per-serving × servings, and the DTO's `custom` echoes
        // the per-serving values.
        const servings = it.servings as number;
        if (c) {
          const total = {
            kcal: c.kcal * servings,
            proteinG: c.proteinG * servings,
            carbsG: c.carbsG * servings,
            fatG: c.fatG * servings,
          };
          return {
            ...planItemCustom(
              `srv-item-${++this.seq}`,
              c.name,
              total,
              servings,
            ),
            custom: { ...c },
          };
        }
        return {
          ...foodItem(`srv-item-${++this.seq}`, it.foodId as string, 200),
          servings,
        };
      }),
    }));
    const p = recomputePlan({
      ...plan(id ?? `srv-plan-${++this.seq}`, ownerId, revision, []),
      name: body.name as string,
      meals,
    });
    this.plans.set(p.id, p);
    return p;
  }

  private handle(
    path: string,
    method: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): Reply {
    if (path === "/nutrition/meal-plans" && method === "POST") {
      const key = headers["Idempotency-Key"]!;
      const prior = this.planKeys.get(key);
      if (prior) return { status: 201, json: { data: this.plans.get(prior) } };
      const p = this.storePlan(USER, body);
      this.planKeys.set(key, p.id);
      return { status: 201, json: { data: p } };
    }
    const dup = path.match(/^\/nutrition\/meal-plans\/([^/]+)\/duplicate$/);
    if (dup && method === "POST") {
      const key = headers["Idempotency-Key"]!;
      const prior = this.planKeys.get(key);
      if (prior) return { status: 201, json: { data: this.plans.get(prior) } };
      const src = this.plans.get(dup[1]!);
      if (!src) return { status: 404, json: { error: "not_found" } };
      const copy = { ...src, id: `srv-plan-${++this.seq}`, ownerId: USER };
      this.plans.set(copy.id, copy);
      this.planKeys.set(key, copy.id);
      return { status: 201, json: { data: copy } };
    }
    const asg = path.match(/^\/nutrition\/meal-plans\/([^/]+)\/assignment$/);
    if (asg && method === "POST") {
      this.assignments.push({ planId: asg[1], ...body });
      return { status: 200, json: { data: {} } };
    }
    const one = path.match(/^\/nutrition\/meal-plans\/([^/]+)$/);
    if (one && method === "PUT") {
      const cur = this.plans.get(one[1]!);
      // `getOwned` skips archived plans.
      if (!cur || cur.archivedAt)
        return { status: 404, json: { error: "not_found" } };
      if (cur.ownerId !== USER)
        return { status: 403, json: { error: "read_only" } };
      const expected = body.expectedRevision as number | undefined;
      if (expected !== undefined && expected !== cur.revision) {
        return {
          status: 409,
          json: { error: "revision_conflict", current: cur },
        };
      }
      const next = this.storePlan(USER, body, cur.id, cur.revision + 1);
      return { status: 200, json: { data: next } };
    }
    if (one && method === "DELETE") {
      const cur = this.plans.get(one[1]!);
      if (cur) this.plans.set(cur.id, { ...cur, archivedAt: "now" });
      return { status: 204, json: null };
    }
    if (path === "/nutrition/entries/batch" && method === "POST") {
      const results = (body.entries as Record<string, unknown>[]).map((e) => {
        const key = e.clientRequestId as string;
        if (!this.entries.some((x) => x.key === key))
          this.entries.push({ key, body: e });
        return { clientRequestId: key, entry: { id: `e-${key}` } };
      });
      return { status: 200, json: { data: { results } } };
    }
    if (path === "/nutrition/shopping-list/plans" && method === "POST") {
      this.shoppingPlans.push(body.nutritionPlanId as string);
      return { status: 200, json: { data: {} } };
    }
    const shop = path.match(/^\/nutrition\/shopping-list\/plans\/(.+)$/);
    if (shop && method === "DELETE") {
      this.shoppingPlans = this.shoppingPlans.filter((p) => p !== shop[1]);
      return { status: 204, json: null };
    }
    return { status: 404, json: { error: "no_route" } };
  }

  fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    const body = init.body
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : {};
    this.calls.push({ url, method: init.method, body });
    if (this.offline) throw new TypeError("Network request failed");
    const r = this.handle(
      url.slice(BASE.length),
      init.method,
      body,
      init.headers,
    );
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new TypeError("Network request failed");
    }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    };
  };
}

let storage: InMemoryStorageAdapter;
let auth: InMemoryAuthAdapter;
let server: FakeServer;
let n = 0;
const deps = () => ({
  storage,
  userId: USER,
  idFactory: () => `id${++n}`,
  now: () => "2026-11-23T09:00:00.000Z",
});
const drain = () => processSyncQueue(storage, auth, BASE);
const AFTER_BACKOFF = { now: () => Date.now() + 10 * 60_000 };
const drainLater = () => processSyncQueue(storage, auth, BASE, AFTER_BACKOFF);

beforeEach(() => {
  n = 0;
  storage = new InMemoryStorageAdapter();
  storage.initialize();
  auth = new InMemoryAuthAdapter();
  server = new FakeServer();
  (globalThis as Record<string, unknown>).fetch = jest.fn(server.fetch);
  jest.mocked(captureSyncFailure).mockClear();
});

const queued = (): SyncQueueEntry[] => storage.getUncompletedMutations();

describe("adding a plan to today (offline, no duplicates)", () => {
  const mine = () =>
    plan("srv-p1", USER, 3, [
      [
        "srv-m1",
        "Breakfast",
        [item("i1", "Oats", 400), item("i2", "Banana", 100)],
      ],
      ["srv-m2", "Lunch", [foodItem("i3", "food-chicken", 250)]],
    ]);

  it("builds entries from the cached plan, logs them locally and queues one keyed row each", async () => {
    server.offline = true;
    const entries = addPlanToDayCommand(
      deps(),
      mine(),
      null,
      userMeals,
      LOGGED_AT,
    );
    await drain();

    expect(entries).toHaveLength(3);
    const day = storage.getCachedFuelToday(USER, DAY)!;
    expect(day.consumed.kcal).toBe(750);
    expect(day.entriesBySlot.breakfast.map((e) => e.userMealId)).toEqual([
      "um-b",
      "um-b",
    ]);
    const rows = queued();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.idempotencyKey)).size).toBe(3);
    const bodies = rows.map((r) => JSON.parse(r.payload));
    expect(bodies[0]).toMatchObject({
      customName: "Oats",
      kcal: 400,
      userMealId: "um-b",
      sourcePlanId: "srv-p1",
      sourcePlanMealId: "srv-m1",
    });
    expect(bodies[2]).toMatchObject({
      foodId: "food-chicken",
      userMealId: "um-l",
    });
    expect(server.entries).toHaveLength(0);
  });

  it("replays in one batch on reconnect, and a lost reply re-sent never logs twice", async () => {
    server.offline = true;
    addPlanToDayCommand(deps(), mine(), null, userMeals, LOGGED_AT);
    await drain();

    server.offline = false;
    server.loseNextResponse = true; // committed, reply lost
    await drainLater();
    expect(server.entries).toHaveLength(3);

    await drainLater();
    const batches = server.calls.filter((c) =>
      c.url.endsWith("/entries/batch"),
    );
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(server.entries).toHaveLength(3);
    expect(queued()).toHaveLength(0);
  });

  it("adds a single meal only", () => {
    const entries = addPlanToDayCommand(
      deps(),
      mine(),
      "srv-m2",
      userMeals,
      LOGGED_AT,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.mealSlot).toBe("lunch");
    expect(
      addPlanToDayCommand(deps(), mine(), "nope", userMeals, LOGGED_AT),
    ).toEqual([]);
  });

  it("a plan still only on the phone sends no plan provenance", () => {
    const local = { ...mine(), id: "local-x" };
    addPlanToDayCommand(deps(), local, "srv-m1", userMeals, LOGGED_AT);
    const body = JSON.parse(queued()[0]!.payload);
    expect(body).not.toHaveProperty("sourcePlanId");
    expect(body).not.toHaveProperty("sourcePlanMealId");
  });
});

describe("a coach edit updates the plan without changing logged food", () => {
  it("logged entries keep their macros after the coach's revision arrives", async () => {
    const v1 = plan("coach-p", COACH, 1, [
      ["cm1", "Lunch", [item("ci1", "Chicken, rice and veg", 512)]],
    ]);
    storage.cacheNutritionPlans(USER, {
      ...emptyPlansCache(),
      fromCoaches: [fromCoach(v1, { status: "added" })],
      asOf: "2026-11-22T00:00:00.000Z",
    });
    addPlanToDayCommand(deps(), v1, null, userMeals, LOGGED_AT);
    await drain();
    expect(server.entries[0]!.body).toMatchObject({ kcal: 512 });

    // The coach edits the plan; the next ?since= read brings revision 2.
    const v2 = plan("coach-p", COACH, 2, [
      ["cm1", "Lunch", [item("ci1", "Chicken, rice and veg", 700)]],
    ]);
    const merged = mergePlansResponse(
      readPlansCache(storage, USER),
      {
        mine: [],
        fromCoaches: [
          fromCoach(v2, { status: "added", updatedSinceSeen: true }),
        ],
        deletedIds: [],
        asOf: "2026-11-23T10:00:00.000Z",
      },
      true,
    );
    storage.cacheNutritionPlans(USER, merged);

    const cached = readPlansCache(storage, USER).fromCoaches[0]!;
    expect(cached.plan.totals.kcal).toBe(700);
    expect(cached.updatedSinceSeen).toBe(true);
    const day = storage.getCachedFuelToday(USER, DAY)!;
    expect(day.consumed.kcal).toBe(512);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0]!.body.kcal).toBe(512);
  });
});

describe("a Free user receives a coach plan", () => {
  // No subscription is involved anywhere on this path: the client reads,
  // answers, duplicates and logs. (Creating their OWN plan is gated in the UI
  // by useManualMealPlansGate and on the server by manual_meal_plans.)
  const coachPlan = () =>
    plan("coach-p", COACH, 4, [
      [
        "cm1",
        "Breakfast",
        [item("ci1", "Bagel, egg and chicken sausage", 535)],
      ],
    ]);

  beforeEach(() => {
    server.plans.set("coach-p", coachPlan());
    storage.cacheNutritionPlans(USER, {
      ...emptyPlansCache(),
      fromCoaches: [fromCoach(coachPlan(), { updatedSinceSeen: true })],
    });
  });

  it("Add to my plans and seen fold into one assignment call", async () => {
    server.offline = true;
    answerCoachPlanCommand(deps(), "coach-p", true);
    markCoachPlanSeenCommand(deps(), "coach-p");
    const rows = queued().filter(
      (e) => e.entityType === NUTRITION_PLAN_ASSIGNMENT_ENTITY,
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload)).toEqual({
      status: "added",
      seenRevision: 4,
    });
    const c = readPlansCache(storage, USER).fromCoaches[0]!;
    expect(c.status).toBe("added");
    expect(c.addedAt).toBe("2026-11-23T09:00:00.000Z");
    expect(c.updatedSinceSeen).toBe(false);

    server.offline = false;
    await drainLater();
    expect(server.assignments).toEqual([
      { planId: "coach-p", status: "added", seenRevision: 4 },
    ]);
  });

  it("a later Not now never lands before an earlier Add to my plans (Inspector Brad #554)", async () => {
    answerCoachPlanCommand(deps(), "coach-p", true);
    server.offline = true;
    await drain(); // the add fails in transport and waits to retry
    server.offline = false;
    answerCoachPlanCommand(deps(), "coach-p", false);
    await drain();
    await drainLater();
    await drainLater();
    expect(server.assignments.map((a) => a.status)).toEqual([
      "added",
      "dismissed",
    ]);
  });

  it("Not now dismisses; seen is a no-op when nothing changed", () => {
    answerCoachPlanCommand(deps(), "coach-p", false);
    markCoachPlanSeenCommand(deps(), "coach-p");
    markCoachPlanSeenCommand(deps(), "coach-p");
    markCoachPlanSeenCommand(deps(), "missing");
    const c = readPlansCache(storage, USER).fromCoaches[0]!;
    expect(c.status).toBe("dismissed");
    expect(c.addedAt).toBeNull();
  });

  it("duplicates it into their own plans, offline, and adopts the server's copy", async () => {
    server.offline = true;
    const copy = duplicatePlanCommand(deps(), coachPlan());
    expect(copy.id).toMatch(/^local-/);
    expect(copy.sourcePlanId).toBe("coach-p");
    expect(readPlansCache(storage, USER).mine.map((p) => p.id)).toEqual([
      copy.id,
    ]);

    // Shopping list add for the local copy waits for the id swap.
    setPlanInShoppingListCommand(deps(), copy.id, true);

    server.offline = false;
    await drainLater();
    await drainLater();
    const mine = readPlansCache(storage, USER).mine;
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).toMatch(/^srv-plan-/);
    expect(server.shoppingPlans).toEqual([mine[0]!.id]);
    expect(
      readShoppingCache(storage, USER).list!.plans[0]!.nutritionPlanId,
    ).toBe(mine[0]!.id);
    expect(queued()).toHaveLength(0);
  });

  it("logs from it with one-offs carrying the coach item's macros", () => {
    addPlanToDayCommand(deps(), coachPlan(), null, userMeals, LOGGED_AT);
    expect(JSON.parse(queued()[0]!.payload)).toMatchObject({
      customName: "Bagel, egg and chicken sausage",
      kcal: 535,
      userMealId: "um-b",
    });
  });
});

describe("my plans: create, edit, revision conflicts, delete", () => {
  const draft = () =>
    plan("local-draft", USER, 0, [
      ["lm1", "Lunch", [item("li1", "Wrap", 450)]],
    ]);

  it("creates offline under a local id, then swaps to the server id once", async () => {
    server.offline = true;
    const p = createPlanCommand(deps(), draft());
    expect(p.id).toBe("local-draft");
    server.offline = false;
    server.loseNextResponse = true;
    await drainLater();
    await drainLater();
    expect(server.plans.size).toBe(1);
    const mine = readPlansCache(storage, USER).mine;
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).toMatch(/^srv-plan-/);
    expect(mine[0]!.revision).toBe(1);
  });

  it("a draft with a non-local id gets one", () => {
    const p = createPlanCommand(deps(), { ...draft(), id: "x" });
    expect(p.id).toBe("local-id1");
  });

  it("edits before the create is sent fold into the create", () => {
    server.offline = true;
    const p = createPlanCommand(deps(), draft());
    savePlanCommand(deps(), { ...p, name: "Rest day" });
    const rows = queued();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload).name).toBe("Rest day");
  });

  it("an edit carries the revision it started from; repeat edits fold into one PUT", async () => {
    const synced = plan("srv-p1", USER, 2, [
      ["m1", "Lunch", [item("a", "Wrap", 450)]],
    ]);
    server.plans.set(synced.id, synced);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [synced] });
    server.offline = true;
    savePlanCommand(deps(), { ...synced, name: "One" });
    savePlanCommand(deps(), { ...synced, name: "Two" });
    const rows = queued().filter((e) => e.method === "PUT");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload)).toMatchObject({
      name: "Two",
      expectedRevision: 2,
    });
    server.offline = false;
    await drainLater();
    expect(server.plans.get("srv-p1")!.name).toBe("Two");
    expect(readPlansCache(storage, USER).mine[0]!.revision).toBe(3);
    expect(readPlansCache(storage, USER).conflictPlanIds).toEqual([]);
  });

  it("an edit made while a PUT is in flight follows it onto the new revision", () => {
    const synced = plan("srv-p1", USER, 2, []);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [synced] });
    savePlanCommand(deps(), { ...synced, name: "One" });
    const first = queued()[0]!;
    storage.markMutationInFlight(first.id);
    savePlanCommand(deps(), { ...synced, name: "Two" });
    const second = queued().find((e) => e.id !== first.id)!;
    expect(JSON.parse(second.payload).expectedRevision).toBe(2);

    applyNutritionPlanSynced(storage, first, {
      data: { ...synced, name: "One", revision: 3 },
    });
    expect(
      JSON.parse(queued().find((e) => e.id === second.id)!.payload),
    ).toMatchObject({
      name: "Two",
      expectedRevision: 3,
    });
    // The newer local edit stays on screen until it syncs.
    expect(readPlansCache(storage, USER).mine[0]!.name).toBe("Two");
  });

  it("409: keeps the server's copy, flags 'updated elsewhere', resolves the edit", async () => {
    const base = plan("srv-p1", USER, 2, [
      ["m1", "Lunch", [item("a", "Wrap", 450)]],
    ]);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [base] });
    // Another device saved revision 3 meanwhile.
    server.plans.set("srv-p1", { ...base, name: "From the iPad", revision: 3 });

    savePlanCommand(deps(), { ...base, name: "From this phone" });
    await drain();

    const cache = readPlansCache(storage, USER);
    expect(cache.mine[0]!.name).toBe("From the iPad");
    expect(cache.mine[0]!.revision).toBe(3);
    expect(cache.conflictPlanIds).toEqual(["srv-p1"]);
    expect(queued()).toHaveLength(0);
    expect(captureSyncFailure).not.toHaveBeenCalled();

    clearPlanConflictCommand(storage, USER, "srv-p1");
    clearPlanConflictCommand(storage, USER, "srv-p1");
    expect(readPlansCache(storage, USER).conflictPlanIds).toEqual([]);
  });

  it("409 on a replay of our own committed edit is not a conflict", () => {
    const base = plan("srv-p1", USER, 2, [
      ["m1", "Lunch", [item("a", "Wrap", 450)]],
    ]);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [base] });
    savePlanCommand(deps(), { ...base, name: "Mine" });
    const entry = queued()[0]!;
    const current = { ...base, name: "Mine", revision: 3 };
    expect(
      applyNutritionPlanConflict(
        storage,
        entry,
        409,
        JSON.stringify({ current }),
      ),
    ).toBe(true);
    expect(readPlansCache(storage, USER).conflictPlanIds).toEqual([]);
    expect(readPlansCache(storage, USER).mine[0]!.revision).toBe(3);
  });

  it("conflict handling ignores everything that isn't a plan PUT 409 with a plan", () => {
    const entry = {
      ...({} as SyncQueueEntry),
      entityType: NUTRITION_PLAN_ENTITY,
      method: "PUT",
      payload: "{}",
    };
    expect(applyNutritionPlanConflict(storage, entry, 400, "{}")).toBe(false);
    expect(applyNutritionPlanConflict(storage, entry, 409, "not json")).toBe(
      false,
    );
    expect(applyNutritionPlanConflict(storage, entry, 409, "{}")).toBe(false);
    expect(
      applyNutritionPlanConflict(
        storage,
        { ...entry, method: "POST" },
        409,
        "{}",
      ),
    ).toBe(false);
  });

  it("re-saving a plan never multiplies a one-off's macros by its servings (Inspector Brad #554)", async () => {
    const soup = withServings(item("c", "Soup", 150), 2); // 300 kcal total
    const p = createPlanCommand(deps(), {
      ...plan("local-s", USER, 0, [["m1", "Lunch", [soup]]]),
    });
    await drain();
    const synced = () => readPlansCache(storage, USER).mine[0]!;
    expect(synced().id).not.toBe(p.id);
    expect(synced().totals.kcal).toBe(300);

    // Rename twice: the whole plan is re-sent each time.
    savePlanCommand(deps(), { ...synced(), name: "Renamed" });
    await drainLater();
    savePlanCommand(deps(), { ...synced(), name: "Renamed again" });
    await drainLater();
    expect(synced().totals.kcal).toBe(300);
    expect(synced().meals[0]!.items[0]).toMatchObject({
      servings: 2,
      kcal: 300,
    });
    const last = server.calls.filter((c) => c.method === "PUT").pop()!;
    const sent = (
      last.body.meals as { items: { custom: { kcal: number } }[] }[]
    )[0]!.items[0]!.custom;
    expect(sent.kcal).toBe(150);
  });

  it("an edit to a duplicate that hasn't synced yet survives the sync (Inspector Brad #554)", async () => {
    const src = plan("srv-src", USER, 1, [
      ["m1", "Lunch", [item("a", "Wrap", 450)]],
    ]);
    server.plans.set(src.id, src);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [src] });
    server.offline = true;
    const copy = duplicatePlanCommand(deps(), src);
    savePlanCommand(deps(), { ...copy, name: "My version" });
    const dup = queued().find((e) => e.endpoint.endsWith("/duplicate"))!;
    // The duplicate request has no body for the edit to hide in.
    expect(JSON.parse(dup.payload)).toEqual({});

    server.offline = false;
    await drainLater();
    await drainLater();
    const mine = readPlansCache(storage, USER).mine.filter(
      (p) => p.id !== "srv-src",
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.name).toBe("My version");
    expect(server.plans.get(mine[0]!.id)!.name).toBe("My version");
    expect(queued()).toHaveLength(0);
  });

  it("a local id still held after the create synced follows it to the server id (Inspector Brad #554)", async () => {
    // Online: the create syncs inside the same tap, so screens still hold
    // the local id (Saved → Shopping list, an open builder draft).
    const p = createPlanCommand(
      deps(),
      plan("local-d", USER, 0, [["m1", "Lunch", [item("a", "Wrap", 450)]]]),
    );
    await drain();
    const serverId = readPlansCache(storage, USER).mine[0]!.id;
    expect(serverId).toMatch(/^srv-plan-/);
    expect(findPlan(readPlansCache(storage, USER), p.id)!.plan.id).toBe(
      serverId,
    );

    setPlanInShoppingListCommand(deps(), p.id, true);
    expect(
      readShoppingCache(storage, USER).list!.plans[0]!.nutritionPlanId,
    ).toBe(serverId);

    // The builder draft still has the local id and revision 0.
    savePlanCommand(deps(), { ...p, name: "Edited in the open builder" });
    const put = queued().find((e) => e.method === "PUT")!;
    expect(put.endpoint).toBe(`/nutrition/meal-plans/${serverId}`);
    expect(JSON.parse(put.payload).expectedRevision).toBe(1);
    expect(
      readPlansCache(storage, USER).mine.map((x) => [x.id, x.name]),
    ).toEqual([[serverId, "Edited in the open builder"]]);
    await drainLater();
    expect(server.plans.get(serverId)!.name).toBe("Edited in the open builder");
    expect(
      queued().filter((e) => e.entityType !== SHOPPING_LIST_PLAN_ENTITY),
    ).toHaveLength(0);

    // A delete by the old id deletes the real plan.
    deletePlanCommand(deps(), p.id);
    expect(queued().find((e) => e.method === "DELETE")!.endpoint).toBe(
      `/nutrition/meal-plans/${serverId}`,
    );
  });

  it("a duplicate made online is found by the copy's local id (Inspector Brad #554)", async () => {
    const src = plan("srv-src", USER, 1, [
      ["m1", "Lunch", [item("a", "Wrap", 450)]],
    ]);
    server.plans.set(src.id, src);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [src] });
    const copy = duplicatePlanCommand(deps(), src);
    await drain();
    const found = findPlan(readPlansCache(storage, USER), copy.id)!;
    expect(found.plan.id).not.toBe(copy.id);
    expect(found.plan.id).toMatch(/^srv-plan-/);
  });

  it("a write that lands after the plan was deleted doesn't bring it back (Inspector Brad #554)", () => {
    const synced = plan("srv-p1", USER, 2, []);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [synced] });
    savePlanCommand(deps(), { ...synced, name: "x" });
    const put = queued()[0]!;
    storage.markMutationInFlight(put.id);
    storage.markMutationDispatched(put.id);
    deletePlanCommand(deps(), "srv-p1");
    applyNutritionPlanSynced(storage, put, {
      data: { ...synced, name: "x", revision: 3 },
    });
    expect(readPlansCache(storage, USER).mine).toEqual([]);
  });

  it("a new edit isn't folded into a PUT that already went out; both land (Inspector Brad #554)", async () => {
    const base = plan("srv-p1", USER, 2, [
      ["m1", "Lunch", [item("a", "Wrap", 450)]],
    ]);
    server.plans.set(base.id, base);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [base] });
    savePlanCommand(deps(), { ...base, name: "Edit A" });
    // A commits but its reply is lost.
    server.loseNextResponse = true;
    await drain();
    expect(server.plans.get("srv-p1")!.name).toBe("Edit A");
    savePlanCommand(deps(), {
      ...readPlansCache(storage, USER).mine[0]!,
      name: "Edit B",
    });
    expect(queued().filter((e) => e.method === "PUT")).toHaveLength(2);

    await drainLater();
    await drainLater();
    expect(server.plans.get("srv-p1")!.name).toBe("Edit B");
    const cache = readPlansCache(storage, USER);
    expect(cache.mine[0]!.name).toBe("Edit B");
    expect(cache.conflictPlanIds).toEqual([]);
    expect(queued()).toHaveLength(0);
  });

  it("a dead PUT doesn't hold back the cache or get a new revision (Inspector Brad #554)", async () => {
    const base = plan("srv-p1", USER, 2, []);
    server.plans.set(base.id, base);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [base] });
    savePlanCommand(deps(), { ...base, name: "Dead" });
    const dead = queued()[0]!;
    storage.markMutationPermanentlyFailed(dead.id, "rejected");
    savePlanCommand(deps(), { ...base, name: "B" });
    await drain();
    expect(readPlansCache(storage, USER).mine[0]).toMatchObject({
      name: "B",
      revision: 3,
    });
    expect(
      JSON.parse(
        storage.getUncompletedMutations().find((e) => e.id === dead.id)!
          .payload,
      ).expectedRevision,
    ).toBe(2);
  });

  it("an offline duplicate of a coach plan holds no coach-owned references (Inspector Brad #554)", async () => {
    const coachPlan = plan("coach-p", COACH, 1, [
      [
        "cm1",
        "Lunch",
        [
          {
            ...foodItem("x", "coach-food", 200),
            logEntry: {
              customName: "Coach chicken",
              servings: 1,
              kcal: 200,
              proteinG: 10,
              carbsG: 20,
              fatG: 5,
            },
          },
          { ...foodItem("y", "off-food", 100) },
        ],
      ],
    ]);
    server.plans.set(coachPlan.id, coachPlan);
    server.offline = true;
    const copy = duplicatePlanCommand(deps(), coachPlan);
    // The coach's private food becomes a one-off; a catalogue food the
    // client may log by id stays a reference.
    expect(copy.meals[0]!.items.map((i) => [i.kind, i.foodId])).toEqual([
      ["custom", null],
      ["food", "off-food"],
    ]);
    savePlanCommand(deps(), { ...copy, name: "Mine now" });
    const put = queued().find((e) => e.method === "PUT")!;
    expect(put.payload).not.toContain("coach-food");
  });

  it("a 409 that lands after the plan was deleted doesn't bring it back (Inspector Brad #554)", () => {
    const base = plan("srv-p1", USER, 2, []);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [base] });
    savePlanCommand(deps(), { ...base, name: "x" });
    const put = queued()[0]!;
    storage.markMutationInFlight(put.id);
    storage.markMutationDispatched(put.id);
    deletePlanCommand(deps(), "srv-p1");
    const current = { ...base, name: "From the iPad", revision: 3 };
    expect(
      applyNutritionPlanConflict(
        storage,
        put,
        409,
        JSON.stringify({ current }),
      ),
    ).toBe(true);
    expect(readPlansCache(storage, USER).mine).toEqual([]);
    expect(readPlansCache(storage, USER).conflictPlanIds).toEqual([]);
  });

  it.each([
    ["never reached the server", "offline"],
    ["committed but its reply was lost", "lost"],
  ])(
    "a newer edit never goes out before an older one waiting to retry (A %s; Inspector Brad #554)",
    async (_label, mode) => {
      const base = plan("srv-p1", USER, 2, [
        ["m1", "Lunch", [item("a", "Wrap", 450)]],
      ]);
      server.plans.set(base.id, base);
      storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [base] });
      savePlanCommand(deps(), { ...base, name: "Edit A" });
      if (mode === "offline") server.offline = true;
      else server.loseNextResponse = true;
      await drain(); // A fails in transport and waits for its backoff
      server.offline = false;

      // The user edits again; `save` drains straight away.
      savePlanCommand(deps(), {
        ...readPlansCache(storage, USER).mine[0]!,
        name: "Edit B",
      });
      await drain();
      await drainLater();
      await drainLater();

      expect(server.plans.get("srv-p1")!.name).toBe("Edit B");
      const cache = readPlansCache(storage, USER);
      expect(cache.mine[0]!.name).toBe("Edit B");
      expect(cache.conflictPlanIds).toEqual([]);
      expect(queued()).toHaveLength(0);
    },
  );

  it("an edit to a duplicate survives the duplicate failing and being retried (Inspector Brad #554)", async () => {
    const src = plan("srv-src", USER, 1, [
      ["m1", "Lunch", [item("a", "Wrap", 450)]],
    ]);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [src] });
    const copy = duplicatePlanCommand(deps(), src);
    savePlanCommand(deps(), { ...copy, name: "My version" });
    // The source isn't on the server yet: the duplicate 404s for good.
    await drain();
    const rows = storage.getUncompletedMutations();
    const put = rows.find((e) => e.method === "PUT");
    expect(put).toBeDefined();
    expect(
      JSON.parse(rows.find((e) => e.endpoint.endsWith("/duplicate"))!.payload),
    ).toEqual({});

    // Retry once the source exists.
    server.plans.set(src.id, src);
    storage.resetFailedEntries(
      storage.getUncompletedMutations().map((e) => e.id),
    );
    await drainLater();
    await drainLater();
    const mine = readPlansCache(storage, USER).mine.filter(
      (p) => p.id !== "srv-src",
    );
    expect(mine.map((p) => p.name)).toEqual(["My version"]);
    expect(server.plans.get(mine[0]!.id)!.name).toBe("My version");
  });

  it("a draft opened before its own earlier edit synced saves without a false conflict (Inspector Brad #554)", async () => {
    const base = plan("srv-p1", USER, 2, [
      ["m1", "Lunch", [item("a", "Wrap", 450)]],
    ]);
    server.plans.set(base.id, base);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [base] });
    server.offline = true;
    savePlanCommand(deps(), { ...base, name: "Edit A" });
    await drain();
    // The builder reopens on the cached plan (still revision 2)…
    const draft = readPlansCache(storage, USER).mine[0]!;
    expect(draft.revision).toBe(2);
    // …and the edit syncs meanwhile.
    server.offline = false;
    await drainLater();
    expect(readPlansCache(storage, USER).mine[0]!.revision).toBe(3);

    savePlanCommand(deps(), { ...draft, name: "Edit B" });
    await drainLater();
    expect(server.plans.get("srv-p1")!.name).toBe("Edit B");
    expect(readPlansCache(storage, USER).conflictPlanIds).toEqual([]);
  });

  it("a draft behind an edit from ANOTHER device still conflicts", async () => {
    const base = plan("srv-p1", USER, 2, [
      ["m1", "Lunch", [item("a", "Wrap", 450)]],
    ]);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [base] });
    // A read brings revision 3 made elsewhere.
    const elsewhere = { ...base, name: "From the iPad", revision: 3 };
    server.plans.set(base.id, elsewhere);
    storage.cacheNutritionPlans(USER, {
      ...emptyPlansCache(),
      mine: [elsewhere],
    });
    savePlanCommand(deps(), { ...base, name: "Stale draft" });
    expect(JSON.parse(queued()[0]!.payload).expectedRevision).toBe(2);
    await drain();
    expect(readPlansCache(storage, USER).conflictPlanIds).toEqual(["srv-p1"]);
  });

  it("deleting a plan that never left the phone forgets it and its shopping row", () => {
    server.offline = true;
    const p = createPlanCommand(deps(), draft());
    setPlanInShoppingListCommand(deps(), p.id, true);
    deletePlanCommand(deps(), p.id);
    expect(queued()).toHaveLength(0);
    expect(readPlansCache(storage, USER).mine).toEqual([]);
    expect(readShoppingCache(storage, USER).list!.plans).toEqual([]);
  });

  it("deleting a synced plan drops unsent edits and queues one DELETE", async () => {
    const synced = plan("srv-p1", USER, 2, []);
    server.plans.set(synced.id, synced);
    storage.cacheNutritionPlans(USER, { ...emptyPlansCache(), mine: [synced] });
    server.offline = true;
    savePlanCommand(deps(), { ...synced, name: "x" });
    deletePlanCommand(deps(), "srv-p1");
    expect(queued().map((e) => e.method)).toEqual(["DELETE"]);
    server.offline = false;
    await drainLater();
    expect(server.plans.get("srv-p1")!.archivedAt).toBe("now");
  });

  it("livePlanEdits sees plan and assignment rows only", () => {
    createPlanCommand(deps(), draft());
    setPlanInShoppingListCommand(deps(), "srv-x", true);
    expect(livePlanEdits(storage).map((e) => e.entityType)).toEqual([
      NUTRITION_PLAN_ENTITY,
    ]);
  });

  it("a synced reply that isn't a plan changes nothing", () => {
    storage.cacheNutritionPlans(USER, emptyPlansCache());
    const entry =
      queued()[0] ?? ({ id: 1, entityId: "local-x" } as SyncQueueEntry);
    applyNutritionPlanSynced(storage, entry, { data: { nope: true } });
    applyNutritionPlanSynced(storage, entry, null);
    expect(readPlansCache(storage, USER)).toEqual(emptyPlansCache());
  });

  it("adopting a synced plan adds it when the cache doesn't have it", () => {
    storage.cacheNutritionPlans(USER, emptyPlansCache());
    const p = plan("srv-9", USER, 1, []);
    applyNutritionPlanSynced(
      storage,
      { id: 99, entityId: "srv-9" } as SyncQueueEntry,
      {
        data: p,
      },
    );
    expect(readPlansCache(storage, USER).mine.map((x) => x.id)).toEqual([
      "srv-9",
    ]);
  });

  it("toPlanInput sends references, one-offs with per-serving macros", () => {
    const p = plan("p", USER, 1, [
      [
        "m",
        "Lunch",
        [foodItem("f", "food-1", 200), withServings(item("c", "Soup", 100), 2)],
      ],
    ]);
    const body = toPlanInput({
      ...p,
      meals: [
        {
          ...p.meals[0]!,
          items: [
            ...p.meals[0]!.items,
            {
              ...foodItem("r", "x", 1),
              kind: "recipe",
              foodId: null,
              recipeId: "rec-1",
            },
            {
              ...foodItem("s", "x", 1),
              kind: "meal",
              foodId: null,
              mealId: "meal-1",
            },
          ],
        },
      ],
    });
    expect(body.meals[0]!.items).toEqual([
      { foodId: "food-1", servings: 1, sortOrder: 0 },
      {
        // Per serving: the server multiplies by `servings`.
        custom: { name: "Soup", kcal: 100, proteinG: 5, carbsG: 10, fatG: 2.5 },
        servings: 2,
        sortOrder: 1,
      },
      { recipeId: "rec-1", servings: 1, sortOrder: 2 },
      { mealId: "meal-1", servings: 1, sortOrder: 3 },
    ]);
  });
});

describe("shopping list", () => {
  const list = (plans: string[]): PlansShoppingList => ({
    aisles: [
      {
        aisle: "Meat & fish",
        items: [{ id: "chicken", name: "Chicken breast", quantity: "450 g" }],
      },
    ],
    totalItems: 1,
    plans: plans.map((id) => ({
      nutritionPlanId: id,
      mealPlanId: null,
      addedAt: "t",
    })),
    asOf: "t",
  });

  it("ticks stay on the phone and survive a fresh read", () => {
    toggleShoppingTickCommand(storage, USER, "chicken");
    applyShoppingListRead(storage, USER, list(["p1"]));
    expect(readShoppingCache(storage, USER).ticked).toEqual(["chicken"]);
    toggleShoppingTickCommand(storage, USER, "chicken");
    expect(readShoppingCache(storage, USER).ticked).toEqual([]);
    expect(queued()).toHaveLength(0);
  });

  it("removing a plan never overtakes an add still waiting to retry (Inspector Brad #554)", async () => {
    setPlanInShoppingListCommand(deps(), "p1", true);
    server.loseNextResponse = true; // the add commits, its reply is lost
    await drain();
    setPlanInShoppingListCommand(deps(), "p1", false);
    await drain(); // as setPlanIncluded does
    await drainLater();
    await drainLater();
    expect(server.shoppingPlans).toEqual([]);
    expect(queued()).toHaveLength(0);
  });

  it("adding then removing before sending cancels out; a read keeps unsent chips", () => {
    server.offline = true;
    setPlanInShoppingListCommand(deps(), "p1", true);
    setPlanInShoppingListCommand(deps(), "p1", true); // no-op
    applyShoppingListRead(storage, USER, list([]));
    expect(
      readShoppingCache(storage, USER).list!.plans.map(
        (p) => p.nutritionPlanId,
      ),
    ).toEqual(["p1"]);
    setPlanInShoppingListCommand(deps(), "p1", false);
    expect(queued()).toHaveLength(0);
  });

  it("removing a synced plan queues a DELETE and a read before it sends hides the chip", async () => {
    storage.cachePlansShopping(USER, { list: list(["p2"]), ticked: [] });
    server.shoppingPlans = ["p2"];
    server.offline = true;
    setPlanInShoppingListCommand(deps(), "p2", false);
    applyShoppingListRead(storage, USER, list(["p2"]));
    expect(readShoppingCache(storage, USER).list!.plans).toEqual([]);
    expect(queued()[0]!.entityType).toBe(SHOPPING_LIST_PLAN_ENTITY);
    server.offline = false;
    await drainLater();
    expect(server.shoppingPlans).toEqual([]);
  });
});
