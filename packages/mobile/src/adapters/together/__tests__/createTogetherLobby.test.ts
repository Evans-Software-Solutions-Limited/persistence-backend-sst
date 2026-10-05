/** @jest-environment node */
import type { TogetherProvisioningPort } from "@/domain/ports/togetherProvisioning.port";
const mockLoads: string[] = [];
const mockClose = jest.fn();
const mockOpen = jest.fn();
const mockConstruct = jest.fn();
const mockDispose = jest.fn();
jest.mock("../../../../modules/together-lan", () => {
  mockLoads.push("lan");
  return { togetherLan: {} };
});
jest.mock("../../../../modules/together-nearby", () => ({
  togetherNearby: null,
}));
jest.mock("expo-crypto", () => {
  mockLoads.push("crypto");
  return { getRandomBytes: jest.fn(), randomUUID: jest.fn() };
});
jest.mock("expo-sqlite", () => {
  mockLoads.push("sqlite");
  return { openDatabaseSync: mockOpen };
});
jest.mock("../lobbyController", () => ({
  TogetherLobbyController: mockConstruct,
}));
const provisioning = {} as TogetherProvisioningPort;
let create: typeof import("../createTogetherLobby").createTogetherLobby;
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockLoads.length = 0;
  mockOpen.mockReset().mockReturnValue({ closeSync: mockClose });
  mockDispose.mockReset().mockResolvedValue(undefined);
  mockConstruct
    .mockReset()
    .mockImplementation(() => ({ dispose: mockDispose }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  create = require("../createTogetherLobby").createTogetherLobby;
});
it("default-off and missing provisioning do not load LAN or SQLite", () => {
  expect(create(provisioning, "prod")).toBeUndefined();
  expect(create(undefined, "prod", true)).toBeUndefined();
  expect(mockLoads).toEqual([]);
});
it("isolates environment journals and disposes once after stopping", async () => {
  const a = create(provisioning, "prod", true)!;
  const b = create(provisioning, "staging", true)!;
  expect(mockOpen.mock.calls[0][0]).not.toEqual(mockOpen.mock.calls[1][0]);
  expect(mockConstruct.mock.calls[0][0]).toMatchObject({
    enabled: true,
    provisioning,
  });
  await a.dispose();
  await a.dispose();
  expect(mockDispose).toHaveBeenCalledTimes(1);
  expect(mockClose).toHaveBeenCalledTimes(1);
  await b.dispose();
});
it("closes failed construction and isolates unavailable native storage", () => {
  mockConstruct.mockImplementation(() => {
    throw Error("failure");
  });
  expect(create(provisioning, "prod", true)).toBeUndefined();
  expect(mockClose).toHaveBeenCalledTimes(1);
  mockOpen.mockImplementation(() => {
    throw Error("storage");
  });
  expect(create(provisioning, "prod", true)).toBeUndefined();
});
it("closes the database even when disposal fails", async () => {
  const a = create(provisioning, "prod", true)!;
  mockDispose.mockRejectedValueOnce(Error("stop"));
  await expect(a.dispose()).rejects.toThrow("stop");
  expect(mockClose).toHaveBeenCalledTimes(1);
});
