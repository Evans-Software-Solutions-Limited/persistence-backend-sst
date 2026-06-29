import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendExpoPushMessages,
  getExpoAccessToken,
  EXPO_PUSH_BATCH_SIZE,
  type ExpoPushMessage,
} from "../expoPushClient";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Bad Request",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function msg(to: string): ExpoPushMessage {
  return { to, title: "T", body: "B" };
}

describe("getExpoAccessToken", () => {
  const original = process.env.EXPO_ACCESS_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_ACCESS_TOKEN;
    else process.env.EXPO_ACCESS_TOKEN = original;
  });

  it("returns the token when set", () => {
    process.env.EXPO_ACCESS_TOKEN = "secret-token";
    expect(getExpoAccessToken()).toBe("secret-token");
  });

  it("returns undefined when unset", () => {
    delete process.env.EXPO_ACCESS_TOKEN;
    expect(getExpoAccessToken()).toBeUndefined();
  });

  it("treats an empty string as unset", () => {
    process.env.EXPO_ACCESS_TOKEN = "";
    expect(getExpoAccessToken()).toBeUndefined();
  });
});

describe("sendExpoPushMessages", () => {
  const original = process.env.EXPO_ACCESS_TOKEN;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete process.env.EXPO_ACCESS_TOKEN;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (original === undefined) delete process.env.EXPO_ACCESS_TOKEN;
    else process.env.EXPO_ACCESS_TOKEN = original;
  });

  it("returns [] without a network call for empty input", async () => {
    const tickets = await sendExpoPushMessages([]);
    expect(tickets).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the Expo endpoint and maps ok + error tickets", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { status: "ok", id: "ticket-1" },
          {
            status: "error",
            message: "not registered",
            details: { error: "DeviceNotRegistered" },
          },
        ],
      }),
    );

    const tickets = await sendExpoPushMessages([msg("tok-a"), msg("tok-b")]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(EXPO_PUSH_URL);
    expect(init.method).toBe("POST");
    expect(tickets).toEqual([
      { status: "ok", id: "ticket-1" },
      {
        status: "error",
        message: "not registered",
        details: { error: "DeviceNotRegistered" },
      },
    ]);
  });

  it("omits the Authorization header when no access token is set", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ status: "ok" }] }));
    await sendExpoPushMessages([msg("tok-a")]);
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("includes a Bearer Authorization header when the access token is set", async () => {
    process.env.EXPO_ACCESS_TOKEN = "secret-token";
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ status: "ok" }] }));
    await sendExpoPushMessages([msg("tok-a")]);
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer secret-token");
  });

  it("batches >100 messages and concatenates tickets in order", async () => {
    const total = EXPO_PUSH_BATCH_SIZE + 5; // 105 → 2 chunks
    const messages = Array.from({ length: total }, (_, i) => msg(`tok-${i}`));

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: Array.from({ length: EXPO_PUSH_BATCH_SIZE }, (_, i) => ({
            status: "ok",
            id: `c1-${i}`,
          })),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: Array.from({ length: 5 }, (_, i) => ({
            status: "ok",
            id: `c2-${i}`,
          })),
        }),
      );

    const tickets = await sendExpoPushMessages(messages);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tickets).toHaveLength(total);
    expect(tickets[0].id).toBe("c1-0");
    expect(tickets[EXPO_PUSH_BATCH_SIZE].id).toBe("c2-0");
  });

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: ["bad"] }, false, 400),
    );
    await expect(sendExpoPushMessages([msg("tok-a")])).rejects.toThrow(
      /Expo Push send failed: 400/,
    );
  });

  it("coerces a malformed ticket entry into an error ticket", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [null, "garbage"] }));
    const tickets = await sendExpoPushMessages([msg("a"), msg("b")]);
    expect(tickets).toHaveLength(2);
    expect(tickets[0].status).toBe("error");
    expect(tickets[1].status).toBe("error");
  });

  it("tolerates a non-array data field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: undefined }));
    const tickets = await sendExpoPushMessages([msg("a")]);
    expect(tickets).toEqual([]);
  });
});
