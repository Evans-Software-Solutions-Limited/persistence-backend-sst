/**
 * SST adapter — the coach's view of a client's progress photos (PER-138).
 * The 403 codes must survive: the tab shows a different state for each.
 */

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: "http://test.local" } } },
}));

// eslint-disable-next-line import/first
import { SSTApiAdapter } from "@/adapters/api/sst-api.adapter";

type FetchImpl = (input: any, init?: any) => Promise<Response>;

const globalScope = globalThis as unknown as { fetch: FetchImpl };
const originalFetch = globalScope.fetch;

afterEach(() => {
  globalScope.fetch = originalFetch;
});

function jsonOnce(body: unknown, status = 200): jest.Mock {
  const mock = jest.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  globalScope.fetch = mock as unknown as FetchImpl;
  return mock;
}

const SET = {
  id: "set-1",
  takenOn: "2026-10-26",
  source: "self",
  status: "ready",
  createdAt: "2026-10-26T08:00:00.000Z",
  updatedAt: "2026-10-26T08:00:00.000Z",
  photos: [],
  weight: null,
  bodyFat: null,
};

describe("SSTApiAdapter — coach client photos", () => {
  it("GETs the client's photos and unwraps the envelope", async () => {
    const fetchMock = jsonOnce({
      data: { sets: [SET], asOf: "2026-11-27T10:00:00.000Z" },
    });
    const result = await new SSTApiAdapter().getCoachClientProgressPhotos(
      "client/1",
    );
    expect(result.ok && result.value).toEqual({
      sets: [SET],
      asOf: "2026-11-27T10:00:00.000Z",
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://test.local/trainers/me/clients/client%2F1/progress-photos",
    );
  });

  it.each([
    ["photos_off", "photos_off"],
    ["photo_sharing_not_granted", "not_shared"],
    ["not_your_client", "ended"],
    ["account_deleted", "ended"],
  ])("a 403 %s carries denial %s", async (code, denial) => {
    jsonOnce({ code, message: "No" }, 403);
    const result = await new SSTApiAdapter().getCoachClientProgressPhotos("c");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.denial).toBe(denial);
      expect(result.error.status).toBe(403);
      expect(result.error.message).toBe("No");
    }
  });

  it("other failures carry no denial", async () => {
    jsonOnce({ code: "not_a_trainer", message: "No" }, 403);
    const forbidden = await new SSTApiAdapter().getCoachClientProgressPhotos(
      "c",
    );
    expect(!forbidden.ok && forbidden.error.denial).toBeUndefined();

    jsonOnce({ error: "boom" }, 500);
    const server = await new SSTApiAdapter().getCoachClientProgressPhotos("c");
    expect(!server.ok && server.error).toMatchObject({
      code: "server",
      status: 500,
    });

    jsonOnce({ nothing: true }, 200);
    const odd = await new SSTApiAdapter().getCoachClientProgressPhotos("c");
    expect(odd.ok).toBe(false);

    globalScope.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as unknown as FetchImpl;
    const offline = await new SSTApiAdapter().getCoachClientProgressPhotos("c");
    expect(!offline.ok && offline.error.code).toBe("network");
  });
});
