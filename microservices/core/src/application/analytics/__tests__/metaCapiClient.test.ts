import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

let envMap: Record<string, string> = {};

vi.mock("@persistence/api-utils/env", () => ({
  getEnvOrDefault: vi.fn((name: string, def: string) => envMap[name] ?? def),
}));

import {
  buildUserData,
  hashEmail,
  hashExternalId,
  isMetaCapiConfigured,
  sendConversionEvents,
  type MetaServerEvent,
} from "../metaCapiClient";

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

const sampleEvent: MetaServerEvent = {
  event_name: "Purchase",
  event_time: 1_000,
  event_id: "e1",
  action_source: "app",
  user_data: { em: [sha256("a@b.com")] },
  custom_data: { value: 9.99, currency: "GBP" },
};

describe("config", () => {
  beforeEach(() => {
    envMap = {};
  });

  it("is unconfigured when dataset id or token is missing", () => {
    expect(isMetaCapiConfigured()).toBe(false);
    envMap = { META_DATASET_ID: "ds" };
    expect(isMetaCapiConfigured()).toBe(false);
    envMap = { META_CAPI_ACCESS_TOKEN: "tok" };
    expect(isMetaCapiConfigured()).toBe(false);
  });

  it("is configured when both are present", () => {
    envMap = { META_DATASET_ID: "ds", META_CAPI_ACCESS_TOKEN: "tok" };
    expect(isMetaCapiConfigured()).toBe(true);
  });
});

describe("hashing", () => {
  it("SHA-256s normalized email + external id", () => {
    expect(hashEmail("  Person@Example.COM ")).toBe(
      sha256("person@example.com"),
    );
    expect(hashExternalId("User-1")).toBe(sha256("user-1"));
  });

  it("buildUserData includes only present fields, hashed where required", () => {
    expect(
      buildUserData({ email: "a@b.com", userId: "u1", fbc: "c", fbp: "p" }),
    ).toEqual({
      em: [sha256("a@b.com")],
      external_id: [sha256("u1")],
      fbc: "c",
      fbp: "p",
    });
    expect(buildUserData({ email: null, userId: null })).toEqual({});
  });
});

describe("sendConversionEvents", () => {
  beforeEach(() => {
    envMap = { META_DATASET_ID: "ds", META_CAPI_ACCESS_TOKEN: "tok" };
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(impl: () => Promise<Response> | Response) {
    const fetchMock = vi.fn<
      (...args: unknown[]) => Promise<Response> | Response
    >(() => impl());
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("no-ops (returns false, no fetch) for an empty batch", async () => {
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    expect(await sendConversionEvents([])).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when unconfigured", async () => {
    envMap = {};
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    expect(await sendConversionEvents([sampleEvent])).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the batch with the token in the BODY (not the URL)", async () => {
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    envMap = {
      META_DATASET_ID: "ds",
      META_CAPI_ACCESS_TOKEN: "tok",
      META_TEST_EVENT_CODE: "TEST123",
    };
    expect(await sendConversionEvents([sampleEvent])).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/ds/events");
    expect(url).not.toContain("tok");
    const body = JSON.parse(init.body as string);
    expect(body.access_token).toBe("tok");
    expect(body.test_event_code).toBe("TEST123");
    expect(body.data).toHaveLength(1);
  });

  it("omits test_event_code when unset", async () => {
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    await sendConversionEvents([sampleEvent]);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("test_event_code");
  });

  it("throws on a non-2xx WITHOUT echoing the response body", async () => {
    stubFetch(
      () =>
        new Response("a@b.com leaked hash", {
          status: 400,
          statusText: "Bad Request",
        }),
    );
    await expect(sendConversionEvents([sampleEvent])).rejects.toThrow(
      /Meta CAPI send failed: 400 Bad Request/,
    );
    await expect(sendConversionEvents([sampleEvent])).rejects.not.toThrow(
      /a@b\.com/,
    );
  });
});
