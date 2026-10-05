import type { DeviceSecretStore } from "./security/secureSeed";
import type { TogetherOfflineApi } from "@/domain/ports/togetherOfflineApi.port";
import type { TogetherProvisioningPort } from "@/domain/ports/togetherProvisioning.port";

let deviceSecrets: DeviceSecretStore | undefined;

/** Native provisioning composition. The app-wide update gate owns binary compatibility. */
export function createTogetherProvisioning(
  api: TogetherOfflineApi | undefined,
  environment: string,
  enabled = false,
): TogetherProvisioningPort | undefined {
  if (!enabled || !api) return undefined;
  try {
    const { requireOptionalNativeModule } =
      require("expo") as typeof import("expo");
    if (
      !requireOptionalNativeModule("ExpoSecureStore") ||
      !requireOptionalNativeModule("ExpoCrypto")
    )
      return undefined;
    const secrets =
      require("expo-secure-store") as typeof import("expo-secure-store");
    const { getRandomBytes } =
      require("expo-crypto") as typeof import("expo-crypto");
    const { openDatabaseSync } =
      require("expo-sqlite") as typeof import("expo-sqlite");
    const { TogetherProvisioning } =
      require("./provisioning/togetherProvisioning") as typeof import("./provisioning/togetherProvisioning");
    deviceSecrets ??= {
      getItemAsync: (key) => secrets.getItemAsync(key),
      setItemAsync: (key, value) =>
        secrets.setItemAsync(key, value, {
          keychainAccessible: secrets.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
    };
    const db = openDatabaseSync("together-provisioning.db");
    try {
      return new TogetherProvisioning({
        api,
        environment,
        db,
        enabled: true,
        randomBytes: getRandomBytes,
        secrets: deviceSecrets,
      });
    } catch (error) {
      db.closeSync();
      throw error;
    }
  } catch {
    // Ordinary workouts remain available if the optional native capability or
    // its isolated credential cache cannot be opened. Never bypass verification.
    return undefined;
  }
}
