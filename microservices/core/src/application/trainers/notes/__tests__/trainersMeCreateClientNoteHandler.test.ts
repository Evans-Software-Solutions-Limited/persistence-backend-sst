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

const createClientNoteOnBehalf = vi.fn();
vi.mock("../createClientNote", () => ({
  createClientNoteOnBehalf: (...args: unknown[]) =>
    createClientNoteOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function post(clientId: string, body: unknown, headers = auth) {
  return new Request(`http://localhost/trainers/me/clients/${clientId}/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("trainersMeCreateClientNoteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientNoteOnBehalf.mockResolvedValue({
      ok: true,
      note: { id: "n-1", content: "Great session today" },
    });
  });

  it("requires auth", async () => {
    const { trainersMeCreateClientNoteHandler } =
      await import("../trainersMeCreateClientNoteHandler");
    const res = await trainersMeCreateClientNoteHandler.handle(
      post("client-1", { content: "x" }, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict to its status/body", async () => {
    createClientNoteOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const { trainersMeCreateClientNoteHandler } =
      await import("../trainersMeCreateClientNoteHandler");
    const res = await trainersMeCreateClientNoteHandler.handle(
      post("client-1", { content: "x" }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
  });

  it("201s and delegates to the shared core with params + body threaded through", async () => {
    const { trainersMeCreateClientNoteHandler } =
      await import("../trainersMeCreateClientNoteHandler");
    const res = await trainersMeCreateClientNoteHandler.handle(
      post("client-1", {
        content: "Great session today",
        noteType: "progress",
      }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).data.id).toBe("n-1");
    expect(createClientNoteOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      body: expect.objectContaining({
        content: "Great session today",
        noteType: "progress",
      }),
    });
  });
});
