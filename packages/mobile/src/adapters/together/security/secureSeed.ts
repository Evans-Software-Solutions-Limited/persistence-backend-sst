import { encode64, decode64 } from "./encoding";
import { uuid, object } from "./schema";
import { requireTogether } from "./identity";
export interface DeviceSecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}
const pending = new WeakMap<
  DeviceSecretStore,
  Map<string, Promise<Uint8Array>>
>();
/** Explicit creation is only for a new device registration; lost secrets never rotate silently. */
export async function loadOrCreateDeviceSeed(
  accountId: string,
  deviceId: string,
  store: DeviceSecretStore,
  randomBytes: (length: number) => Uint8Array,
  create = false,
): Promise<Uint8Array> {
  requireTogether(uuid(accountId) && uuid(deviceId), "INVALID_DEVICE_ID");
  const key = `together.device.v1.${accountId}.${deviceId}`;
  let operations = pending.get(store);
  if (!operations) {
    operations = new Map();
    pending.set(store, operations);
  }
  const existing = operations.get(key);
  if (existing) return (await existing).slice();
  const operation = (async () => {
    const saved = await store.getItemAsync(key);
    if (saved !== null) {
      requireTogether(saved.length <= 512, "INVALID_DEVICE_SECRET");
      const value = JSON.parse(saved);
      requireTogether(
        object(value, ["accountId", "deviceId", "seed"]) &&
          value.accountId === accountId &&
          value.deviceId === deviceId &&
          typeof value.seed === "string",
        "INVALID_DEVICE_SECRET",
      );
      const seed = decode64(value.seed, true);
      requireTogether(seed.length === 32, "INVALID_DEVICE_SECRET");
      return seed;
    }
    requireTogether(create, "DEVICE_SECRET_MISSING");
    const seed = randomBytes(32);
    requireTogether(
      seed instanceof Uint8Array && seed.length === 32,
      "INVALID_RANDOM",
    );
    await store.setItemAsync(
      key,
      JSON.stringify({ accountId, deviceId, seed: encode64(seed, true) }),
    );
    return seed.slice();
  })();
  operations.set(key, operation);
  try {
    return (await operation).slice();
  } finally {
    operations.delete(key);
  }
}
