import type { DeviceSecretStore } from "../security/secureSeed";
import { decode64, encode64 } from "../security/encoding";
import { object, uuid } from "../security/schema";
export interface Device {
  deviceId: string;
  seed: Uint8Array;
}
const pending = new WeakMap<DeviceSecretStore, Map<string, Promise<Device>>>();
export function randomUuid(random: (length: number) => Uint8Array): string {
  const bytes = random(16);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16)
    throw new Error("key-unavailable");
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function device(
  store: DeviceSecretStore,
  scope: string,
  account: string,
  environment: string,
  known: string | null,
  create: boolean,
  random: (n: number) => Uint8Array,
): Promise<Device> {
  let map = pending.get(store);
  if (!map) {
    map = new Map();
    pending.set(store, map);
  }
  let operation = map.get(scope);
  if (!operation) {
    operation = (async () => {
      const saved = await store.getItemAsync(
        `together.provisioning.v1.${scope}`,
      );
      if (saved !== null) {
        if (saved.length > 1024) throw new Error("key-unavailable");
        const record = JSON.parse(saved);
        if (
          !object(record, ["account", "environment", "deviceId", "seed"]) ||
          record.account !== account ||
          record.environment !== environment ||
          !uuid(record.deviceId) ||
          typeof record.seed !== "string"
        )
          throw new Error("key-unavailable");
        const seed = decode64(record.seed, true);
        if (seed.length !== 32 || (known !== null && record.deviceId !== known))
          throw new Error("key-unavailable");
        return { deviceId: record.deviceId, seed };
      }
      if (known !== null || !create) throw new Error("key-unavailable");
      const seed = random(32);
      if (!(seed instanceof Uint8Array) || seed.length !== 32)
        throw new Error("key-unavailable");
      const deviceId = randomUuid(random);
      await store.setItemAsync(
        `together.provisioning.v1.${scope}`,
        JSON.stringify({
          account,
          environment,
          deviceId,
          seed: encode64(seed, true),
        }),
      );
      return { deviceId, seed };
    })();
    map.set(scope, operation);
  }
  try {
    const value = await operation;
    if (known !== null && known !== value.deviceId)
      throw new Error("key-unavailable");
    return { deviceId: value.deviceId, seed: value.seed.slice() };
  } finally {
    if (map.get(scope) === operation) map.delete(scope);
  }
}
