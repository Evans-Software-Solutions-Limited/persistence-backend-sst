/** @jest-environment node */
import type { TogetherOfflineApi } from "@/domain/ports/togetherOfflineApi.port";

const mockLoads: string[] = [];
const mockNative = jest.fn();
const mockClose = jest.fn();
const mockDb = { closeSync: mockClose };
const mockOpen = jest.fn();
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockRandom = jest.fn();
const mockService = { marker: "provisioning-service" };
const mockConstruct = jest.fn();
jest.mock("expo", () => {
  mockLoads.push("expo");
  return { requireOptionalNativeModule: mockNative };
});
jest.mock("expo-secure-store", () => {
  mockLoads.push("secure-store");
  return {
    getItemAsync: mockGet,
    setItemAsync: mockSet,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  };
});
jest.mock("expo-crypto", () => {
  mockLoads.push("crypto");
  return { getRandomBytes: mockRandom };
});
jest.mock("expo-sqlite", () => {
  mockLoads.push("sqlite");
  return { openDatabaseSync: mockOpen };
});
jest.mock("../provisioning/togetherProvisioning", () => {
  mockLoads.push("service");
  return { TogetherProvisioning: mockConstruct };
});
const api: TogetherOfflineApi = {
  trust: jest.fn(),
  register: jest.fn(),
  friendship: jest.fn(),
};
let create: typeof import("../createTogetherProvisioning").createTogetherProvisioning;
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockLoads.length = 0;
  mockNative.mockReset().mockReturnValue({});
  mockOpen.mockReset().mockReturnValue(mockDb);
  mockConstruct.mockReset().mockImplementation(() => mockService);
  mockGet.mockResolvedValue("seed");
  mockSet.mockResolvedValue(undefined);
  // Re-import after resetModules to observe whether disabled composition loads native SDKs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  create = require("../createTogetherProvisioning").createTogetherProvisioning;
});
it("defaults off without loading any native SDK or provisioning code", () => {
  expect(create(api, "staging")).toBeUndefined();
  expect(mockLoads).toEqual([]);
  expect(mockOpen).not.toHaveBeenCalled();
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockSet).not.toHaveBeenCalled();
});
it("does not load optional SDKs when API capability is missing", () => {
  expect(create(undefined, "staging", true)).toBeUndefined();
  expect(mockLoads).toEqual([]);
});
it.each(["ExpoSecureStore", "ExpoCrypto"])(
  "stays unavailable if %s native module is absent",
  (module) => {
    mockNative.mockImplementation((name) => (name === module ? null : {}));
    expect(create(api, "staging", true)).toBeUndefined();
    expect(mockLoads).toEqual(["expo"]);
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  },
);
it("composes the verified service with isolated storage and device-only keychain writes", async () => {
  expect(create(api, "https://staging.example", true)).toBe(mockService);
  expect(mockNative.mock.calls).toEqual([["ExpoSecureStore"], ["ExpoCrypto"]]);
  expect(mockOpen).toHaveBeenCalledWith("together-provisioning.db");
  expect(mockConstruct).toHaveBeenCalledTimes(1);
  const options = mockConstruct.mock.calls[0][0];
  expect(options).toMatchObject({
    api,
    environment: "https://staging.example",
    db: mockDb,
    enabled: true,
    randomBytes: mockRandom,
  });
  expect(await options.secrets.getItemAsync("account-device-key")).toBe("seed");
  expect(mockGet).toHaveBeenCalledWith("account-device-key");
  await options.secrets.setItemAsync("account-device-key", "private-seed");
  expect(mockSet).toHaveBeenCalledWith("account-device-key", "private-seed", {
    keychainAccessible: 6,
  });
  expect(mockClose).not.toHaveBeenCalled();
});
it("closes an opened database if service construction fails", () => {
  mockConstruct.mockImplementation(() => {
    throw new Error("schema failure");
  });
  expect(create(api, "staging", true)).toBeUndefined();
  expect(mockClose).toHaveBeenCalledTimes(1);
});
it("preserves ordinary app operation when native probing fails", () => {
  mockNative.mockImplementation(() => {
    throw new Error("old binary");
  });
  expect(create(api, "staging", true)).toBeUndefined();
  expect(mockOpen).not.toHaveBeenCalled();
});
it("preserves ordinary app operation when database opening fails", () => {
  mockOpen.mockImplementation(() => {
    throw new Error("disk unavailable");
  });
  expect(create(api, "staging", true)).toBeUndefined();
  expect(mockConstruct).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});

it("shares the secret-store identity across concurrent service compositions", () => {
  create(api, "https://staging.example", true);
  create(api, "https://staging.example", true);
  expect(mockConstruct.mock.calls[0][0].secrets).toBe(
    mockConstruct.mock.calls[1][0].secrets,
  );
});
