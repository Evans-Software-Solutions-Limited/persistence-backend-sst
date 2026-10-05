/** @jest-environment node */
import type { TogetherCloudApi } from "@/domain/ports/togetherCloud.port";
const mockLoads: string[] = [];
const mockClose = jest.fn();
const mockOpen = jest.fn();
const mockConstruct = jest.fn();
const mockDispose = jest.fn();
jest.mock("expo-crypto", () => {
  mockLoads.push("crypto");
  return { getRandomBytes: jest.fn(), randomUUID: jest.fn() };
});
jest.mock("expo-sqlite", () => {
  mockLoads.push("sqlite");
  return { openDatabaseSync: mockOpen };
});
jest.mock("../cloudSession", () => ({
  TogetherCloudController: mockConstruct,
}));
const api = {} as TogetherCloudApi;
let create: typeof import("../createTogetherCloud").createTogetherCloud;
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockLoads.length = 0;
  mockOpen.mockReset().mockReturnValue({ closeSync: mockClose });
  mockDispose.mockReset().mockReturnValue(undefined);
  mockConstruct
    .mockReset()
    .mockImplementation(() => ({ dispose: mockDispose }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  create = require("../createTogetherCloud").createTogetherCloud;
});
it("default-off and missing api do not load LAN or SQLite", () => {
  expect(create(api, "prod")).toBeUndefined();
  expect(create(undefined, "prod", true)).toBeUndefined();
  expect(mockLoads).toEqual([]);
});
it("isolates environment journals and disposes once after stopping", async () => {
  const a = create(api, "prod", true)!;
  const b = create(api, "staging", true)!;
  expect(mockOpen.mock.calls[0][0]).not.toEqual(mockOpen.mock.calls[1][0]);
  expect(mockConstruct.mock.calls[0][0]).toMatchObject({
    api,
  });
  a.dispose();
  a.dispose();
  expect(mockDispose).toHaveBeenCalledTimes(1);
  expect(mockClose).toHaveBeenCalledTimes(1);
  b.dispose();
});
it("closes failed construction and isolates unavailable native storage", () => {
  mockConstruct.mockImplementation(() => {
    throw Error("failure");
  });
  expect(create(api, "prod", true)).toBeUndefined();
  expect(mockClose).toHaveBeenCalledTimes(1);
  mockOpen.mockImplementation(() => {
    throw Error("storage");
  });
  expect(create(api, "prod", true)).toBeUndefined();
});
it("closes the database even when disposal fails", async () => {
  const a = create(api, "prod", true)!;
  mockDispose.mockImplementationOnce(() => {
    throw Error("stop");
  });
  expect(() => a.dispose()).toThrow("stop");
  expect(mockClose).toHaveBeenCalledTimes(1);
});
