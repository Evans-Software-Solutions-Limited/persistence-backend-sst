/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

const repo = {
  getUserTimezone: vi.fn(async () => "Europe/London"),
  getBodyTrend: vi.fn(async () => [
    { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
    { date: "2026-06-25", weightKg: 79.2, bodyFat: 20.4 },
  ]),
};
vi.mock("../../../repositories/homeReadRepository", () => ({
  HomeReadRepository: vi.fn(() => repo),
}));

/** Thenable query-builder mock; awaiting resolves to the next queued result. */
function executor(queue: unknown[]) {
  let i = 0;
  const builder: any = {};
  const passthrough = () => builder;
  for (const m of ["select", "from", "where", "limit"]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.then = (resolve: (v: unknown[]) => unknown) =>
    resolve((queue[i++] ?? []) as unknown[]);
  return builder;
}

const auth = { authorization: "Bearer token" };

function get(
  clientId: string,
  query = "",
  headers: Record<string, string> = auth,
) {
  return new Request(
    `http://localhost/clients/${clientId}/body-trend${query}`,
    { method: "GET", headers },
  );
}

describe("trainersClientBodyTrendHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.getUserTimezone.mockResolvedValue("Europe/London");
    repo.getBodyTrend.mockResolvedValue([
      { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
      { date: "2026-06-25", weightKg: 79.2, bodyFat: 20.4 },
    ]);
  });

  it("requires auth", async () => {
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(
      get("client-1", "", {}),
    );
    expect(res.status).toBe(401);
  });

  it("403 when the caller has no active relationship with the client", async () => {
    (getDb as any).mockReturnValue(executor([[]])); // guard finds no row
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(get("client-1"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.code).toBe("not_your_client");
    expect(repo.getBodyTrend).not.toHaveBeenCalled();
  });

  it("200 returns the client's trend series bucketed in the CLIENT's timezone", async () => {
    (getDb as any).mockReturnValue(executor([[{ id: "rel-1" }]])); // active rel
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(get("client-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([
      { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
      { date: "2026-06-25", weightKg: 79.2, bodyFat: 20.4 },
    ]);
    // Timezone resolved for the CLIENT, not the trainer; default 30d window.
    expect(repo.getUserTimezone).toHaveBeenCalledWith("client-1");
    expect(repo.getBodyTrend).toHaveBeenCalledWith(
      "client-1",
      30,
      "Europe/London",
    );
  });

  it("parses the window query param (capped Nd format)", async () => {
    (getDb as any).mockReturnValue(executor([[{ id: "rel-1" }]]));
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(
      get("client-1", "?window=90d"),
    );
    expect(res.status).toBe(200);
    expect(repo.getBodyTrend).toHaveBeenCalledWith(
      "client-1",
      90,
      "Europe/London",
    );
  });
});
