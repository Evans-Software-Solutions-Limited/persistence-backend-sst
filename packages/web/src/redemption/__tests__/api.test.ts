import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { voucherApi } from "../api";
import { saveSession, loadSession } from "../auth";
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  saveSession({
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() / 1000 + 3600,
  });
  vi.stubEnv("VITE_CORE_API_URL", "https://api.example.com/");
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("sends account-bound authenticated requests to each voucher action", async () => {
  fetcher.mockImplementation(
    async () => new Response(JSON.stringify({ data: { challengeId: "c" } })),
  );
  await voucherApi.prepare("secret-code", "work@example.com");
  await voucherApi.verify("c", "123456");
  await voucherApi.redeem("c");
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    "https://api.example.com/vouchers/prepare",
    "https://api.example.com/vouchers/verify",
    "https://api.example.com/vouchers/redeem",
  ]);
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer access");
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
    challengeId: "c",
  });
});
it("clears customer session on 401 and handles API errors without false success", async () => {
  fetcher.mockResolvedValueOnce(new Response("{}", { status: 401 }));
  await expect(voucherApi.redeem("c")).rejects.toThrow("expired");
  expect(loadSession()).toBeNull();
  saveSession({
    accessToken: "a",
    refreshToken: "r",
    expiresAt: Date.now() / 1000 + 3600,
  });
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Already used" }), { status: 409 }),
  );
  await expect(voucherApi.redeem("c")).rejects.toThrow("Already used");
  fetcher.mockResolvedValueOnce(new Response("not json", { status: 500 }));
  await expect(voucherApi.redeem("c")).rejects.toThrow(
    "could not be completed",
  );
  fetcher.mockResolvedValueOnce(new Response("{}"));
  await expect(voucherApi.redeem("c")).rejects.toThrow("incomplete");
  vi.stubEnv("VITE_CORE_API_URL", "");
  await expect(voucherApi.redeem("c")).rejects.toThrow("not configured");
});
