import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

let envMap: Record<string, string> = {};

vi.mock("@persistence/api-utils/env", () => ({
  getEnvOrDefault: vi.fn((name: string, def: string) => envMap[name] ?? def),
}));

import {
  buildUserData,
  redactMetaDiagnostic,
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

  it("no-ops (sent: false, no fetch) for an empty batch", async () => {
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    expect(await sendConversionEvents([])).toEqual({
      sent: false,
      eventsReceived: null,
      messages: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when unconfigured", async () => {
    envMap = {};
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    expect((await sendConversionEvents([sampleEvent])).sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the batch with the token in the BODY (not the URL)", async () => {
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    envMap = {
      META_DATASET_ID: "ds",
      META_CAPI_ACCESS_TOKEN: "tok",
      META_TEST_EVENT_CODE: "TEST123",
    };
    expect((await sendConversionEvents([sampleEvent])).sent).toBe(true);
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

  it("throws on a non-2xx WITH the reason, but no identifier in it", async () => {
    // The body used to be discarded outright, which meant a failing batch had
    // no explanation anywhere. It is reported now — redacted, because Meta
    // echoes submitted values and `user_data` holds hashed identifiers.
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                "Invalid parameter for a@b.com " +
                "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 " +
                "fb.1.1757000000000.AbCdEf-123",
              code: 100,
              error_subcode: 2804003,
            },
          }),
          { status: 400, statusText: "Bad Request" },
        ),
    );
    const err = await sendConversionEvents([sampleEvent]).then(
      () => new Error("expected a throw"),
      (e: unknown) => e as Error,
    );
    expect(err.message).toMatch(/Meta CAPI send failed: 400 Bad Request/);
    // The diagnosis survives...
    expect(err.message).toMatch(/2804003/);
    // ...and nothing that identifies a person does.
    expect(err.message).not.toContain("a@b.com");
    expect(err.message).not.toContain("9f86d081");
    expect(err.message).not.toContain("AbCdEf-123");
  });

  it("reads Meta's own events_received back off a 2xx", async () => {
    // A 2xx is not proof of acceptance. Without this the drainer logged a green
    // summary while Meta silently kept nothing.
    stubFetch(
      () =>
        new Response(JSON.stringify({ events_received: 1, messages: [] }), {
          status: 200,
        }),
    );
    expect(await sendConversionEvents([sampleEvent])).toEqual({
      sent: true,
      eventsReceived: 1,
      messages: [],
    });
  });

  it("surfaces a 2xx that Meta kept NOTHING from", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            events_received: 0,
            messages: ["Missing event_source_url for a@b.com"],
          }),
          { status: 200 },
        ),
    );
    const result = await sendConversionEvents([sampleEvent]);
    expect(result.eventsReceived).toBe(0);
    expect(result.messages).toEqual(["Missing event_source_url for <email>"]);
  });

  it("tolerates a 2xx body that is not the shape we expect", async () => {
    stubFetch(() => new Response("not json at all", { status: 200 }));
    expect(await sendConversionEvents([sampleEvent])).toEqual({
      sent: true,
      eventsReceived: null,
      messages: [],
    });
  });
});

describe("redactMetaDiagnostic", () => {
  const HASH =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

  it("removes emails, hashes and click ids, and bounds the length", () => {
    expect(
      redactMetaDiagnostic(
        `em a@b.co hash ${HASH} click fb.1.1757000000000.AbC-1`,
      ),
    ).toBe("em <email> hash <hash> click <clickid>");
    expect(redactMetaDiagnostic("x".repeat(900))).toHaveLength(400);
  });

  it("still catches a hash with no word boundary around it", () => {
    // `\b` cannot anchor when a word character sits either side, so an anchored
    // pattern let `external_id_<hash>` through verbatim — and this guard is the
    // only thing between a hashed identifier and a log line.
    for (const input of [`external_id_${HASH}`, `${HASH}z`, `x${HASH}`]) {
      expect(redactMetaDiagnostic(input)).not.toContain("9f86d081");
    }
  });

  it("catches an upper-case click id and flattens control characters", () => {
    // `fbc` is free-form for 255 chars at the checkout body schema, so an echoed
    // one can carry a newline and split one log line into two.
    expect(redactMetaDiagnostic("FB.1.123.AbC")).toBe("<clickid>");
    expect(redactMetaDiagnostic("a\nb\tc")).toBe("a b c");
  });

  it("bounds a hostile body BEFORE the regexes run", () => {
    // The email pattern is quadratic on a long run of class characters that
    // never reaches an `@`. Unbounded, a 200KB body measured 17.6s — on the
    // throw path, so the batch would stall and re-burn the Lambda every tick.
    // `z`, not `a`: a long run of hex characters is legitimately redacted as a
    // hash, which would hide what this case is measuring. `z` is a word
    // character that no pattern here matches, so it exercises the email
    // pattern's backtracking and nothing else.
    const started = Date.now();
    expect(redactMetaDiagnostic("z".repeat(500_000))).toHaveLength(400);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
