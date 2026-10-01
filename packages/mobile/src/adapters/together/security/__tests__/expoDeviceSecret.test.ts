/** @jest-environment node */
import * as SecureStore from "expo-secure-store";
import { loadDeviceSigningSeed } from "../expoDeviceSecret";
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
}));
jest.mock("expo-crypto", () => ({
  getRandomBytes: jest.fn(() => new Uint8Array(32).fill(3)),
}));
const account = "11111111-1111-4111-8111-111111111111";
const device = "22222222-2222-4222-8222-222222222222";
it("uses device-only Keychain protection and explicit create semantics", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  await expect(loadDeviceSigningSeed(account, device)).rejects.toThrow(
    "MISSING",
  );
  expect(await loadDeviceSigningSeed(account, device, true)).toEqual(
    new Uint8Array(32).fill(3),
  );
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    `together.device.v1.${account}.${device}`,
    expect.any(String),
    { keychainAccessible: 7 },
  );
});
