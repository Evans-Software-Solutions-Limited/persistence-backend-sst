/**
 * PER-132 — offline food logging and replay through
 * `POST /nutrition/entries/batch`, plus Your meals syncing first.
 *
 * The fake server below behaves like the merged PER-109 backend: each entry is
 * idempotent on its `clientRequestId` (single POST: the `Idempotency-Key`
 * header), in one shared key space, so the tests can count real rows.
 */
import { processSyncQueue, NUTRITION_BATCH_MAX } from "../sync.command";
import { logEntryCommand } from "../nutrition.command";
import { saveUserMealsCommand } from "../userMeals.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import type { LogEntryInput } from "@/domain/models/nutrition";
import type { UserMeal } from "@/domain/models/userMeals";
import { addUserMeal } from "@/domain/services/userMeals.service";
import { captureSyncFailure } from "@/lib/sentry";

jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));

const BASE = "https://api.test";
const USER = "user-1";
const DAY = "2026-11-23";
const AFTER_BACKOFF = { now: () => Date.now() + 10 * 60_000 };

type Row = { id: string; key: string; body: Record<string, unknown> };

/** A server that stores entries once per key and knows the caller's meals. */
class FakeServer {
  rows: Row[] = [];
  meals: UserMeal[] = [];
  calls: {
    url: string;
    method: string;
    body: unknown;
    headers: Record<string, string>;
  }[] = [];
  /** Commit the request but lose the response (a timeout after commit). */
  loseNextResponse = false;
  batchStatus: number | null = null;
  offline = false;
  private seq = 0;

  private upsert(key: string, body: Record<string, unknown>) {
    const existing = this.rows.find((r) => r.key === key);
    if (existing) return { entry: { id: existing.id, ...existing.body } };
    if (
      typeof body.userMealId === "string" &&
      !this.meals.some((m) => m.id === body.userMealId)
    ) {
      return { error: "user_meal_not_found" };
    }
    const row = { id: `srv-${++this.seq}`, key, body };
    this.rows.push(row);
    return { entry: { id: row.id, ...body } };
  }

  fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    const body = init.body
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : {};
    this.calls.push({ url, method: init.method, body, headers: init.headers });
    if (this.offline) throw new TypeError("Network request failed");
    const reply = (status: number, json: unknown) => {
      if (this.loseNextResponse) {
        this.loseNextResponse = false;
        throw new TypeError("Network request failed");
      }
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
        text: async () => JSON.stringify(json),
      };
    };
    if (url === `${BASE}/nutrition/entries/batch`) {
      if (this.batchStatus !== null) {
        return reply(this.batchStatus, { error: "x" });
      }
      const entries = body.entries as Record<string, unknown>[];
      const results = entries.map((e) => ({
        clientRequestId: e.clientRequestId as string,
        ...this.upsert(e.clientRequestId as string, e),
      }));
      return reply(200, { data: { results } });
    }
    if (url === `${BASE}/nutrition/entries` && init.method === "POST") {
      const r = this.upsert(init.headers["Idempotency-Key"]!, body);
      return "error" in r
        ? reply(400, { error: r.error })
        : reply(201, { data: r.entry });
    }
    if (url === `${BASE}/nutrition/user-meals` && init.method === "PUT") {
      const rows = body.meals as Record<string, unknown>[];
      this.meals = rows.map((m, i) => {
        const prior =
          this.meals.find((x) => x.id === m.id) ??
          this.meals.find(
            (x) => m.clientRequestId && x.clientRequestId === m.clientRequestId,
          );
        return {
          id: prior?.id ?? `um-${++this.seq}`,
          name: m.name as string,
          logSlot: m.logSlot as UserMeal["logSlot"],
          sortOrder: i,
          defaultKey: prior?.defaultKey ?? null,
          clientRequestId: (m.clientRequestId as string) ?? null,
          archivedAt: null,
          updatedAt: "2026-11-23T00:00:00.000Z",
        };
      });
      return reply(200, { data: { meals: this.meals, asOf: "now" } });
    }
    return reply(404, { error: "not_found" });
  };
}

const seeded = (): UserMeal[] =>
  (
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

describe("offline logging and batch replay (PER-132)", () => {
  let storage: InMemoryStorageAdapter;
  let auth: InMemoryAuthAdapter;
  let server: FakeServer;
  let n = 0;
  const log = (input: Partial<LogEntryInput> = {}) =>
    logEntryCommand(
      { storage, userId: USER, idFactory: () => `id${++n}` },
      {
        mealSlot: "lunch",
        servings: 1,
        kcal: 300,
        proteinG: 20,
        carbsG: 30,
        fatG: 10,
        customName: "Wrap",
        loggedAt: `${DAY}T12:00:00.000Z`,
        ...input,
      },
    );

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
    auth = new InMemoryAuthAdapter();
    server = new FakeServer();
    server.meals = seeded();
    storage.cacheUserMeals(USER, seeded());
    (globalThis as Record<string, unknown>).fetch = jest.fn(server.fetch);
    jest.mocked(captureSyncFailure).mockClear();
  });

  it("logging offline writes the entry locally and queues it with its own key", async () => {
    server.offline = true;
    const e = log({ userMealId: "um-l" });
    await processSyncQueue(storage, auth, BASE);

    const day = storage.getCachedFuelToday(USER, DAY)!;
    expect(day.entriesBySlot.lunch.map((x) => x.id)).toEqual([e.id]);
    expect(day.entriesBySlot.lunch[0]!.userMealId).toBe("um-l");
    expect(day.consumed.kcal).toBe(300);
    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.idempotencyKey).toEqual(expect.any(String));
    expect(JSON.parse(queued[0]!.payload).userMealId).toBe("um-l");
    expect(server.rows).toHaveLength(0);
  });

  it("a slot-only log (no meal) sends no userMealId at all, as 1.2.0 does", () => {
    log();
    expect(
      JSON.parse(storage.getPendingMutations()[0]!.payload),
    ).not.toHaveProperty("userMealId");
  });

  it("reconnecting replays every queued log in ONE batch call, keyed by its queue key", async () => {
    server.offline = true;
    // Ids captured now: the cache swaps them in place once synced.
    const a = log({ userMealId: "um-l" }).id;
    const b = log({ mealSlot: "dinner", userMealId: "um-d" }).id;
    const c = log({ mealSlot: "snack" }).id;
    await processSyncQueue(storage, auth, BASE);
    const keys = storage.getPendingMutations().map((q) => q.idempotencyKey);

    server.offline = false;
    server.calls = [];
    const result = await processSyncQueue(storage, auth, BASE, AFTER_BACKOFF);

    expect(result).toMatchObject({ succeeded: 3, failed: 0 });
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]!.url).toBe(`${BASE}/nutrition/entries/batch`);
    const sent = (
      server.calls[0]!.body as { entries: { clientRequestId: string }[] }
    ).entries;
    expect(sent.map((x) => x.clientRequestId)).toEqual(keys);
    expect(server.rows).toHaveLength(3);
    // Local ids swapped to the server's.
    const day = storage.getCachedFuelToday(USER, DAY)!;
    const ids = Object.values(day.entriesBySlot)
      .flat()
      .map((x) => x.id);
    expect(ids.sort()).toEqual(["srv-1", "srv-2", "srv-3"]);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
    expect(ids).not.toContain(c);
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("a batch whose response was lost is re-sent and creates no duplicates", async () => {
    log();
    log();
    server.loseNextResponse = true;
    await processSyncQueue(storage, auth, BASE);
    expect(server.rows).toHaveLength(2); // committed…
    // One attempt per drain: the deferred entries are not re-sent at once.
    expect(server.calls).toHaveLength(1);
    expect(storage.getPendingMutations()).toHaveLength(2); // …but unacknowledged

    await processSyncQueue(storage, auth, BASE, AFTER_BACKOFF);
    expect(server.rows).toHaveLength(2);
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("an entry sent once as a single POST and again in a batch is still one row", async () => {
    log();
    // An older build (or the fallback path) already sent it singly.
    const q = storage.getPendingMutations()[0]!;
    await server.fetch(`${BASE}/nutrition/entries`, {
      method: "POST",
      headers: { "Idempotency-Key": q.idempotencyKey! },
      body: q.payload,
    });
    await processSyncQueue(storage, auth, BASE);
    expect(server.rows).toHaveLength(1);
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("caps a batch at the server's 50 and sends the rest next", async () => {
    for (let i = 0; i < NUTRITION_BATCH_MAX + 2; i++) log();
    await processSyncQueue(storage, auth, BASE);
    const batches = server.calls.filter((c) => c.url.endsWith("/batch"));
    expect(batches).toHaveLength(2);
    expect((batches[0]!.body as { entries: unknown[] }).entries).toHaveLength(
      NUTRITION_BATCH_MAX,
    );
    expect(server.rows).toHaveLength(NUTRITION_BATCH_MAX + 2);
  });

  it("a meal added offline syncs first; its entries then sync against the server id", async () => {
    server.offline = true;
    const next = addUserMeal(
      seeded(),
      "Pre-workout",
      "k1",
      "2026-11-23T00:00:00Z",
    );
    saveUserMealsCommand({ storage, userId: USER }, next);
    log({ mealSlot: "snack", userMealId: "local-k1" });
    await processSyncQueue(storage, auth, BASE);

    server.offline = false;
    await processSyncQueue(storage, auth, BASE, AFTER_BACKOFF);

    const created = server.meals.find((m) => m.clientRequestId === "k1")!;
    expect(created).toBeDefined();
    expect(server.rows).toHaveLength(1);
    expect(server.rows[0]!.body.userMealId).toBe(created.id);
    expect(storage.getCachedUserMeals(USER)!.map((m) => m.id)).toContain(
      created.id,
    );
    const day = storage.getCachedFuelToday(USER, DAY)!;
    expect(day.entriesBySlot.snack[0]!.userMealId).toBe(created.id);
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("a per-entry error fails only that entry; the rest are logged", async () => {
    log({ userMealId: "um-l" });
    log({ userMealId: "00000000-dead-4000-8000-000000000000" });
    const result = await processSyncQueue(storage, auth, BASE);
    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(server.rows).toHaveLength(1);
    expect(storage.getFailedExhaustedEntries()).toHaveLength(1);
    expect(captureSyncFailure).toHaveBeenCalled();
  });

  it("a whole-batch 4xx falls back to single sends, still keyed", async () => {
    log();
    log();
    server.batchStatus = 404; // e.g. a backend without the route
    const result = await processSyncQueue(storage, auth, BASE);
    expect(result).toMatchObject({ succeeded: 2 });
    const singles = server.calls.filter(
      (c) => c.url === `${BASE}/nutrition/entries`,
    );
    expect(singles).toHaveLength(2);
    expect(singles.every((c) => c.headers["Idempotency-Key"])).toBe(true);
    expect(server.rows).toHaveLength(2);
  });

  it("a 5xx charges every entry and keeps them for a later retry", async () => {
    log();
    server.batchStatus = 503;
    const result = await processSyncQueue(storage, auth, BASE);
    expect(result).toMatchObject({ failed: 1 });
    const [q] = storage.getPendingMutations();
    expect(q!.retryCount).toBe(1);
    server.batchStatus = null;
    await processSyncQueue(storage, auth, BASE, AFTER_BACKOFF);
    expect(server.rows).toHaveLength(1);
  });

  it("a batch that 500s again is sent singly, so one bad entry can't fail the rest (Inspector Brad #550)", async () => {
    log();
    log({ customName: "Poison" });
    log();
    // The server throws on one entry, so every batch containing it 500s.
    const realFetch = server.fetch;
    (globalThis as Record<string, unknown>).fetch = jest.fn(
      async (
        url: string,
        init: {
          method: string;
          headers: Record<string, string>;
          body?: string;
        },
      ) => {
        const body = init.body ? JSON.parse(init.body) : {};
        const poisoned = url.endsWith("/batch")
          ? (body.entries as { customName?: string }[]).some(
              (e) => e.customName === "Poison",
            )
          : body.customName === "Poison";
        if (poisoned) {
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
            text: async () => "boom",
          };
        }
        return realFetch(url, init);
      },
    );
    const first = await processSyncQueue(storage, auth, BASE);
    expect(first.failed).toBe(3); // first 500: charged as transient
    const second = await processSyncQueue(storage, auth, BASE, AFTER_BACKOFF);
    expect(second.succeeded).toBe(2);
    expect(server.rows).toHaveLength(2);
    const [left] = storage.getPendingMutations();
    expect(JSON.parse(left!.payload).customName).toBe("Poison");
  });

  it("a 402 blocks the entries for the upgrade flow", async () => {
    log();
    (globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
      ok: false,
      status: 402,
      text: async () =>
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          feature: "ai_access",
          current_tier: "free",
          upgrade_to: "premium",
          upgrade_price_monthly: 4.99,
        }),
    }));
    const result = await processSyncQueue(storage, auth, BASE);
    expect(result.blocked).toBe(1);
    expect(storage.getBlockedEntries()).toHaveLength(1);
  });

  it("an answered batch missing an entry's result charges that entry", async () => {
    log();
    (globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { results: [] } }),
      text: async () => "",
    }));
    const result = await processSyncQueue(storage, auth, BASE);
    expect(result.failed).toBe(1);
    expect(storage.getPendingMutations()[0]!.errorMessage).toBe(
      "missing batch result",
    );
  });

  it("an entry still pointing at an unsynced meal waits instead of failing", async () => {
    // The Your meals PUT has not been queued (e.g. discarded), so the local
    // reference can never resolve this drain: it goes the single path and is
    // deferred, not permanently failed.
    log({ userMealId: "local-zzz" });
    await processSyncQueue(storage, auth, BASE);
    expect(storage.getFailedExhaustedEntries()).toHaveLength(0);
    expect(storage.getPendingMutations()).toHaveLength(1);
  });

  describe("single-send fallback (whole batch rejected as 4xx)", () => {
    const respond = (...replies: (() => unknown)[]) => {
      const queue = [...replies];
      (globalThis as Record<string, unknown>).fetch = jest.fn(async () => {
        const next = queue.shift();
        if (!next) throw new Error("no more replies");
        return next();
      });
    };
    const status =
      (code: number, body: unknown = {}) =>
      () => ({
        ok: code < 300,
        status: code,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });

    it("marks a single that the server rejects as permanently failed", async () => {
      log();
      respond(status(400), status(400, { error: "macros_required" }));
      const result = await processSyncQueue(storage, auth, BASE);
      expect(result.failed).toBe(1);
      expect(storage.getFailedExhaustedEntries()).toHaveLength(1);
    });

    it("defers a single that can't reach the server", async () => {
      log();
      respond(status(422), () => {
        throw new TypeError("Network request failed");
      });
      await processSyncQueue(storage, auth, BASE);
      const [q] = storage.getPendingMutations();
      expect(q!.retryCount).toBe(0);
      expect(q!.deferKind).toBe("transport");
    });

    it("blocks a single answered 402", async () => {
      log();
      respond(
        status(400),
        status(402, {
          code: "ENTITLEMENT_DENIED",
          feature: "ai_access",
          current_tier: "free",
          upgrade_to: "premium",
          upgrade_price_monthly: 4.99,
        }),
      );
      const result = await processSyncQueue(storage, auth, BASE);
      expect(result.blocked).toBe(1);
    });

    it("completes a single whose reply body is unreadable", async () => {
      log();
      respond(status(400), () => ({
        ok: true,
        status: 201,
        json: async () => {
          throw new Error("bad json");
        },
        text: async () => "",
      }));
      const result = await processSyncQueue(storage, auth, BASE);
      expect(result.succeeded).toBe(1);
    });
  });

  it("completes the batch even when its reply can't be read, charging the entries", async () => {
    log();
    (globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
      text: async () => "",
    }));
    const result = await processSyncQueue(storage, auth, BASE);
    expect(result.failed).toBe(1);
    // The key is unchanged, so the re-send is safe.
    expect(storage.getPendingMutations()).toHaveLength(1);
  });
});
