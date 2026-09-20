import { foundingApi } from "../api";
import { accountSession, signOut } from "../auth";
vi.mock("../auth", () => ({ accountSession: vi.fn(), signOut: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_CORE_API_URL", "https://core.example.com/");
  vi.mocked(accountSession).mockResolvedValue({
    accessToken: "account-token",
    refreshToken: "r",
    expiresAt: 9999999999,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("uses the verified destination bearer and purchase email", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: { challengeId: "proof" } })),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await foundingApi.request("purchase@example.com", "apple-user"),
  ).toEqual({ challengeId: "proof" });
  expect(accountSession).toHaveBeenCalledWith("apple-user");
  expect(fetcher).toHaveBeenCalledWith(
    "https://core.example.com/founding/claims/request",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer account-token",
      }),
      body: JSON.stringify({ email: "purchase@example.com" }),
    }),
  );
});
it("keeps a response-loss retry on the same proof without creating a new claim", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            claimed: true,
            tierName: "premium_plus",
            expiresAt: "2027-03-20",
          },
        }),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    foundingApi.verify("proof", "123456", "apple-user"),
  ).rejects.toThrow("network");
  expect(
    await foundingApi.verify("proof", "123456", "apple-user"),
  ).toMatchObject({ claimed: true });
  expect(fetcher.mock.calls[0]![1].body).toBe(fetcher.mock.calls[1]![1].body);
});
it("does not issue a claim after an account switch", async () => {
  vi.mocked(accountSession).mockRejectedValue(new Error("Account changed"));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    foundingApi.verify("proof", "123456", "apple-user"),
  ).rejects.toThrow("changed");
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 429, 503])(
  "handles status %s without false success",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Try again" }), { status }),
      ),
    );
    await expect(
      foundingApi.request("email@example.com", "apple-user"),
    ).rejects.toThrow(status === 401 ? "sign-in expired" : "Try again");
    expect(signOut).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);
it("rejects malformed success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  await expect(
    foundingApi.request("email@example.com", "apple-user"),
  ).rejects.toThrow("could not be confirmed");
});
it("handles unavailable config and malformed provider body", async () => {
  vi.stubEnv("VITE_CORE_API_URL", "");
  await expect(
    foundingApi.request("email@example.com", "user"),
  ).rejects.toThrow("unavailable");
  vi.stubEnv("VITE_CORE_API_URL", "https://core.example.com");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("bad gateway", { status: 502 })),
  );
  await expect(
    foundingApi.request("email@example.com", "user"),
  ).rejects.toThrow("could not be confirmed");
});
