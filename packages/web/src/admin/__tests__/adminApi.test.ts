import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, adminApi, adminFetch, formatMinor } from "../adminApi";
import { loadSession, saveSession, sessionFromTokens } from "../adminAuth";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}
const farFuture = Math.floor(Date.now() / 1000) + 3600;

describe("adminFetch", () => {
  afterEach(() => saveSession(null));

  it("rejects as 401 when there is no session, without calling the network", async () => {
    const fetchMock = vi.fn();
    await expect(
      adminFetch("/admin/summary", {}, fetchMock),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the bearer token and unwraps JSON", async () => {
    saveSession(
      sessionFromTokens(
        jwt({ exp: farFuture, app_metadata: { admin: true } }),
        "rt",
      ),
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 }),
    );
    const res = await adminFetch<{ data: { ok: number } }>(
      "/admin/summary",
      {},
      fetchMock as unknown as typeof fetch,
    );
    expect(res.data.ok).toBe(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).Authorization).toMatch(
      /^Bearer /,
    );
  });

  it("surfaces the server message on 403 and keeps the session", async () => {
    saveSession(sessionFromTokens(jwt({ exp: farFuture }), "rt"));
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
    );
    const err = (await adminFetch(
      "/admin/summary",
      {},
      fetchMock as unknown as typeof fetch,
    ).catch((e: unknown) => e)) as AdminApiError;
    expect(err).toBeInstanceOf(AdminApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe("Forbidden");
    expect(loadSession()).not.toBeNull();
  });

  it("clears the session on 401", async () => {
    saveSession(sessionFromTokens(jwt({ exp: farFuture }), "rt"));
    const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
    await expect(
      adminFetch("/admin/summary", {}, fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 401 });
    expect(loadSession()).toBeNull();
  });

  it("formats pence as GBP", () => {
    expect(formatMinor(3000)).toBe("£30.00");
    expect(formatMinor(9900)).toBe("£99.00");
  });

  it("posts an audited grant extension", async () => {
    saveSession(
      sessionFromTokens(
        jwt({ exp: farFuture, app_metadata: { admin: true } }),
        "rt",
      ),
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { id: "g1", months: 9, expiresAt: null } }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      adminApi.extendGrant("g1", 3, "family grant"),
    ).resolves.toEqual({
      id: "g1",
      months: 9,
      expiresAt: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/admin/founding-grants/g1/extend"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ additionalMonths: 3, reason: "family grant" }),
      }),
    );
    vi.unstubAllGlobals();
  });
});
