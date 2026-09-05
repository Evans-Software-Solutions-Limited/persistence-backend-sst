import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  adminApi,
  adminFetch,
  formatDate,
  formatDay,
  formatMinor,
} from "../adminApi";
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

  describe("formatDay", () => {
    // In the test body an assertion failure would skip it, leaving `TZ` set
    // for every later test in the worker — one real regression turning into a
    // spray of unrelated date failures.
    afterEach(() => vi.unstubAllEnvs());

    /**
     * Every date the marketing admin shows — plan start and end, offer
     * expiry, a metric's date, the attribution window — comes from a DATE
     * column as `YYYY-MM-DD`. Read as an instant it is midnight UTC, so it
     * lands on the PREVIOUS day for any viewer west of Greenwich, which is
     * how a campaign ending on the 12th came to be shown ending on the 13th.
     */
    /** The same day rendered locally — ICU spells the month, we don't. */
    const localDay = (y: number, m: number, d: number) =>
      new Date(y, m - 1, d).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

    it("keeps a plain day on its own date, whatever the viewer's zone", () => {
      for (const tz of ["UTC", "Pacific/Auckland", "America/Los_Angeles"]) {
        vi.stubEnv("TZ", tz);
        expect(formatDay("2026-09-12")).toBe(localDay(2026, 9, 12));
        expect(formatDay("2026-01-01")).toBe(localDay(2026, 1, 1));
      }
    });

    it("does not slip a day west of Greenwich, where formatDate does", () => {
      vi.stubEnv("TZ", "America/Los_Angeles");
      // The bug this exists to stop: midnight UTC is the previous evening in
      // Los Angeles, so the instant formatter reports the 11th.
      expect(formatDate("2026-09-12")).toBe(localDay(2026, 9, 11));
      expect(formatDay("2026-09-12")).toBe(localDay(2026, 9, 12));
    });

    it("shows an em dash for a missing day, as the date formatter does", () => {
      expect(formatDay(null)).toBe("—");
      expect(formatDay(undefined)).toBe("—");
      expect(formatDay("")).toBe("—");
    });

    it("falls back to the instant formatter for anything not a plain day", () => {
      // Timestamps still reach this from older payloads; they should format,
      // not render as a dash.
      expect(formatDay("2026-09-12T10:00:00.000Z")).toBe(
        formatDate("2026-09-12T10:00:00.000Z"),
      );
      expect(formatDay("not a date")).toBe("—");
    });
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
