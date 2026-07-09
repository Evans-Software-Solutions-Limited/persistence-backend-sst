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

const updateClientNoteOnBehalf = vi.fn();
vi.mock("../updateClientNote", () => ({
  updateClientNoteOnBehalf: (...args: unknown[]) =>
    updateClientNoteOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function put(clientId: string, noteId: string, body: unknown, headers = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/notes/${noteId}`,
    { method: "PUT", headers, body: JSON.stringify(body) },
  );
}

describe("trainersMeUpdateClientNoteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateClientNoteOnBehalf.mockResolvedValue({
      ok: true,
      note: { id: "n-1", content: "edited" },
    });
  });

  it("requires auth", async () => {
    const { trainersMeUpdateClientNoteHandler } =
      await import("../trainersMeUpdateClientNoteHandler");
    const res = await trainersMeUpdateClientNoteHandler.handle(
      put("client-1", "n-1", { content: "edited" }, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict to its status/body", async () => {
    updateClientNoteOnBehalf.mockResolvedValue({
      ok: false,
      status: 400,
      body: { code: "no_fields", message: "x" },
    });
    const { trainersMeUpdateClientNoteHandler } =
      await import("../trainersMeUpdateClientNoteHandler");
    const res = await trainersMeUpdateClientNoteHandler.handle(
      put("client-1", "n-1", {}),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("no_fields");
  });

  it("maps a 404 (note not found) verdict", async () => {
    updateClientNoteOnBehalf.mockResolvedValue({
      ok: false,
      status: 404,
      body: { code: "note_not_found", message: "x" },
    });
    const { trainersMeUpdateClientNoteHandler } =
      await import("../trainersMeUpdateClientNoteHandler");
    const res = await trainersMeUpdateClientNoteHandler.handle(
      put("client-1", "n-1", { content: "edited" }),
    );
    expect(res.status).toBe(404);
  });

  it("200s and delegates to the shared core with params + body threaded through", async () => {
    const { trainersMeUpdateClientNoteHandler } =
      await import("../trainersMeUpdateClientNoteHandler");
    const res = await trainersMeUpdateClientNoteHandler.handle(
      put("client-1", "n-1", { content: "edited", noteType: "progress" }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.id).toBe("n-1");
    expect(updateClientNoteOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      noteId: "n-1",
      body: expect.objectContaining({
        content: "edited",
        noteType: "progress",
      }),
    });
  });
});
