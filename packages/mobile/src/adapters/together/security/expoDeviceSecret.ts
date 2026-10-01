import * as SecureStore from "expo-secure-store";
import { getRandomBytes } from "expo-crypto";
import { DeviceSecretStore, loadOrCreateDeviceSeed } from "./secureSeed";
const deviceStore: DeviceSecretStore = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
};
/** Existing installations without this native module cannot enable local mode. */
export function loadDeviceSigningSeed(
  accountId: string,
  deviceId: string,
  create = false,
) {
  return loadOrCreateDeviceSeed(
    accountId,
    deviceId,
    deviceStore,
    getRandomBytes,
    create,
  );
}
