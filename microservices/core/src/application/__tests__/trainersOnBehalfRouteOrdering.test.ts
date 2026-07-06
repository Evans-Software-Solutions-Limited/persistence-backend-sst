/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Route-ordering guard (Phase 5): the bare GET /trainers/me/clients/:clientId
// aggregate must NOT shadow the more-specific sibling `…/:clientId/...` routes
// mounted in the same trainersOnBehalfRoutes sub-app (habits/config,
// habits/completions, goals, sessions, measurements). Elysia's radix router
// matches static segments before the terminal `:clientId`, but a bug here would
// silently route a habit read into the detail aggregate — so we assert the
// resolution end-to-end through the composed sub-app.

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    h?.startsWith("Bearer ")
      ? {
          sub: "trainer-id",
          email: "t@e.com",
          email_verified: true,
          iat: 0,
          exp: 9e9,
        }
      : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "trainer-id" }),
}));

// Gate always allows — we only care which handler the router selects.
vi.mock("../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(async () => ({ allowed: true })),
}));

// Detail aggregate returns a unique marker so we can tell it apart.
const DETAIL_MARKER = { client: { id: "MARKER-DETAIL" } };
vi.mock("../repositories/clientDetailRepository", () => ({
  ClientDetailRepository: vi.fn(() => ({
    getClientDetail: vi.fn(async () => DETAIL_MARKER),
  })),
}));

import { trainersOnBehalfRoutes } from "../trainersOnBehalfRoutes";

const auth = { authorization: "Bearer token" };
const req = (path: string) =>
  new Request(`http://localhost${path}`, { method: "GET", headers: auth });

describe("trainersOnBehalfRoutes — route ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Habit config handler reads via HabitConfigRepository → getDb; empty
    // results make it emit the 5-category default array (its distinct shape).
    const chain: any = {};
    for (const k of [
      "from",
      "innerJoin",
      "leftJoin",
      "where",
      "orderBy",
      "limit",
    ]) {
      chain[k] = () => chain;
    }
    chain.then = (res: any) => Promise.resolve([]).then(res);
    (getDb as any).mockReturnValue({ select: () => chain });
  });

  it("GET /trainers/me/clients/:id resolves to the Client Detail aggregate", async () => {
    const res = await trainersOnBehalfRoutes.handle(
      req("/trainers/me/clients/client-1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.client.id).toBe("MARKER-DETAIL");
  });

  it("GET /trainers/me/clients/:id/habits/config still resolves to the habit-config handler (not shadowed)", async () => {
    const res = await trainersOnBehalfRoutes.handle(
      req("/trainers/me/clients/client-1/habits/config"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Habit handler emits a 5-category array — NOT the detail marker object.
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(5);
    expect(body.data.map((c: any) => c.category)).toContain("water");
  });
});
