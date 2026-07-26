/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const savedGymRepositoryMocks = {
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findUnknownEquipmentTypeIds: vi.fn(),
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    // The token IS the user id, so a test can act as a second user.
    return {
      sub: authHeader.slice("Bearer ".length),
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
  getUser: vi.fn((ctx: any) => ctx.user || { sub: "user-a" }),
}));

vi.mock("../../../repositories/savedGymRepository", () => ({
  SavedGymRepository: vi.fn().mockImplementation(() => savedGymRepositoryMocks),
}));

const GYM_ID = "11111111-1111-4111-8111-111111111111";
const EQ_1 = "22222222-2222-4222-8222-222222222222";
const EQ_2 = "33333333-3333-4333-8333-333333333333";

const gym = {
  id: GYM_ID,
  name: "Hotel gym",
  equipmentTypeIds: [EQ_1, EQ_2],
  createdAt: new Date("2026-07-26T10:00:00Z"),
  updatedAt: new Date("2026-07-26T10:00:00Z"),
};

function req(
  path: string,
  init: { method?: string; body?: unknown; as?: string | null } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (init.as !== null) headers.authorization = `Bearer ${init.as ?? "user-a"}`;
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("saved-gym handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /saved-gyms", () => {
    it("401s without a token", async () => {
      const { savedGymsListHandler } = await import("../savedGymsListHandler");
      const res = await savedGymsListHandler.handle(
        req("/saved-gyms", { as: null }),
      );
      expect(res.status).toBe(401);
    });

    it("returns the CALLER's gyms, scoped by the jwt subject", async () => {
      savedGymRepositoryMocks.list.mockResolvedValue([gym]);
      const { savedGymsListHandler } = await import("../savedGymsListHandler");
      const res = await savedGymsListHandler.handle(
        req("/saved-gyms", { as: "user-b" }),
      );

      expect(res.status).toBe(200);
      // The userId comes from the validated JWT, never from the request —
      // there is no path by which user-b lists user-a's gyms.
      expect(savedGymRepositoryMocks.list).toHaveBeenCalledWith("user-b");
    });
  });

  describe("POST /saved-gyms", () => {
    it("401s without a token", async () => {
      const { savedGymsCreateHandler } =
        await import("../savedGymsCreateHandler");
      const res = await savedGymsCreateHandler.handle(
        req("/saved-gyms", { method: "POST", body: { name: "X" }, as: null }),
      );
      expect(res.status).toBe(401);
    });

    it("201s with the created gym", async () => {
      savedGymRepositoryMocks.create.mockResolvedValue({
        status: "ok",
        gym,
      });
      const { savedGymsCreateHandler } =
        await import("../savedGymsCreateHandler");
      const res = await savedGymsCreateHandler.handle(
        req("/saved-gyms", {
          method: "POST",
          body: { name: "Hotel gym", equipmentTypeIds: [EQ_1, EQ_2] },
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.name).toBe("Hotel gym");
      expect(savedGymRepositoryMocks.create).toHaveBeenCalledWith("user-a", {
        name: "Hotel gym",
        equipmentTypeIds: [EQ_1, EQ_2],
      });
    });

    it("defaults an absent kit to [] rather than undefined", async () => {
      savedGymRepositoryMocks.create.mockResolvedValue({ status: "ok", gym });
      const { savedGymsCreateHandler } =
        await import("../savedGymsCreateHandler");
      await savedGymsCreateHandler.handle(
        req("/saved-gyms", { method: "POST", body: { name: "Garage" } }),
      );

      expect(savedGymRepositoryMocks.create).toHaveBeenCalledWith("user-a", {
        name: "Garage",
        equipmentTypeIds: [],
      });
    });

    it("409s on a duplicate name (AC-7.4)", async () => {
      savedGymRepositoryMocks.create.mockResolvedValue({
        status: "duplicate_name",
      });
      const { savedGymsCreateHandler } =
        await import("../savedGymsCreateHandler");
      const res = await savedGymsCreateHandler.handle(
        req("/saved-gyms", { method: "POST", body: { name: "Hotel gym" } }),
      );

      expect(res.status).toBe(409);
      expect((await res.json()) as any).toMatchObject({
        code: "SAVED_GYM_NAME_TAKEN",
      });
    });

    it("400s on an unknown equipment id, naming the offenders", async () => {
      savedGymRepositoryMocks.create.mockResolvedValue({
        status: "unknown_equipment",
        unknownEquipmentTypeIds: [EQ_2],
      });
      const { savedGymsCreateHandler } =
        await import("../savedGymsCreateHandler");
      const res = await savedGymsCreateHandler.handle(
        req("/saved-gyms", {
          method: "POST",
          body: { name: "Garage", equipmentTypeIds: [EQ_1, EQ_2] },
        }),
      );

      expect(res.status).toBe(400);
      expect((await res.json()) as any).toMatchObject({
        code: "UNKNOWN_EQUIPMENT_TYPE",
        unknownEquipmentTypeIds: [EQ_2],
      });
    });

    it("400s on a whitespace-only name without touching the repository", async () => {
      const { savedGymsCreateHandler } =
        await import("../savedGymsCreateHandler");
      const res = await savedGymsCreateHandler.handle(
        req("/saved-gyms", { method: "POST", body: { name: "   " } }),
      );

      expect(res.status).toBe(400);
      expect(savedGymRepositoryMocks.create).not.toHaveBeenCalled();
    });

    it("422s on a malformed equipment uuid at the edge (not a Postgres 22P02 later)", async () => {
      const { savedGymsCreateHandler } =
        await import("../savedGymsCreateHandler");
      const res = await savedGymsCreateHandler.handle(
        req("/saved-gyms", {
          method: "POST",
          body: { name: "Garage", equipmentTypeIds: ["dumbbells"] },
        }),
      );

      expect(res.status).toBe(422);
      expect(savedGymRepositoryMocks.create).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /saved-gyms/:id", () => {
    it("updates and returns the row", async () => {
      savedGymRepositoryMocks.update.mockResolvedValue({ status: "ok", gym });
      const { savedGymsUpdateHandler } =
        await import("../savedGymsUpdateHandler");
      const res = await savedGymsUpdateHandler.handle(
        req(`/saved-gyms/${GYM_ID}`, {
          method: "PATCH",
          body: { name: "Hotel gym" },
        }),
      );

      expect(res.status).toBe(200);
      expect(savedGymRepositoryMocks.update).toHaveBeenCalledWith(
        GYM_ID,
        "user-a",
        { name: "Hotel gym" },
      );
    });

    it("passes ONLY the present fields through (present-only patch)", async () => {
      savedGymRepositoryMocks.update.mockResolvedValue({ status: "ok", gym });
      const { savedGymsUpdateHandler } =
        await import("../savedGymsUpdateHandler");
      await savedGymsUpdateHandler.handle(
        req(`/saved-gyms/${GYM_ID}`, {
          method: "PATCH",
          body: { equipmentTypeIds: [EQ_1] },
        }),
      );

      const patch = savedGymRepositoryMocks.update.mock.calls[0][2];
      expect(patch).toEqual({ equipmentTypeIds: [EQ_1] });
      expect("name" in patch).toBe(false);
    });

    it("404s for another user's gym — the isolation contract (no 403)", async () => {
      savedGymRepositoryMocks.update.mockResolvedValue({
        status: "not_found",
      });
      const { savedGymsUpdateHandler } =
        await import("../savedGymsUpdateHandler");
      const res = await savedGymsUpdateHandler.handle(
        req(`/saved-gyms/${GYM_ID}`, {
          method: "PATCH",
          body: { name: "Hijacked" },
          as: "user-b",
        }),
      );

      expect(res.status).toBe(404);
      // user-b's id is what reaches the repository, so the WHERE can't match.
      expect(savedGymRepositoryMocks.update).toHaveBeenCalledWith(
        GYM_ID,
        "user-b",
        { name: "Hijacked" },
      );
    });

    it("409s when the rename collides", async () => {
      savedGymRepositoryMocks.update.mockResolvedValue({
        status: "duplicate_name",
      });
      const { savedGymsUpdateHandler } =
        await import("../savedGymsUpdateHandler");
      const res = await savedGymsUpdateHandler.handle(
        req(`/saved-gyms/${GYM_ID}`, {
          method: "PATCH",
          body: { name: "Garage" },
        }),
      );
      expect(res.status).toBe(409);
    });

    it("400s on an unknown equipment id", async () => {
      savedGymRepositoryMocks.update.mockResolvedValue({
        status: "unknown_equipment",
        unknownEquipmentTypeIds: [EQ_1],
      });
      const { savedGymsUpdateHandler } =
        await import("../savedGymsUpdateHandler");
      const res = await savedGymsUpdateHandler.handle(
        req(`/saved-gyms/${GYM_ID}`, {
          method: "PATCH",
          body: { equipmentTypeIds: [EQ_1] },
        }),
      );
      expect(res.status).toBe(400);
    });

    it("400s on an empty patch without querying", async () => {
      const { savedGymsUpdateHandler } =
        await import("../savedGymsUpdateHandler");
      const res = await savedGymsUpdateHandler.handle(
        req(`/saved-gyms/${GYM_ID}`, { method: "PATCH", body: {} }),
      );

      expect(res.status).toBe(400);
      expect(savedGymRepositoryMocks.update).not.toHaveBeenCalled();
    });

    it("400s on a whitespace-only rename", async () => {
      const { savedGymsUpdateHandler } =
        await import("../savedGymsUpdateHandler");
      const res = await savedGymsUpdateHandler.handle(
        req(`/saved-gyms/${GYM_ID}`, { method: "PATCH", body: { name: " " } }),
      );

      expect(res.status).toBe(400);
      expect(savedGymRepositoryMocks.update).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /saved-gyms/:id", () => {
    it("deletes and confirms", async () => {
      savedGymRepositoryMocks.delete.mockResolvedValue(true);
      const { savedGymsDeleteHandler } =
        await import("../savedGymsDeleteHandler");
      const res = await savedGymsDeleteHandler.handle(
        req(`/saved-gyms/${GYM_ID}`, { method: "DELETE" }),
      );

      expect(res.status).toBe(200);
      expect((await res.json()) as any).toEqual({ data: { deleted: true } });
      expect(savedGymRepositoryMocks.delete).toHaveBeenCalledWith(
        GYM_ID,
        "user-a",
      );
    });

    it("404s for another user's gym", async () => {
      savedGymRepositoryMocks.delete.mockResolvedValue(false);
      const { savedGymsDeleteHandler } =
        await import("../savedGymsDeleteHandler");
      const res = await savedGymsDeleteHandler.handle(
        req(`/saved-gyms/${GYM_ID}`, { method: "DELETE", as: "user-b" }),
      );

      expect(res.status).toBe(404);
      expect(savedGymRepositoryMocks.delete).toHaveBeenCalledWith(
        GYM_ID,
        "user-b",
      );
    });
  });
});
