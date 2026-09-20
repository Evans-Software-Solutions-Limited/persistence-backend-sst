import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  adminApi,
  adminFetch,
  formatDate,
  formatDay,
  todayIsoDay,
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

  describe("todayIsoDay", () => {
    afterEach(() => vi.unstubAllEnvs());

    /**
     * The counterpart trap to `formatDay`'s. A date input prefilled from
     * `new Date().toISOString().slice(0, 10)` carries the UTC day, so it reads
     * yesterday in Tokyo and tomorrow in Los Angeles. Marketing metric rows
     * are upserted BY DAY, so that default silently files a day's spend under
     * its neighbour.
     */
    it("reports the local day either side of the UTC boundary", () => {
      // Already the 12th in Tokyo, still the 11th in Los Angeles, and the 11th
      // in UTC — so Tokyo is the case that catches an ISO-string default.
      const at = new Date("2026-09-11T23:00:00Z");
      expect(at.toISOString().slice(0, 10)).toBe("2026-09-11");

      vi.stubEnv("TZ", "Asia/Tokyo");
      expect(todayIsoDay(at)).toBe("2026-09-12");

      vi.stubEnv("TZ", "America/Los_Angeles");
      expect(todayIsoDay(at)).toBe("2026-09-11");
    });

    it("zero-pads month and day so the value parses as a date input", () => {
      vi.stubEnv("TZ", "UTC");
      expect(todayIsoDay(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
    });

    it("round-trips through formatDay", () => {
      vi.stubEnv("TZ", "America/Los_Angeles");
      const at = new Date("2026-09-11T23:00:00Z");
      expect(formatDay(todayIsoDay(at))).toBe(
        new Date(2026, 8, 11).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      );
    });
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

  it("posts tier changes and refund reasons, and reads the authoritative refund amount", async () => {
    saveSession(sessionFromTokens(jwt({ exp: farFuture }), "rt"));
    const response = {
      status: "pending",
      refundId: "re_1",
      reason: "Customer request",
    };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: response })),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await adminApi.changeGrantTier("g1", "premium_plus", "Goodwill upgrade");
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("/admin/founding-grants/g1/change-tier"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            tierName: "premium_plus",
            reason: "Goodwill upgrade",
          }),
        }),
      );
      await expect(
        adminApi.refundGrant("g1", "Customer request"),
      ).resolves.toEqual(response);
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("/admin/founding-grants/g1/refund"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "Customer request" }),
        }),
      );
      await adminApi.grantRefund("g1");
      const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toContain("/admin/founding-grants/g1/refund");
      expect(init.method).toBeUndefined();
      expect(init.body).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
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

describe("admin grant and referral request contracts", () => {
  afterEach(() => {
    saveSession(null);
    vi.unstubAllGlobals();
  });
  const grant = {
    email: "buyer@example.com",
    tierName: "premium" as const,
    grantKind: "founding" as const,
    months: 6,
    contributionAmountMinor: 3000,
    contributionCurrency: "GBP",
    contributionMethod: "bank_transfer" as const,
    contributionReference: "BANK-1",
  };
  const code = { code: "TEAM", label: "Team", kind: "campaign" as const };
  const cases: Array<
    [string, () => Promise<unknown>, string, string | undefined, unknown?]
  > = [
    ["summary", () => adminApi.summary(), "/admin/summary", undefined],
    [
      "catalogue",
      () => adminApi.catalogue(),
      "/admin/founding-grants/catalogue",
      undefined,
    ],
    [
      "email lookup encoding",
      () => adminApi.lookupUser("buyer+apple@example.com"),
      "/admin/users?email=buyer%2Bapple%40example.com",
      undefined,
    ],
    [
      "all grants",
      () => adminApi.grants(),
      "/admin/founding-grants",
      undefined,
    ],
    [
      "live grants",
      () => adminApi.grants(false),
      "/admin/founding-grants?revoked=false",
      undefined,
    ],
    [
      "create grant",
      () => adminApi.createGrant(grant),
      "/admin/founding-grants",
      "POST",
      grant,
    ],
    [
      "revoke with audit reason",
      () => adminApi.revokeGrant("grant", "Customer request"),
      "/admin/founding-grants/grant/revoke",
      "POST",
      { reason: "Customer request" },
    ],
    [
      "resend invite",
      () => adminApi.resendInvite("grant"),
      "/admin/founding-grants/grant/resend-invite",
      "POST",
    ],
    [
      "all referral codes",
      () => adminApi.codes(),
      "/admin/referral-codes",
      undefined,
    ],
    [
      "filtered referral codes",
      () => adminApi.codes("team +", "active"),
      "/admin/referral-codes?q=team+%2B&status=active",
      undefined,
    ],
    [
      "create referral code",
      () => adminApi.createCode(code),
      "/admin/referral-codes",
      "POST",
      code,
    ],
    [
      "update referral code",
      () =>
        adminApi.updateCode("code", { status: "paused", label: "Paused team" }),
      "/admin/referral-codes/code",
      "PATCH",
      { status: "paused", label: "Paused team" },
    ],
    [
      "redemptions",
      () => adminApi.redemptions("code"),
      "/admin/referral-codes/code/redemptions",
      undefined,
    ],
    [
      "attribution audit",
      () => adminApi.setAttribution("user", "TEAM", "Verified referral"),
      "/admin/referral-attributions",
      "POST",
      { userId: "user", code: "TEAM", reason: "Verified referral" },
    ],
    [
      "all audit entries",
      () => adminApi.audit(),
      "/admin/audit-log",
      undefined,
    ],
    [
      "filtered audit entries",
      () => adminApi.audit("founding grant", "id/1"),
      "/admin/audit-log?entityType=founding+grant&entityId=id%2F1",
      undefined,
    ],
  ];
  it.each(cases)(
    "sends %s with the authenticated endpoint and intended payload",
    async (_label, request, path, method, body) => {
      saveSession(
        sessionFromTokens(
          jwt({ exp: farFuture, app_metadata: { admin: true } }),
          "refresh",
        ),
      );
      const fetcher = vi.fn(
        async () => new Response(JSON.stringify({ data: { accepted: true } })),
      );
      vi.stubGlobal("fetch", fetcher);
      await request();
      const [url, init] = fetcher.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url.endsWith(path)).toBe(true);
      expect(init.method).toBe(method);
      expect(init.headers).toMatchObject({
        Authorization: expect.stringMatching(/^Bearer /),
      });
      expect(init.body).toBe(
        body === undefined ? undefined : JSON.stringify(body),
      );
    },
  );
  it("reports a non-JSON gateway error without exposing HTML", async () => {
    saveSession(sessionFromTokens(jwt({ exp: farFuture }), "refresh"));
    const fetcher = vi.fn(
      async () =>
        new Response("<html>upstream internal error</html>", { status: 502 }),
    );
    await expect(
      adminFetch("/admin/summary", {}, fetcher),
    ).rejects.toMatchObject({ message: "Request failed (502)", body: null });
  });
});
