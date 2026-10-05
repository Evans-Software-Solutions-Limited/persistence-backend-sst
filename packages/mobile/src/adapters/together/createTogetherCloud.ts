/* eslint-disable @typescript-eslint/no-require-imports -- Durable native store is loaded only by the internal test capability. */
import type {
  TogetherCloudApi,
  TogetherCloudPort,
} from "@/domain/ports/togetherCloud.port";
export function createTogetherCloud(
  api: TogetherCloudApi | undefined,
  environment: string,
  enabled = false,
): TogetherCloudPort | undefined {
  if (!enabled || !api) return undefined;
  try {
    const { openDatabaseSync } =
      require("expo-sqlite") as typeof import("expo-sqlite");
    const { randomUUID } =
      require("expo-crypto") as typeof import("expo-crypto");
    const { requestHash } =
      require("./security/identity") as typeof import("./security/identity");
    const { TogetherCloudController } =
      require("./cloudSession") as typeof import("./cloudSession");
    const db = openDatabaseSync(
      `together-cloud-${requestHash(environment)}.db`,
    );
    try {
      const controller = new TogetherCloudController({ api, db, randomUUID });
      const dispose = controller.dispose.bind(controller);
      let disposed = false;
      controller.dispose = () => {
        if (disposed) return;
        disposed = true;
        try {
          dispose();
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
