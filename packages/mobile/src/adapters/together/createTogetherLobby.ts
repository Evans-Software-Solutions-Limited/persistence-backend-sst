/* eslint-disable @typescript-eslint/no-require-imports -- Native imports must remain behind the release gate. */
import type { TogetherProvisioningPort } from "@/domain/ports/togetherProvisioning.port";
import type { TogetherLobbyPort } from "@/domain/ports/togetherLobby.port";

/** Deliberately default-off: old binaries and ordinary workouts load no LAN SDK. */
export function createTogetherLobby(
  provisioning: TogetherProvisioningPort | undefined,
  environment: string,
  enabled = false,
): TogetherLobbyPort | undefined {
  if (!enabled || !provisioning) return undefined;
  try {
    const { togetherLan } =
      require("../../../modules/together-lan") as typeof import("../../../modules/together-lan");
    const { getRandomBytes, randomUUID } =
      require("expo-crypto") as typeof import("expo-crypto");
    const { openDatabaseSync } =
      require("expo-sqlite") as typeof import("expo-sqlite");
    const { requestHash } =
      require("./security/identity") as typeof import("./security/identity");
    const { TogetherLobbyController } =
      require("./lobbyController") as typeof import("./lobbyController");
    const db = openDatabaseSync(
      `together-lobby-${requestHash(environment)}.db`,
    );
    try {
      const controller = new TogetherLobbyController({
        enabled: true,
        provisioning,
        native: togetherLan,
        database: db,
        randomBytes: getRandomBytes,
        randomUUID,
      });
      const dispose = controller.dispose.bind(controller);
      let disposed = false;
      controller.dispose = async () => {
        if (disposed) return;
        disposed = true;
        try {
          await dispose();
        } finally {
          db.closeSync();
        }
      };
      return controller;
    } catch (error) {
      db.closeSync();
      throw error;
    }
  } catch {
    return undefined;
  }
}
