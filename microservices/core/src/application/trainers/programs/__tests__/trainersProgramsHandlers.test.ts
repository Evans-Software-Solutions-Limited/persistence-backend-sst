/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const programMocks = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const assignmentMocks = {
  assign: vi.fn(),
  unassign: vi.fn(),
  createAdHoc: vi.fn(),
  deleteAdHoc: vi.fn(),
  getActiveProgrammeForClient: vi.fn(),
};
const trainerMocks = { isTrainer: vi.fn() };
const guardMocks = { hasActiveRelationship: vi.fn() };

// `trainersClientActiveProgrammeGetHandler` now authorizes via the shared
// `assertTrainerCanActForClient` guard (25-coach-client-offboarding guard
// consolidation), so we mock that directly (below). The generic getDb stub is
// retained as a harmless no-op safety net; no handler in this file hits it now.
vi.mock("@persistence/db/client", () => ({
  getDb: () => {
    const chain: any = {};
    for (const k of ["from", "innerJoin", "where", "limit"])
      chain[k] = () => chain;
    chain.then = (res: any, rej: any) => Promise.resolve([]).then(res, rej);
    return { select: () => chain };
  },
}));

// Shared authorization guard for the active-programme read. Its internals
// (role + active non-AI relationship + client-not-soft-deleted) are covered in
// assertTrainerCanActForClient.test.ts; here we assert the handler forwards the
// verdict.
const assertActGuard = vi.fn();
vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: (...args: unknown[]) => assertActGuard(...args),
}));

const auditClientDataReadMock = vi.fn(async () => undefined);
vi.mock("../../../relationships/auditClientDataRead", () => ({
  auditClientDataRead: (...a: unknown[]) =>
    auditClientDataReadMock(...(a as [])),
}));

const DENY_NOT_CLIENT = {
  allowed: false as const,
  reason: "no_relationship" as const,
  status: 403 as const,
  body: {
    code: "not_your_client",
    message: "You can only act for your active clients",
  },
};

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

vi.mock("../../../repositories/programRepository", () => ({
  ProgramRepository: vi.fn().mockImplementation(() => programMocks),
  LIVE_ASSIGNMENT_STATUSES: ["assigned", "started"],
}));
vi.mock("../../../repositories/programAssignmentRepository", () => ({
  ProgramAssignmentRepository: vi
    .fn()
    .mockImplementation(() => assignmentMocks),
}));
vi.mock("../../../repositories/trainerRepository", () => ({
  TrainerRepository: vi.fn().mockImplementation(() => trainerMocks),
}));
vi.mock("../../relationships/activeRelationshipGuard", () => ({
  hasActiveRelationship: (...args: unknown[]) =>
    guardMocks.hasActiveRelationship(...args),
}));
vi.mock("../../onBehalfNotifications", () => ({
  emitTrainerOnBehalfNotification: vi.fn(async () => {}),
}));

import { emitTrainerOnBehalfNotification } from "../../onBehalfNotifications";

const authed = (url: string, init: { method?: string; body?: unknown } = {}) =>
  new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

describe("programme handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trainerMocks.isTrainer.mockResolvedValue(true);
    guardMocks.hasActiveRelationship.mockResolvedValue(true);
    assertActGuard.mockResolvedValue({ allowed: true });
    auditClientDataReadMock.mockResolvedValue(undefined);
  });

  describe("GET /trainers/me/clients/:clientId/active-programme", () => {
    const load = () =>
      import("../trainersClientActiveProgrammeGetHandler").then(
        (m) => m.trainersClientActiveProgrammeGetHandler,
      );

    it("requires auth", async () => {
      const h = await load();
      const res = await h.handle(
        new Request("http://localhost/trainers/me/clients/c1/active-programme"),
      );
      expect(res.status).toBe(401);
    });

    it("403 when the guard denies (not the caller's active client)", async () => {
      assertActGuard.mockResolvedValue(DENY_NOT_CLIENT);
      const h = await load();
      const res = await h.handle(
        authed("/trainers/me/clients/c1/active-programme"),
      );
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).code).toBe("not_your_client");
      expect(assertActGuard).toHaveBeenCalledWith("trainer-id", "c1");
      expect(
        assignmentMocks.getActiveProgrammeForClient,
      ).not.toHaveBeenCalled();
    });

    it("403 when the guard denies for a soft-deleted client (Cluster 2a, handled inside the guard)", async () => {
      assertActGuard.mockResolvedValue({
        allowed: false,
        reason: "client_deleted",
        status: 403,
        body: {
          code: "not_your_client",
          message: "You can only act for your active clients",
        },
      });
      const h = await load();
      const res = await h.handle(
        authed("/trainers/me/clients/c1/active-programme"),
      );
      expect(res.status).toBe(403);
      expect(
        assignmentMocks.getActiveProgrammeForClient,
      ).not.toHaveBeenCalled();
    });

    it("returns the client's active programme", async () => {
      const summary = {
        assignmentId: "pa1",
        programId: "p1",
        name: "Strength Foundations",
        week: 4,
        totalWeeks: 12,
        endDate: "2026-08-01",
        startDate: "2026-05-01",
      };
      assignmentMocks.getActiveProgrammeForClient.mockResolvedValue(summary);
      const h = await load();
      const res = await h.handle(
        authed("/trainers/me/clients/c1/active-programme"),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).data).toEqual(summary);
      expect(assignmentMocks.getActiveProgrammeForClient).toHaveBeenCalledWith(
        "c1",
        expect.any(String),
      );
    });

    it("returns null when the client has no live programme", async () => {
      assignmentMocks.getActiveProgrammeForClient.mockResolvedValue(null);
      const h = await load();
      const res = await h.handle(
        authed("/trainers/me/clients/c1/active-programme"),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).data).toBeNull();
    });

    it("logs a coach read-audit row (category=active_programme) after the guard passes", async () => {
      assignmentMocks.getActiveProgrammeForClient.mockResolvedValue(null);
      const h = await load();
      const res = await h.handle(
        authed("/trainers/me/clients/c1/active-programme"),
      );
      expect(res.status).toBe(200);
      expect(auditClientDataReadMock).toHaveBeenCalledWith({
        trainerId: "trainer-id",
        clientId: "c1",
        dataCategory: "active_programme",
        route: "/trainers/me/clients/:clientId/active-programme",
      });
    });

    it("still returns 200 if the read-audit write throws", async () => {
      auditClientDataReadMock.mockRejectedValue(new Error("audit db down"));
      assignmentMocks.getActiveProgrammeForClient.mockResolvedValue(null);
      const h = await load();
      const res = await h.handle(
        authed("/trainers/me/clients/c1/active-programme"),
      );
      expect(res.status).toBe(200);
    });
  });

  describe("GET /trainers/me/programs", () => {
    it("requires auth", async () => {
      const { trainersProgramsListHandler } =
        await import("../trainersProgramsListHandler");
      const res = await trainersProgramsListHandler.handle(
        new Request("http://localhost/trainers/me/programs"),
      );
      expect(res.status).toBe(401);
    });

    it("403 for non-trainers", async () => {
      trainerMocks.isTrainer.mockResolvedValue(false);
      const { trainersProgramsListHandler } =
        await import("../trainersProgramsListHandler");
      const res = await trainersProgramsListHandler.handle(
        authed("/trainers/me/programs"),
      );
      expect(res.status).toBe(403);
      expect(programMocks.list).not.toHaveBeenCalled();
    });

    it("returns the trainer's library", async () => {
      programMocks.list.mockResolvedValue([{ id: "p-1" }]);
      const { trainersProgramsListHandler } =
        await import("../trainersProgramsListHandler");
      const res = await trainersProgramsListHandler.handle(
        authed("/trainers/me/programs"),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).data).toEqual([{ id: "p-1" }]);
      expect(programMocks.list).toHaveBeenCalledWith("trainer-id");
    });
  });

  describe("POST /trainers/me/programs", () => {
    const body = {
      name: "Strength 4wk",
      durationWeeks: 4,
      daysPerWeek: 3,
      workoutIds: ["w-a"],
    };

    it("201 on create; indefinite (null durationWeeks) validates", async () => {
      programMocks.create.mockResolvedValue({ id: "p-1" });
      const { trainersProgramsCreateHandler } =
        await import("../trainersProgramsCreateHandler");
      const res = await trainersProgramsCreateHandler.handle(
        authed("/trainers/me/programs", {
          method: "POST",
          body: { ...body, durationWeeks: null },
        }),
      );
      expect(res.status).toBe(201);
      expect(programMocks.create).toHaveBeenCalledWith(
        "trainer-id",
        expect.objectContaining({ durationWeeks: null }),
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });

    it("422 when a workout isn't readable", async () => {
      programMocks.create.mockResolvedValue({ error: "invalid_workouts" });
      const { trainersProgramsCreateHandler } =
        await import("../trainersProgramsCreateHandler");
      const res = await trainersProgramsCreateHandler.handle(
        authed("/trainers/me/programs", { method: "POST", body }),
      );
      expect(res.status).toBe(422);
      expect(((await res.json()) as any).code).toBe("invalid_workouts");
    });

    it("rejects out-of-range daysPerWeek at the schema layer", async () => {
      const { trainersProgramsCreateHandler } =
        await import("../trainersProgramsCreateHandler");
      const res = await trainersProgramsCreateHandler.handle(
        authed("/trainers/me/programs", {
          method: "POST",
          body: { ...body, daysPerWeek: 9 },
        }),
      );
      expect(res.status).toBe(422);
      expect(programMocks.create).not.toHaveBeenCalled();
    });
  });

  describe("GET /trainers/me/programs/:id", () => {
    it("404 when missing or un-owned", async () => {
      programMocks.get.mockResolvedValue(null);
      const { trainersProgramsGetHandler } =
        await import("../trainersProgramsGetHandler");
      const res = await trainersProgramsGetHandler.handle(
        authed("/trainers/me/programs/p-x"),
      );
      expect(res.status).toBe(404);
    });

    it("returns detail", async () => {
      programMocks.get.mockResolvedValue({ id: "p-1", workouts: [] });
      const { trainersProgramsGetHandler } =
        await import("../trainersProgramsGetHandler");
      const res = await trainersProgramsGetHandler.handle(
        authed("/trainers/me/programs/p-1"),
      );
      expect(res.status).toBe(200);
      expect(programMocks.get).toHaveBeenCalledWith(
        "trainer-id",
        "p-1",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });
  });

  describe("PUT /trainers/me/programs/:id", () => {
    it("404 when the update matches nothing", async () => {
      programMocks.update.mockResolvedValue(null);
      const { trainersProgramsUpdateHandler } =
        await import("../trainersProgramsUpdateHandler");
      const res = await trainersProgramsUpdateHandler.handle(
        authed("/trainers/me/programs/p-x", {
          method: "PUT",
          body: { name: "New" },
        }),
      );
      expect(res.status).toBe(404);
    });

    it("422 on unreadable workouts; 200 with detail otherwise", async () => {
      programMocks.update.mockResolvedValueOnce({
        error: "invalid_workouts",
      });
      const { trainersProgramsUpdateHandler } =
        await import("../trainersProgramsUpdateHandler");
      const bad = await trainersProgramsUpdateHandler.handle(
        authed("/trainers/me/programs/p-1", {
          method: "PUT",
          body: { workoutIds: ["w-x"] },
        }),
      );
      expect(bad.status).toBe(422);

      programMocks.update.mockResolvedValueOnce({ id: "p-1" });
      const ok = await trainersProgramsUpdateHandler.handle(
        authed("/trainers/me/programs/p-1", {
          method: "PUT",
          body: { workoutIds: ["w-a"], durationWeeks: null },
        }),
      );
      expect(ok.status).toBe(200);
      expect(programMocks.update).toHaveBeenLastCalledWith(
        "trainer-id",
        "p-1",
        { workoutIds: ["w-a"], durationWeeks: null },
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });
  });

  describe("DELETE /trainers/me/programs/:id", () => {
    it("409 while live assignments exist", async () => {
      programMocks.delete.mockResolvedValue("has_live_assignments");
      const { trainersProgramsDeleteHandler } =
        await import("../trainersProgramsDeleteHandler");
      const res = await trainersProgramsDeleteHandler.handle(
        authed("/trainers/me/programs/p-1", { method: "DELETE" }),
      );
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).code).toBe(
        "PROGRAM_HAS_LIVE_ASSIGNMENTS",
      );
    });

    it("404 / 200 per repo verdict", async () => {
      programMocks.delete.mockResolvedValueOnce("not_found");
      const { trainersProgramsDeleteHandler } =
        await import("../trainersProgramsDeleteHandler");
      expect(
        (
          await trainersProgramsDeleteHandler.handle(
            authed("/trainers/me/programs/p-x", { method: "DELETE" }),
          )
        ).status,
      ).toBe(404);

      programMocks.delete.mockResolvedValueOnce("deleted");
      expect(
        (
          await trainersProgramsDeleteHandler.handle(
            authed("/trainers/me/programs/p-1", { method: "DELETE" }),
          )
        ).status,
      ).toBe(200);
    });
  });

  describe("POST /trainers/me/programs/:id/assign", () => {
    const body = { clientId: "client-1", startDate: "2026-07-03" };

    it("403 not_your_client without an active relationship", async () => {
      guardMocks.hasActiveRelationship.mockResolvedValue(false);
      const { trainersProgramsAssignHandler } =
        await import("../trainersProgramsAssignHandler");
      const res = await trainersProgramsAssignHandler.handle(
        authed("/trainers/me/programs/p-1/assign", { method: "POST", body }),
      );
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).code).toBe("not_your_client");
      expect(assignmentMocks.assign).not.toHaveBeenCalled();
    });

    it("maps repo errors: 404 / 409 / 422", async () => {
      const { trainersProgramsAssignHandler } =
        await import("../trainersProgramsAssignHandler");
      for (const [error, status] of [
        ["not_found", 404],
        ["already_assigned", 409],
        ["empty_program", 422],
      ] as const) {
        assignmentMocks.assign.mockResolvedValueOnce({ error });
        const res = await trainersProgramsAssignHandler.handle(
          authed("/trainers/me/programs/p-1/assign", {
            method: "POST",
            body,
          }),
        );
        expect(res.status).toBe(status);
      }
    });

    it("201 with the assignment; forwards visibility flags", async () => {
      assignmentMocks.assign.mockResolvedValue({
        assignment: { id: "pa-1" },
      });
      const { trainersProgramsAssignHandler } =
        await import("../trainersProgramsAssignHandler");
      const res = await trainersProgramsAssignHandler.handle(
        authed("/trainers/me/programs/p-1/assign", {
          method: "POST",
          body: { ...body, showInPlan: true, showInLibrary: false },
        }),
      );
      expect(res.status).toBe(201);
      expect(assignmentMocks.assign).toHaveBeenCalledWith(
        "trainer-id",
        "p-1",
        expect.objectContaining({
          clientId: "client-1",
          startDate: "2026-07-03",
          showInPlan: true,
          showInLibrary: false,
        }),
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });

    // QA-10 (device-QA sweep BRIEF-7) — the legacy per-row DB trigger used to
    // fire once per MATERIALISED occurrence (a flood for one programme
    // assign); the fix emits exactly one app-level notification per
    // programme assignment instead.
    it("emits exactly ONE workout_assigned notification per programme assignment", async () => {
      assignmentMocks.assign.mockResolvedValue({
        assignment: { id: "pa-1" },
      });
      const { trainersProgramsAssignHandler } =
        await import("../trainersProgramsAssignHandler");
      const res = await trainersProgramsAssignHandler.handle(
        authed("/trainers/me/programs/p-1/assign", { method: "POST", body }),
      );
      expect(res.status).toBe(201);
      expect(emitTrainerOnBehalfNotification).toHaveBeenCalledTimes(1);
      expect(emitTrainerOnBehalfNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "client-1",
          trainerId: "trainer-id",
          type: "workout_assigned",
          relatedEntityType: "program_assignment",
          relatedEntityId: "pa-1",
        }),
      );
    });

    it("does not notify when the assign fails (404/409/422)", async () => {
      assignmentMocks.assign.mockResolvedValueOnce({ error: "not_found" });
      const { trainersProgramsAssignHandler } =
        await import("../trainersProgramsAssignHandler");
      await trainersProgramsAssignHandler.handle(
        authed("/trainers/me/programs/p-1/assign", { method: "POST", body }),
      );
      expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
    });

    it("rejects a malformed startDate at the schema layer", async () => {
      const { trainersProgramsAssignHandler } =
        await import("../trainersProgramsAssignHandler");
      const res = await trainersProgramsAssignHandler.handle(
        authed("/trainers/me/programs/p-1/assign", {
          method: "POST",
          body: { ...body, startDate: "03/07/2026" },
        }),
      );
      expect(res.status).toBe(422);
      expect(assignmentMocks.assign).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /trainers/me/programs/:id/assignments/:assignmentId", () => {
    it("404 when missing/un-owned/terminal; 200 when unassigned", async () => {
      const { trainersProgramsUnassignHandler } =
        await import("../trainersProgramsUnassignHandler");
      assignmentMocks.unassign.mockResolvedValueOnce("not_found");
      expect(
        (
          await trainersProgramsUnassignHandler.handle(
            authed("/trainers/me/programs/p-1/assignments/pa-x", {
              method: "DELETE",
            }),
          )
        ).status,
      ).toBe(404);

      assignmentMocks.unassign.mockResolvedValueOnce("unassigned");
      const ok = await trainersProgramsUnassignHandler.handle(
        authed("/trainers/me/programs/p-1/assignments/pa-1", {
          method: "DELETE",
        }),
      );
      expect(ok.status).toBe(200);
      expect(assignmentMocks.unassign).toHaveBeenCalledWith(
        "trainer-id",
        "p-1",
        "pa-1",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });
  });

  // NOTE: the ad-hoc CREATE handler was re-homed in Coach Mode Phase 3 onto
  // the shared `assignClientWorkoutOnBehalf` core (assertTrainerCanActForClient
  // gate + audit-in-tx + post-commit notification), and the DELETE handler was
  // re-homed onto an in-handler transaction + `auditTrainerAction` (closing the
  // audit gap, cross-cuts § 1.4.2). Both are now covered by their own handler
  // test files:
  //   trainers/clients/__tests__/assignClientWorkout.test.ts (CREATE core)
  //   trainers/clients/__tests__/trainersClientWorkoutAssignmentsCreateHandler.test.ts
  //   trainers/clients/__tests__/trainersClientWorkoutAssignmentsDeleteHandler.test.ts
  // so the old inline-auth ad-hoc assignment tests were removed from here.
});
