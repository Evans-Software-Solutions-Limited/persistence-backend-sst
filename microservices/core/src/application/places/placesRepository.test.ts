import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { encodeCursor, decodeCursor } from "../social/pagination";
beforeAll(() =>
  vi.stubEnv("TOGETHER_TOKEN_SECRET", "places-test-secret-32-characters-long"),
);
afterAll(() => vi.unstubAllEnvs());
import { PlacesRepository } from "./placesRepository";
const feature = {
  properties: {
    place_id: "venue1",
    formatted: "Gym, London",
    lat: 51.5,
    lon: -0.1,
  },
};
const response = (features: unknown[]) =>
  new Response(JSON.stringify({ features }));
describe("Geoapify server adapter", () => {
  it("manual search and ephemeral nearby coordinates map only provider centroid metadata", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([feature]));
    const repo = new PlacesRepository("secret", fetcher);
    expect((await repo.find("actor", { q: " Gym " })).data).toEqual([
      {
        placeId: "geoapify:venue1",
        label: "Gym, London",
        center: { latitude: 51.5, longitude: -0.1 },
      },
    ]);
    const search = new URL(String(fetcher.mock.calls[0][0]));
    expect(search.pathname).toBe("/v1/geocode/search");
    expect(search.searchParams.get("text")).toBe("Gym");
    fetcher.mockResolvedValue(response([feature]));
    await repo.find("actor", { latitude: 51.5, longitude: -0.1 });
    const near = new URL(String(fetcher.mock.calls[1][0]));
    expect(near.pathname).toBe("/v2/places");
    expect(near.searchParams.get("filter")).toBe("circle:-0.1,51.5,5000");
  });
  it("query and actor bound pagination validates offsets, expiry and malformed cursors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response([feature, feature]));
    const repo = new PlacesRepository("secret", fetcher);
    const first = await repo.find("actor", { q: "Gym", limit: 1 });
    expect(first.nextCursor).toBeTruthy();
    await repo.find("actor", { q: "Gym", limit: 1, cursor: first.nextCursor! });
    expect(
      new URL(String(fetcher.mock.calls[1][0])).searchParams.get("offset"),
    ).toBeNull();
    await expect(
      repo.find("other", { q: "Gym", limit: 1, cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    for (const cursor of ["bad", Buffer.from("null").toString("base64url")])
      await expect(
        repo.find("actor", { q: "Gym", cursor }),
      ).rejects.toMatchObject({ status: 400 });
    const c = decodeCursor(first.nextCursor!);
    c.expires = 0;
    await expect(
      repo.find("actor", {
        q: "Gym",
        limit: 1,
        cursor: encodeCursor(c),
      }),
    ).rejects.toMatchObject({ code: "CURSOR_EXPIRED" });
  });
  it("fails closed on missing setup, errors, malformed results and validates locations", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new PlacesRepository("", fetcher).find("a", { q: "Gym" }),
    ).rejects.toMatchObject({ status: 503 });
    const repo = new PlacesRepository("secret", fetcher);
    for (const input of [
      { q: " " },
      { latitude: 91, longitude: 0 },
      { q: "Gym", limit: 51 },
    ])
      await expect(repo.find("a", input)).rejects.toMatchObject({
        status: 400,
      });
    fetcher.mockRejectedValue(new Error("network secret"));
    await expect(repo.find("a", { q: "Gym" })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    fetcher.mockResolvedValue(new Response("bad", { status: 500 }));
    await expect(repo.find("a", { q: "Gym" })).rejects.toMatchObject({
      status: 503,
    });
    fetcher.mockResolvedValue(new Response("{}"));
    await expect(repo.find("a", { q: "Gym" })).rejects.toMatchObject({
      status: 503,
    });
    fetcher.mockResolvedValue(
      response([
        {},
        { properties: { ...feature.properties, lat: 100 } },
        feature,
      ]),
    );
    expect((await repo.find("a", { q: "Gym" })).data).toHaveLength(1);
  });
});
it("resolves selected provider IDs to authoritative display metadata with bounded failure", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([feature]));
  const repo = new PlacesRepository("secret", fetcher);
  expect(await repo.resolve("geoapify:venue1")).toEqual({
    placeId: "geoapify:venue1",
    label: "Gym, London",
    center: { latitude: 51.5, longitude: -0.1 },
  });
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.pathname).toBe("/v2/place-details");
  expect(url.searchParams.get("id")).toBe("venue1");
  expect(url.searchParams.get("features")).toBe("details");
  await expect(repo.resolve("https://attacker.example")).rejects.toMatchObject({
    code: "INVALID_PLACE",
  });
  await expect(
    new PlacesRepository("").resolve("geoapify:venue1"),
  ).rejects.toMatchObject({ status: 503 });
  for (const payload of [
    {},
    { features: [{ properties: { ...feature.properties, lat: 91 } }] },
    {
      features: [
        { properties: { ...feature.properties, place_id: "different" } },
      ],
    },
  ]) {
    fetcher.mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(repo.resolve("geoapify:venue1")).rejects.toMatchObject({
      code: "INVALID_PLACE",
    });
  }
  fetcher.mockRejectedValue(new Error("private-provider-url"));
  await expect(repo.resolve("geoapify:venue1")).rejects.toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
  });
  fetcher.mockResolvedValue(new Response("bad", { status: 502 }));
  await expect(repo.resolve("geoapify:venue1")).rejects.toMatchObject({
    status: 503,
  });
});
