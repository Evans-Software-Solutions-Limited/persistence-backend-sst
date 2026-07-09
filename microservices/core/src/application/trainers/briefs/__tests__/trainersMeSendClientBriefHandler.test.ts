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

const sendClientBriefOnBehalf = vi.fn();
vi.mock("../sendClientBrief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sendClientBrief")>();
  return {
    ...actual,
    sendClientBriefOnBehalf: (...args: unknown[]) =>
      sendClientBriefOnBehalf(...args),
  };
});

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function post(clientId: string, body: unknown, headers = auth) {
  return new Request(`http://localhost/trainers/me/clients/${clientId}/brief`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("trainersMeSendClientBriefHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendClientBriefOnBehalf.mockResolvedValue({
      ok: true,
      notification: { id: "notif-1", type: "coach_brief" },
    });
  });

  it("requires auth", async () => {
    const { trainersMeSendClientBriefHandler } =
      await import("../trainersMeSendClientBriefHandler");
    const res = await trainersMeSendClientBriefHandler.handle(
      post("client-1", { message: "hi" }, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict to its status/body", async () => {
    sendClientBriefOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const { trainersMeSendClientBriefHandler } =
      await import("../trainersMeSendClientBriefHandler");
    const res = await trainersMeSendClientBriefHandler.handle(
      post("client-1", { message: "hi" }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
  });

  it("201s and delegates to the shared core with the TRIMMED message", async () => {
    const { trainersMeSendClientBriefHandler } =
      await import("../trainersMeSendClientBriefHandler");
    const res = await trainersMeSendClientBriefHandler.handle(
      post("client-1", { message: "  New block starts Monday  " }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).data.id).toBe("notif-1");
    expect(sendClientBriefOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      message: "New block starts Monday",
    });
  });

  it("422s a whitespace-only message without touching the core", async () => {
    const { trainersMeSendClientBriefHandler } =
      await import("../trainersMeSendClientBriefHandler");
    const res = await trainersMeSendClientBriefHandler.handle(
      post("client-1", { message: "   " }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe("invalid_message");
    expect(sendClientBriefOnBehalf).not.toHaveBeenCalled();
  });

  it("422s a message over the 500-char cap via schema validation", async () => {
    const { trainersMeSendClientBriefHandler } =
      await import("../trainersMeSendClientBriefHandler");
    const res = await trainersMeSendClientBriefHandler.handle(
      post("client-1", { message: "x".repeat(501) }),
    );
    expect(res.status).toBe(422);
    expect(sendClientBriefOnBehalf).not.toHaveBeenCalled();
  });

  it("422s a missing message via schema validation", async () => {
    const { trainersMeSendClientBriefHandler } =
      await import("../trainersMeSendClientBriefHandler");
    const res = await trainersMeSendClientBriefHandler.handle(
      post("client-1", {}),
    );
    expect(res.status).toBe(422);
    expect(sendClientBriefOnBehalf).not.toHaveBeenCalled();
  });
});
