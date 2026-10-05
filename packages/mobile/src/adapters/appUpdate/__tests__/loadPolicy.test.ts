import { readPolicy, fetchPolicy } from "../loadPolicy";
const policy = { iosMinimumVersion: "2.0.0", androidMinimumVersion: "1.1.3" };
const storage = { getItem: jest.fn(), setItem: jest.fn() };
const original = global.fetch;
beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => policy });
  storage.setItem.mockResolvedValue(undefined);
});
afterEach(() => {
  global.fetch = original;
});
it("validates and caches public metadata in its exact environment without auth credentials", async () => {
  const signal = new AbortController().signal;
  expect(await fetchPolicy(storage, "https://stage/", signal)).toEqual(policy);
  expect(global.fetch).toHaveBeenCalledWith("https://stage/app-policy", {
    signal,
    headers: { Accept: "application/json" },
  });
  expect(storage.setItem).toHaveBeenCalledWith(
    "app-policy:https://stage/",
    JSON.stringify(policy),
  );
  storage.getItem.mockResolvedValue(JSON.stringify(policy));
  expect(await readPolicy(storage, "https://stage/")).toEqual(policy);
  expect(storage.getItem).toHaveBeenCalledWith("app-policy:https://stage/");
});
it("rejects network, malformed and cancelled replies without overwriting cached requirements", async () => {
  jest.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
  await expect(
    fetchPolicy(storage, "stage", new AbortController().signal),
  ).rejects.toThrow("policy-unavailable");
  jest
    .mocked(fetch)
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
  await expect(
    fetchPolicy(storage, "stage", new AbortController().signal),
  ).rejects.toThrow("invalid-policy");
  const c = new AbortController();
  c.abort();
  await expect(fetchPolicy(storage, "stage", c.signal)).rejects.toThrow(
    "invalid-policy",
  );
  expect(storage.setItem).not.toHaveBeenCalled();
});
it("falls back safely on empty/corrupt/unreadable cache and enforces online policy despite failed persistence", async () => {
  storage.getItem
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("bad")
    .mockRejectedValueOnce(new Error("disk"));
  for (let i = 0; i < 3; i++)
    expect(await readPolicy(storage, "api")).toBeNull();
  storage.setItem.mockRejectedValue(new Error("disk"));
  expect(
    await fetchPolicy(storage, "api", new AbortController().signal),
  ).toEqual(policy);
});

it("persists a valid lower rollback over an erroneous high floor for subsequent launches", async () => {
  let cached = JSON.stringify({ ...policy, iosMinimumVersion: "9.9.9" });
  storage.getItem.mockImplementation(async () => cached);
  storage.setItem.mockImplementation(async (_key, value) => {
    cached = value;
  });
  expect((await readPolicy(storage, "api"))?.iosMinimumVersion).toBe("9.9.9");
  await fetchPolicy(storage, "api", new AbortController().signal);
  expect(await readPolicy(storage, "api")).toEqual(policy);
});
