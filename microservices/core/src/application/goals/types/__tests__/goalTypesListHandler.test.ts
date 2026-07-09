/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { listTypes: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "test-user-id",
      email: "test@example.com",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../../../repositories/goalRepository", () => ({
  GoalRepository: vi.fn().mockImplementation(() => mocks),
}));

const CATALOG = [
  {
    id: "gt-1",
    name: "Bench press 1RM",
    description: "Increase one-rep max on bench press",
    category: "strength",
    iconName: "barbell",
  },
  {
    id: "gt-2",
    name: "Body weight",
    description: null,
    category: null,
    iconName: null,
  },
];

describe("goalTypesListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTypes.mockResolvedValue(CATALOG);
  });

  it("should require authentication", async () => {
    const { goalTypesListHandler } = await import("../goalTypesListHandler");
    const response = await goalTypesListHandler.handle(
      new Request("http://localhost/goal-types", {
        method: "GET",
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.listTypes).not.toHaveBeenCalled();
  });

  it("should return 200 with the goal-type catalog mapped and sorted", async () => {
    const { goalTypesListHandler } = await import("../goalTypesListHandler");
    const response = await goalTypesListHandler.handle(
      new Request("http://localhost/goal-types", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: CATALOG });
    expect(mocks.listTypes).toHaveBeenCalledTimes(1);
  });
});
