import { SSTApiAdapter } from "../sst-api.adapter";
import type { Signed, Registration } from "@/domain/models/togetherIdentity";
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: "http://test.local" } } },
}));
const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const publicKey = `-----BEGIN PUBLIC KEY-----\n${"A".repeat(59)}=\n-----END PUBLIC KEY-----\n`;
const proof: Signed<Registration> = {
  payload: {
    kind: "together-register-v1",
    userId,
    deviceId,
    publicKey,
    requestId,
    timestamp: 100,
  },
  signature: "a".repeat(86),
};
const credential = {
  payload: {
    kind: "together-device-v1",
    keyId: "v1",
    userId,
    deviceId,
    publicKey,
    issuedAt: 100,
    expiresAt: 200,
  },
  signature: "a".repeat(86),
};
const friendship = {
  payload: {
    kind: "together-friendship-v1",
    keyId: "v1",
    users: [userId, deviceId],
    issuedAt: 100,
    expiresAt: 200,
  },
  signature: "a".repeat(86),
};
const trust = { publicKeys: { v1: publicKey }, maxCredentialAgeMs: 86400000 };
const originalFetch = global.fetch;
let fetchMock: jest.Mock;
let adapter: SSTApiAdapter;
function respond(data: unknown, status = 200) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  adapter = new SSTApiAdapter();
  adapter.setTokenProvider(async () => "account-token");
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});
it.each([
  ["trust", "/trust", trust, undefined, undefined],
  ["register", "/devices", credential, proof, requestId],
  [
    "friendship",
    "/friendship-proof",
    friendship,
    { friendId: deviceId },
    requestId,
  ],
] as const)(
  "routes %s through authenticated fetch",
  async (method, path, value, body, key) => {
    respond({ data: value });
    const result =
      method === "trust"
        ? await adapter.togetherOffline.trust()
        : method === "register"
          ? await adapter.togetherOffline.register(proof)
          : await adapter.togetherOffline.friendship(deviceId, requestId);
    expect(result).toEqual({ ok: true, value });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://test.local/together/offline${path}`,
      expect.objectContaining({
        method: body ? "POST" : "GET",
        body: body ? JSON.stringify(body) : undefined,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer account-token",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
      }),
    );
  },
);
it.each([401, 403, 404, 409, 429, 500, 503])(
  "preserves status %s",
  async (status) => {
    respond({ error: "refused" }, status);
    expect(await adapter.togetherOffline.trust()).toMatchObject({
      ok: false,
      error: { status },
    });
  },
);
it.each([
  null,
  {},
  { data: null },
  { data: {} },
  { data: { ...trust, publicKeys: {} } },
  { data: { ...trust, publicKeys: [] } },
  { data: { ...trust, publicKeys: { v1: "bad" } } },
  { data: { ...trust, maxCredentialAgeMs: 86400001 } },
  { data: trust, unexpected: true },
])("rejects malformed trust without offline fallback: %j", async (body) => {
  respond(body);
  expect(await adapter.togetherOffline.trust()).toMatchObject({
    ok: false,
    error: { code: "server" },
  });
});
it("rejects invalid JSON without network fallback", async () => {
  fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
  expect(await adapter.togetherOffline.trust()).toMatchObject({
    ok: false,
    error: { code: "server", status: 200 },
  });
});
it("rejects empty HTTP response", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  expect(await adapter.togetherOffline.trust()).toMatchObject({
    ok: false,
    error: { code: "server" },
  });
});
it.each([
  null,
  {},
  { ...credential, signature: "bad" },
  { ...credential, payload: { ...credential.payload, deviceId: "bad" } },
])("rejects malformed credentials: %j", async (data) => {
  respond({ data });
  expect(await adapter.togetherOffline.register(proof)).toMatchObject({
    ok: false,
    error: { code: "server" },
  });
});
it.each([
  null,
  {},
  { ...friendship, payload: { ...friendship.payload, users: [userId] } },
  { ...friendship, payload: { ...friendship.payload, expiresAt: "200" } },
  { ...friendship, payload: { ...friendship.payload, kind: "unknown" } },
])("rejects malformed friendship: %j", async (data) => {
  respond({ data });
  expect(
    await adapter.togetherOffline.friendship(deviceId, requestId),
  ).toMatchObject({ ok: false, error: { code: "server" } });
});
it("preserves transport failure", async () => {
  fetchMock.mockRejectedValue(new TypeError("Network request failed"));
  expect(await adapter.togetherOffline.trust()).toMatchObject({
    ok: false,
    error: { code: "network" },
  });
});
it("bounds hanging token lookup", async () => {
  jest.useFakeTimers();
  adapter.setTokenProvider(() => new Promise(() => {}));
  const pending = adapter.togetherOffline.trust();
  await jest.advanceTimersByTimeAsync(10001);
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "timeout" },
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("aborts hanging fetch at ten seconds", async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        const check = () => {
          if (options.signal.aborted) {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          } else setTimeout(check, 100);
        };
        check();
      }),
  );
  const pending = adapter.togetherOffline.trust();
  await jest.advanceTimersByTimeAsync(10100);
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "timeout" },
  });
});
it.each([
  "FORBIDDEN",
  "FRIENDSHIP_NOT_ACCEPTED",
  "PAID_REQUIRED",
  "DEVICE_REVOKED",
])("preserves Together authorization reason %s", async (togetherCode) => {
  respond({ error: { code: togetherCode, message: "refused" } }, 403);
  expect(
    await adapter.togetherOffline.friendship(deviceId, requestId),
  ).toMatchObject({ ok: false, error: { status: 403, togetherCode } });
});
it.each(["bad code", "A".repeat(65), 12, null])(
  "ignores malformed authorization reason %j",
  async (code) => {
    respond({ error: { code, message: "refused" } }, 403);
    const result = await adapter.togetherOffline.trust();
    expect(result).toMatchObject({ ok: false, error: { status: 403 } });
    if (!result.ok) expect(result.error).not.toHaveProperty("togetherCode");
  },
);
it("does not expose Together-specific errors on unrelated endpoints", async () => {
  respond({ error: { code: "FORBIDDEN", message: "refused" } }, 403);
  const result = await adapter.getProfile();
  expect(result).toMatchObject({ ok: false, error: { status: 403 } });
  if (!result.ok) expect(result.error).not.toHaveProperty("togetherCode");
});

it.each(["network", "timeout"])(
  "preserves %s while reading a response body",
  async (code) => {
    const error =
      code === "network"
        ? new TypeError("Connection lost")
        : Object.assign(new Error("aborted"), { name: "AbortError" });
    const response = new Response("{}", { status: 200 });
    jest.spyOn(response, "json").mockRejectedValue(error);
    fetchMock.mockResolvedValue(response);
    expect(await adapter.togetherOffline.trust()).toMatchObject({
      ok: false,
      error: { code },
    });
  },
);
