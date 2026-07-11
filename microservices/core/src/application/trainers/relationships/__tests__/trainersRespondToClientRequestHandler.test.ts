/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Elysia from "elysia";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "trainer-id",
      email: "t@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "trainer-id" }),
}));

// Partial-mock the entitlement module: keep the REAL EntitlementError (so
// coreErrorHandler's `instanceof` maps it to 402) but stub the seat evaluator.
const evaluateActiveSeat = vi.fn(async () => ({ allowed: true }) as any);
vi.mock("../../../entitlement/assertEntitlement", async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>;
  return {
    ...actual,
    evaluateTrainerClientsActiveSeat: (...args: unknown[]) =>
      evaluateActiveSeat(...(args as [])),
  };
});

// Notification writer + push dispatcher + audit are mocked so these handler
// tests focus on wiring: activate → notify athlete → audit → post-commit push.
const createNotification = vi.fn(async () => ({ id: "notif-1" }) as any);
vi.mock("../../../repositories/notificationRepository", () => ({
  NotificationRepository: class {
    create = createNotification;
  },
}));
const dispatchExisting = vi.fn(async () => {});
vi.mock("../../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: class {
    dispatchExisting = dispatchExisting;
  },
}));
const auditTrainerAction = vi.fn(async () => {});
vi.mock("../../../relationships/auditTrainerAction", () => ({
  auditTrainerAction: (...args: unknown[]) =>
    auditTrainerAction(...(args as [])),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

/** Thenable query-builder mock (one queue entry == one awaited query). */
function executor(queue: unknown[]) {
  let i = 0;
  const builder: any = {};
  const passthrough = () => builder;
  for (const m of [
    "select",
    "from",
    "where",
    "innerJoin",
    "leftJoin",
    "orderBy",
    "limit",
    "update",
    "set",
    "returning",
    "for",
  ]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.then = (
    resolve: (v: unknown[]) => unknown,
    reject: (e: unknown) => unknown,
  ) => {
    const next = queue[i++] ?? [];
    if (next instanceof Error) return reject(next);
    return resolve(next as unknown[]);
  };
  return builder;
}

/** db mock whose `.transaction(fn)` runs `fn` against the SAME queued executor. */
function txDb(queue: unknown[]) {
  const ex = executor(queue);
  (ex as any).transaction = vi.fn(async (fn: any) => fn(ex));
  return ex;
}

describe("trainersRespondToClientRequestHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateActiveSeat.mockResolvedValue({ allowed: true } as any);
    createNotification.mockResolvedValue({ id: "notif-1" } as any);
  });

  function post(relationshipId: string, body: unknown, headers = auth) {
    return new Request(
      `http://localhost/trainers/me/relationships/${relationshipId}/respond`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
  }

  it("requires auth", async () => {
    const { trainersRespondToClientRequestHandler } =
      await import("../trainersRespondToClientRequestHandler");
    const res = await trainersRespondToClientRequestHandler.handle(
      new Request("http://localhost/trainers/me/relationships/rel-1/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("403 when the caller is not a trainer role", async () => {
    (getDb as any).mockReturnValue(txDb([[{ role: "user" }]]));
    const { trainersRespondToClientRequestHandler } =
      await import("../trainersRespondToClientRequestHandler");
    const res = await trainersRespondToClientRequestHandler.handle(
      post("rel-1", { action: "accept" }),
    );
    expect(res.status).toBe(403);
    expect(evaluateActiveSeat).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("accepts a client-initiated pending → active, notifies the athlete + audits", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ role: "personal_trainer" }], // role gate
        [{ fullName: "Carter", role: "personal_trainer" }], // coach name read
        [{ id: "rel-1", clientId: "client-1" }], // select pending rel
        [{ id: "trainer-id" }], // FOR UPDATE lock
        [{ id: "rel-1", clientId: "client-1", status: "active" }], // update
      ]),
    );
    const { trainersRespondToClientRequestHandler } =
      await import("../trainersRespondToClientRequestHandler");
    const res = await trainersRespondToClientRequestHandler.handle(
      post("rel-1", { action: "accept" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.success).toBe(true);
    expect(body.data.status).toBe("active");
    expect(body.data.clientId).toBe("client-1");
    // Athlete notified (in-tx row + post-commit push).
    expect(createNotification).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        type: "coach_request_accepted",
        message: "Coach Carter accepted your request",
      }),
      expect.anything(),
    );
    expect(dispatchExisting).toHaveBeenCalledWith("client-1", {
      id: "notif-1",
    });
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "client_request_accepted",
        clientId: "client-1",
        targetTable: "pt_client_relationships",
      }),
    );
  });

  it("uses bare-name copy for a physio coach", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ role: "physiotherapist" }],
        [{ fullName: "Dr Lee", role: "physiotherapist" }],
        [{ id: "rel-1", clientId: "client-1" }],
        [{ id: "trainer-id" }],
        [{ id: "rel-1", clientId: "client-1", status: "active" }],
      ]),
    );
    const { trainersRespondToClientRequestHandler } =
      await import("../trainersRespondToClientRequestHandler");
    await trainersRespondToClientRequestHandler.handle(
      post("rel-1", { action: "accept" }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({ message: "Dr Lee accepted your request" }),
      expect.anything(),
    );
  });

  it("402 upsell when the coach is at their client-slot cap (coach actor) — no activation, no notify", async () => {
    const { EntitlementError } =
      await import("../../../entitlement/assertEntitlement");
    const { coreErrorHandler } =
      await import("../../../../shared/errorHandler");
    evaluateActiveSeat.mockResolvedValueOnce({
      allowed: false,
      reason: "limit",
      currentTier: "individual_trainer",
      upgradeTo: "small_business",
      upgradePriceMonthly: 49.99,
    } as any);
    // Sanity: the real error type is preserved through the partial mock.
    expect(EntitlementError).toBeTypeOf("function");
    (getDb as any).mockReturnValue(
      txDb([
        [{ role: "personal_trainer" }],
        [{ fullName: "Carter", role: "personal_trainer" }],
        [{ id: "rel-1", clientId: "client-1" }],
        [{ id: "trainer-id" }],
        // NO update row consumed — cap throws before the activate UPDATE.
      ]),
    );
    const { trainersRespondToClientRequestHandler } =
      await import("../trainersRespondToClientRequestHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(trainersRespondToClientRequestHandler);
    const res = await app.handle(post("rel-1", { action: "accept" }));
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.code).toBe("ENTITLEMENT_DENIED");
    expect(body.feature).toBe("trainer_clients");
    expect(body.upgrade_to).toBe("small_business");
    expect(createNotification).not.toHaveBeenCalled();
    expect(dispatchExisting).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("404 on accept when no client-initiated pending row matches", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ role: "personal_trainer" }],
        [{ fullName: "Carter", role: "personal_trainer" }],
        [], // select pending rel → 0 rows
      ]),
    );
    const { trainersRespondToClientRequestHandler } =
      await import("../trainersRespondToClientRequestHandler");
    const res = await trainersRespondToClientRequestHandler.handle(
      post("rel-1", { action: "accept" }),
    );
    expect(res.status).toBe(404);
    expect(evaluateActiveSeat).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("declines a client-initiated pending → terminated + audits (no notification)", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ role: "personal_trainer" }],
        [{ id: "rel-1", clientId: "client-1", status: "terminated" }], // update
      ]),
    );
    const { trainersRespondToClientRequestHandler } =
      await import("../trainersRespondToClientRequestHandler");
    const res = await trainersRespondToClientRequestHandler.handle(
      post("rel-1", { action: "decline" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe("terminated");
    expect(evaluateActiveSeat).not.toHaveBeenCalled();
    expect(dispatchExisting).not.toHaveBeenCalled();
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "client_request_declined" }),
    );
  });

  it("404 on decline when no client-initiated pending row matches", async () => {
    (getDb as any).mockReturnValue(txDb([[{ role: "personal_trainer" }], []]));
    const { trainersRespondToClientRequestHandler } =
      await import("../trainersRespondToClientRequestHandler");
    const res = await trainersRespondToClientRequestHandler.handle(
      post("rel-1", { action: "decline" }),
    );
    expect(res.status).toBe(404);
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("422 for an invalid action", async () => {
    (getDb as any).mockReturnValue(txDb([[{ role: "personal_trainer" }]]));
    const { trainersRespondToClientRequestHandler } =
      await import("../trainersRespondToClientRequestHandler");
    const res = await trainersRespondToClientRequestHandler.handle(
      post("rel-1", { action: "maybe" }),
    );
    expect(res.status).toBe(422);
  });
});
