/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "trainer-id",
      email: "t@x.com",
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

const deleteClientNoteOnBehalf = vi.fn();
vi.mock("../deleteClientNote", () => ({
  deleteClientNoteOnBehalf: (...args: unknown[]) =>
    deleteClientNoteOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function del(clientId: string, noteId: string, headers = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/notes/${noteId}`,
    { method: "DELETE", headers },
  );
}

describe("trainersMeDeleteClientNoteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteClientNoteOnBehalf.mockResolvedValue({ ok: true });
  });

  it("requires auth", async () => {
    const { trainersMeDeleteClientNoteHandler } =
      await import("../trainersMeDeleteClientNoteHandler");
    const res = await trainersMeDeleteClientNoteHandler.handle(
      del("client-1", "n-1", {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict to its status/body", async () => {
    deleteClientNoteOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const { trainersMeDeleteClientNoteHandler } =
      await import("../trainersMeDeleteClientNoteHandler");
    const res = await trainersMeDeleteClientNoteHandler.handle(
      del("client-1", "n-1"),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
  });

  it("maps a 404 (note not found) verdict", async () => {
    deleteClientNoteOnBehalf.mockResolvedValue({
      ok: false,
      status: 404,
      body: { code: "note_not_found", message: "x" },
    });
    const { trainersMeDeleteClientNoteHandler } =
      await import("../trainersMeDeleteClientNoteHandler");
    const res = await trainersMeDeleteClientNoteHandler.handle(
      del("client-1", "n-1"),
    );
    expect(res.status).toBe(404);
  });

  it("200s with { deleted: true } and delegates to the shared core with params threaded through", async () => {
    const { trainersMeDeleteClientNoteHandler } =
      await import("../trainersMeDeleteClientNoteHandler");
    const res = await trainersMeDeleteClientNoteHandler.handle(
      del("client-1", "n-1"),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual({ deleted: true });
    expect(deleteClientNoteOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      noteId: "n-1",
    });
  });
});
